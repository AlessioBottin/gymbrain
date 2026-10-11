import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createRecordsModule } from './modules/records.ts'
import { localTransport, type Transport } from './lib/transport.ts'
import { bearer, errors } from './lib/auth.ts'
import { createMediaModule } from './modules/media.ts'

export async function createApp(
  options: { staticRoot?: string; transports?: Record<string, Transport> } = {},
) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 1024 * 1024,
  })
  errors(app)
  const supabase = process.env.SUPABASE_URL || 'https://*.supabase.co'
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', supabase],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", supabase],
        mediaSrc: ["'self'", 'blob:', supabase],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
  })
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })
  const modules = options.transports
    ? []
    : [createRecordsModule('training'), createRecordsModule('tracking'), createMediaModule()]
  const transports = options.transports || {
    training: localTransport(modules[0]!),
    tracking: localTransport(modules[1]!),
    media: localTransport(modules[2]!),
  }
  app.addHook('onClose', async () => {
    await Promise.all(modules.map((m) => m.close()))
  })
  app.get('/api/health', async () => ({
    ok: true,
    configured:
      !!process.env.SUPABASE_URL &&
      !!process.env.SUPABASE_PUBLISHABLE_KEY &&
      !!process.env.SUPABASE_SECRET_KEY,
  }))
  for (const endpoint of ['upload-url', 'download-url'])
    app.post('/api/media/' + endpoint, async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const token = bearer(req)
      if (!token) return reply.code(401).send({ error: 'Accesso richiesto' })
      const result = await transports.media!.request({
        method: 'POST',
        path: '/' + endpoint,
        token,
        body: req.body,
      })
      return reply.code(result.status).send(result.body)
    })
  for (const module of ['training', 'tracking'])
    for (const endpoint of ['records', 'mutations']) {
      app.route({
        method: endpoint === 'records' ? 'GET' : 'POST',
        url: `/api/${module}/${endpoint}`,
        handler: async (req, reply) => {
          reply.header('cache-control', 'no-store')
          const token = bearer(req)
          if (!token) return reply.code(401).send({ error: 'Accesso richiesto' })
          const path = `/${endpoint}${endpoint === 'records' ? `?after=${encodeURIComponent(String((req.query as any).after || 0))}` : ''}`
          const response = await transports[module]!.request({
            method: req.method as any,
            path,
            token,
            body: req.body,
          })
          return reply.code(response.status).send(response.body)
        },
      })
    }
  const root = options.staticRoot || resolve('.output/public')
  if (existsSync(root)) {
    await app.register(fastifyStatic, {
      root,
      setHeaders(reply, path) {
        reply.header(
          'Cache-Control',
          path.endsWith('sw.js') || path.endsWith('.html')
            ? 'no-cache'
            : path.includes('_nuxt')
              ? 'public,max-age=31536000,immutable'
              : 'public,max-age=3600',
        )
      },
    })
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.url.includes('.')
        ? reply.code(404).send({ error: 'Non trovato' })
        : reply.sendFile('index.html'),
    )
  }
  return app
}
