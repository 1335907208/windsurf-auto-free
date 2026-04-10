import { FastifyInstance } from 'fastify'
import { windsurfRegisterService } from '../services/windsurf'
import { prisma } from '../lib/prisma'

export async function windsurfRoutes(fastify: FastifyInstance) {
  // Start batch register
  fastify.post('/api/windsurf/register', async (request, reply) => {
    try {
      const { count, concurrency = 1, headless = false } = request.body as { count: number; concurrency?: number; headless?: boolean }

      if (!count || count < 1 || count > 100) {
        return reply.status(400).send({
          success: false,
          error: 'count must be between 1 and 100',
        })
      }

      if (windsurfRegisterService.isRunning()) {
        return reply.status(400).send({
          success: false,
          error: 'Batch registration is already running',
        })
      }

      // Start registration in background
      windsurfRegisterService.startBatchRegister(count, concurrency, headless).catch(console.error)

      return {
        success: true,
        data: { message: 'Batch registration started', count, concurrency, headless },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start registration',
      })
    }
  })

  // Stop batch register
  fastify.post('/api/windsurf/stop', async (request, reply) => {
    try {
      windsurfRegisterService.stopBatchRegister()

      return {
        success: true,
        data: { message: 'Batch registration stopped' },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop registration',
      })
    }
  })

  // Force reset running state
  fastify.post('/api/windsurf/reset', async (request, reply) => {
    try {
      windsurfRegisterService.reset()

      return {
        success: true,
        data: { message: 'State reset' },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset',
      })
    }
  })

  // Get registration status
  fastify.get('/api/windsurf/status', async (request, reply) => {
    try {
      const running = windsurfRegisterService.isRunning()

      return {
        success: true,
        data: { running },
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status',
      })
    }
  })

  // Get accounts list
  fastify.get('/api/windsurf/accounts', async (request, reply) => {
    try {
      const accounts = await windsurfRegisterService.getAccounts()

      return {
        success: true,
        data: accounts,
      }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get accounts',
      })
    }
  })

  // Delete account
  fastify.delete('/api/windsurf/accounts/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }

      await prisma.windsurfAccount.delete({
        where: { id },
      })

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
}
