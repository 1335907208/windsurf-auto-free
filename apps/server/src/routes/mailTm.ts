import { FastifyInstance } from 'fastify'
import { mailTmService } from '../services/mailTm'
import { prisma } from '../lib/prisma'

function extractVerificationCodes(html: string, text: string): string[] {
  const codes: Set<string> = new Set()
  
  // 1. 最高优先级：匹配 class="code" 或类似标记内的数字
  const codeDivMatches = html.matchAll(/class=["']code["'][^>]*>\s*(\d{4,8})\s*</gi)
  for (const match of codeDivMatches) {
    if (match[1]) {
      codes.add(match[1])
    }
  }
  
  // 如果找到 class="code" 内的验证码，直接返回
  if (codes.size > 0) {
    return Array.from(codes)
  }
  
  // 2. 高优先级：纯文本中单独一行的数字（邮件text版本）
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)
  for (const line of lines) {
    if (/^\d{4,8}$/.test(line)) {
      codes.add(line)
    }
  }
  
  // 如果找到，直接返回
  if (codes.size > 0) {
    return Array.from(codes)
  }
  
  // 3. 中优先级：关键词附近的数字
  const keywordPatterns = [
    /验证码[：:\s]*(\d{4,8})/gi,
    /verification\s*code[：:\s]*(\d{4,8})/gi,
    /code[：:\s]*(\d{4,8})/gi,
    /enter\s*(?:the\s*)?(?:following\s*)?code[：:\s]*(\d{4,8})/gi,
  ]
  
  for (const pattern of keywordPatterns) {
    const matches = html.matchAll(pattern)
    for (const match of matches) {
      if (match[1]) codes.add(match[1])
    }
  }
  
  // 如果已找到验证码，直接返回
  if (codes.size > 0) {
    return Array.from(codes)
  }
  
  // 4. 低优先级：排除干扰后提取（仅作为最后手段）
  let cleanHtml = html
    .replace(/#[0-9a-fA-F]{6}/g, 'COLOR_REMOVED') // 移除CSS颜色
    .replace(/\b\d{5}\b/g, 'ZIP_REMOVED') // 移除邮编
    .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, 'IP_REMOVED') // 移除IP
  
  const generalMatch = cleanHtml.matchAll(/\b(\d{4,8})\b/g)
  for (const match of generalMatch) {
    if (match[1]) codes.add(match[1])
  }

  return Array.from(codes)
}

export async function mailTmRoutes(fastify: FastifyInstance) {
  // Get or create email address
  fastify.get('/api/mailtm/address', async (request, reply) => {
    try {
      const session = mailTmService.getSession()

      if (session.token && session.address) {
        return {
          success: true,
          data: {
            email: session.address,
            token: session.token,
          },
        }
      }

      const result = await mailTmService.createAccount()
      
      // Save to database
      await prisma.emailHistory.create({
        data: {
          email: result.address,
          provider: 'mailtm',
          password: result.password,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      })
      
      return {
        success: true,
        data: {
          email: result.address,
          password: result.password,
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create account',
      })
    }
  })

  // Restore session
  fastify.post('/api/mailtm/session', async (request, reply) => {
    try {
      const { token, address, password } = request.body as {
        token: string
        address: string
        password: string
      }

      if (!token || !address || !password) {
        return reply.status(400).send({
          success: false,
          error: 'token, address and password are required',
        })
      }

      mailTmService.setSession(token, address, password)

      return {
        success: true,
        data: { email: address, token },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore session',
      })
    }
  })

  // Get messages
  fastify.get('/api/mailtm/list', async (request, reply) => {
    try {
      const messages = await mailTmService.getMessages()

      const emails = messages.map((msg) => ({
        id: msg.id,
        from: msg.from.address,
        fromName: msg.from.name,
        subject: msg.subject,
        excerpt: msg.intro,
        timestamp: msg.createdAt,
        date: msg.createdAt,
        read: msg.seen,
      }))

      return {
        success: true,
        data: {
          emails,
          count: emails.length,
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get messages',
      })
    }
  })

  // Get single message
  fastify.get('/api/mailtm/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const msg = await mailTmService.getMessage(id)

      const html = msg.html?.join('\n') || ''
      const text = msg.text || ''
      const codes = extractVerificationCodes(html, text)

      // Save to database
      const session = mailTmService.getSession()
      if (session.address) {
        const history = await prisma.emailHistory.findUnique({
          where: { email: session.address },
        })
        if (history) {
          await prisma.emailMessage.upsert({
            where: { messageId: id },
            create: {
              emailHistoryId: history.id,
              messageId: id,
              from: msg.from.address,
              fromName: msg.from.name,
              subject: msg.subject,
              body: html,
              text,
              codes: JSON.stringify(codes),
            },
            update: {
              body: html,
              text,
              codes: JSON.stringify(codes),
            },
          })
        }
      }

      return {
        success: true,
        data: {
          id: msg.id,
          from: msg.from.address,
          fromName: msg.from.name,
          subject: msg.subject,
          body: html || text,
          text,
          excerpt: msg.intro,
          timestamp: msg.createdAt,
          date: msg.createdAt,
          codes,
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get message',
      })
    }
  })

  // Delete account
  fastify.delete('/api/mailtm/session', async (request, reply) => {
    try {
      await mailTmService.deleteAccount()

      return {
        success: true,
        data: { deleted: true },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete account',
      })
    }
  })

  // Get email history list
  fastify.get('/api/mailtm/history', async (request, reply) => {
    try {
      const history = await prisma.emailHistory.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          emails: {
            orderBy: { receivedAt: 'desc' },
            take: 10,
          },
        },
        take: 50,
      })

      return {
        success: true,
        data: history.map((h) => ({
          id: h.id,
          email: h.email,
          provider: h.provider,
          createdAt: h.createdAt,
          expiresAt: h.expiresAt,
          messageCount: h.emails.length,
          messages: h.emails.map((m) => ({
            id: m.id,
            messageId: m.messageId,
            from: m.from,
            fromName: m.fromName,
            subject: m.subject,
            codes: m.codes ? JSON.parse(m.codes) : [],
            receivedAt: m.receivedAt,
          })),
        })),
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get history',
      })
    }
  })

  // Get single email history detail
  fastify.get('/api/mailtm/history/:email', async (request, reply) => {
    try {
      const { email } = request.params as { email: string }
      
      const history = await prisma.emailHistory.findUnique({
        where: { email },
        include: {
          emails: {
            orderBy: { receivedAt: 'desc' },
          },
        },
      })

      if (!history) {
        return reply.status(404).send({
          success: false,
          error: 'Email history not found',
        })
      }

      return {
        success: true,
        data: {
          id: history.id,
          email: history.email,
          provider: history.provider,
          createdAt: history.createdAt,
          expiresAt: history.expiresAt,
          messages: history.emails.map((m) => ({
            id: m.id,
            messageId: m.messageId,
            from: m.from,
            fromName: m.fromName,
            subject: m.subject,
            body: m.body,
            text: m.text,
            codes: m.codes ? JSON.parse(m.codes) : [],
            receivedAt: m.receivedAt,
          })),
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get history',
      })
    }
  })
}
