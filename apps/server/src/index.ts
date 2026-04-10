import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import http from 'http'
import { mailRoutes } from './routes/mail'
import { mailTmRoutes } from './routes/mailTm'
import { windsurfRoutes } from './routes/windsurf'
import { windsurfRegisterService } from './services/windsurf'

// Create SSE server on separate port
const sseServer = http.createServer((req, res) => {
  if (req.url === '/api/windsurf/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    
    res.write('data: connected\n\n')
    
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n')
    }, 15000)
    
    const callback = (log: string) => {
      try {
        res.write(`data: ${log}\n\n`)
      } catch (e) {}
    }
    
    windsurfRegisterService.addLogCallback(callback)
    
    req.on('close', () => {
      clearInterval(keepAlive)
      windsurfRegisterService.removeLogCallback(callback)
    })
  } else {
    res.writeHead(404)
    res.end()
  }
})

sseServer.listen(3002, () => {
  console.log('SSE server listening on http://localhost:3002')
})

async function main() {
  const fastify = Fastify({
    logger: true,
  })

  // Register plugins
  await fastify.register(cors, {
    origin: true,
  })

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Windsurf Auto Free API',
        description: 'API documentation for Windsurf Auto Free',
        version: '0.0.1',
      },
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  })

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Test endpoint
  fastify.get('/api/test', async () => {
    return {
      success: true,
      message: 'Frontend-Backend connection successful!',
      serverTime: new Date().toISOString(),
      serverInfo: {
        node: process.version,
        platform: process.platform,
      },
    }
  })

  // Register mail routes
  await fastify.register(mailRoutes)
  await fastify.register(mailTmRoutes)
  await fastify.register(windsurfRoutes)

  // Start server
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' })
    console.log('Server listening on http://localhost:3001')
    console.log('API Docs available at http://localhost:3001/docs')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
