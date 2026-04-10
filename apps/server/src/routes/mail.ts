import { FastifyInstance } from 'fastify'
import { guerrillaMailService } from '../services/guerrillaMail'

const CODE_PATTERNS = [
  /\b(\d{4,8})\b/g, // 4-8 digit codes
  /验证码[：:]\s*(\d+)/gi,
  /code[：:]\s*(\d+)/gi,
  /码[：:]\s*(\d+)/gi,
  /验证码是[：:]?\s*(\d+)/gi,
  /code is[：:]?\s*(\d+)/gi,
]

function extractVerificationCodes(text: string): string[] {
  const codes: Set<string> = new Set()

  for (const pattern of CODE_PATTERNS) {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      if (match[1] && match[1].length >= 4) {
        codes.add(match[1])
      }
    }
  }

  return Array.from(codes)
}

export async function mailRoutes(fastify: FastifyInstance) {
  // Get or create email address
  fastify.get('/api/mail/address', async (request, reply) => {
    try {
      const session = guerrillaMailService.getSession()

      // Return existing session if available
      if (session.sidToken && session.emailAddress) {
        return {
          success: true,
          data: {
            email: session.emailAddress,
            sidToken: session.sidToken,
          },
        }
      }

      // Create new session
      const result = await guerrillaMailService.getEmailAddress()
      return {
        success: true,
        data: {
          email: result.email_addr,
          sidToken: result.sid_token,
          timestamp: result.email_timestamp,
          alias: result.alias,
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get email address',
      })
    }
  })

  // Restore session with existing token
  fastify.post('/api/mail/session', async (request, reply) => {
    try {
      const { sidToken, email } = request.body as { sidToken: string; email: string }

      if (!sidToken || !email) {
        return reply.status(400).send({
          success: false,
          error: 'sidToken and email are required',
        })
      }

      guerrillaMailService.setSession(sidToken, email)

      return {
        success: true,
        data: { email, sidToken },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore session',
      })
    }
  })

  // Get email list
  fastify.get('/api/mail/list', async (request, reply) => {
    try {
      const { offset = '0' } = request.query as { offset?: string }
      const result = await guerrillaMailService.getEmailList(parseInt(offset))

      // Handle empty or error responses
      const list = result.list || []

      const emails = list.map((email) => ({
        id: String(email.mail_id),
        from: email.mail_from,
        subject: email.mail_subject,
        excerpt: email.mail_excerpt,
        timestamp: String(email.mail_timestamp),
        date: email.mail_date,
        read: email.mail_read === 1 || email.mail_read === '1',
      }))

      return {
        success: true,
        data: {
          emails,
          count: result.count || 0,
          email: result.email || '',
          sidToken: result.sid_token || '',
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get email list',
      })
    }
  })

  // Get single email with verification code extraction
  fastify.get('/api/mail/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const result = await guerrillaMailService.fetchEmail(id)

      const body = result.mail_body || ''
      const codes = extractVerificationCodes(body)

      return {
        success: true,
        data: {
          id: String(result.mail_id),
          from: result.mail_from,
          subject: result.mail_subject,
          body,
          excerpt: result.mail_excerpt,
          timestamp: String(result.mail_timestamp),
          date: result.mail_date,
          codes,
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch email',
      })
    }
  })

  // Check for new emails (polling)
  fastify.get('/api/mail/check', async (request, reply) => {
    try {
      const { seq = '1' } = request.query as { seq?: string }
      const result = await guerrillaMailService.checkEmail(parseInt(seq))

      const list = result.list || []

      return {
        success: true,
        data: {
          count: result.count || 0,
          emails: list.map((email) => ({
            id: String(email.mail_id),
            from: email.mail_from,
            subject: email.mail_subject,
            timestamp: String(email.mail_timestamp),
          })),
        },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check emails',
      })
    }
  })

  // Forget current session
  fastify.delete('/api/mail/session', async (request, reply) => {
    try {
      await guerrillaMailService.forgetMe()
      guerrillaMailService.setSession('', '')

      return {
        success: true,
        data: { deleted: true },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to forget session',
      })
    }
  })
}
