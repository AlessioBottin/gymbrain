import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRecordsModule } from './modules/records.ts';
import { createPublicCatalogModule } from './modules/publicCatalog.ts';
import { localTransport, type Transport } from './lib/transport.ts';
import { bearer, errors } from './lib/auth.ts';
import { createMediaModule } from './modules/media.ts';
import { createWhoopModule } from './modules/whoop.ts';
import { config as whoopConfig, validSignature } from './whoop/provider.ts';
import { createWithingsModule } from './modules/withings.ts';
import { timingSafeEqual } from 'node:crypto';

export async function createApp(
  options: { staticRoot?: string; transports?: Record<string, Transport> } = {},
) {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      serializers: {
        req: (req) => ({
          method: req.method,
          url: /^\/api\/(withings|whoop)\//.test(req.url || '')
            ? '/api/integration/[redacted]'
            : req.url?.split('?')[0],
        }),
      },
    },
    bodyLimit: 1024 * 1024,
  });
  errors(app);
  const supabase = process.env.SUPABASE_URL || 'https://*.supabase.co';
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
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  const modules = options.transports
    ? []
    : [
        createRecordsModule('training'),
        createRecordsModule('tracking'),
        createMediaModule(),
        createWithingsModule(),
        createWhoopModule(),
        createPublicCatalogModule(),
      ];
  const transports = options.transports || {
    training: localTransport(modules[0]!),
    tracking: localTransport(modules[1]!),
    media: localTransport(modules[2]!),
    withings: localTransport(modules[3]!),
    whoop: localTransport(modules[4]!),
    publicCatalog: localTransport(modules[5]!),
  };
  app.addHook('onClose', async () => {
    await Promise.all(modules.map((m) => m.close()));
  });
  app.get('/api/health', async () => ({
    ok: true,
    configured:
      !!process.env.SUPABASE_URL &&
      !!process.env.SUPABASE_PUBLISHABLE_KEY &&
      !!process.env.SUPABASE_SECRET_KEY,
  }));
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 8192 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  for (const integration of ['withings', 'whoop']) {
    const cookieName = '__Host-gymbrain-' + integration;
    const cookie = (state: string, age: number) =>
      `${cookieName}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
    for (const endpoint of integration === 'whoop'
      ? ['status', 'connect', 'sync', 'disconnect', 'data', 'link']
      : ['status', 'connect', 'sync', 'disconnect']) {
      app.route({
        method: ['status', 'data'].includes(endpoint) ? 'GET' : 'POST',
        url: '/api/' + integration + '/' + endpoint,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        handler: async (req, reply) => {
          reply.header('cache-control', 'no-store');
          const token = bearer(req);
          if (!token) return reply.code(401).send({ error: 'Accesso richiesto' });
          const result = await transports[integration]!.request({
            method: req.method as any,
            path:
              '/' +
              endpoint +
              (endpoint === 'data'
                ? '?after=' + encodeURIComponent(String((req.query as any).after || 0))
                : ''),
            token,
            body: req.body,
          });
          if (endpoint === 'connect' && result.status === 200) {
            reply.header('set-cookie', cookie(result.body.state, 600));
            return { url: result.body.url };
          }
          return reply.code(result.status).send(result.body);
        },
      });
    }
    app.get('/api/' + integration + '/callback', async (req, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('set-cookie', cookie('', 0));
      const { state, code } = req.query as Record<string, string>;
      const saved = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1);
      if (
        !/^[a-f0-9]{64}$/.test(state || '') ||
        !/^[a-f0-9]{64}$/.test(saved || '') ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(saved!)) ||
        typeof code !== 'string'
      )
        return reply.redirect('/?' + integration + '=error');
      try {
        const result = await transports[integration]!.request({
          method: 'POST',
          path: '/callback',
          token: '',
          body: { state, code },
        });
        return reply.redirect(
          '/?' + integration + '=' + (result.status === 200 && result.body.connected ? 'connected' : 'error'),
        );
      } catch {
        return reply.redirect('/?' + integration + '=error');
      }
    });
  }
  app.head('/api/withings/webhook/:secret', async (_req, reply) => reply.code(204).send());
  app.post('/api/withings/webhook/:secret', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const secret = (req.params as any).secret;
    const body = req.body as any;
    if (!/^[a-f0-9]{64}$/.test(secret) || typeof body?.userid !== 'string' || body?.appli !== '1')
      return reply.code(400).send({ error: 'Notifica non valida' });
    const result = await transports.withings!.request({
      method: 'POST',
      path: '/webhook',
      token: '',
      body: { secret, userid: body.userid, appli: body.appli },
    });
    return reply.code(result.status).send(result.body);
  });
  await app.register(async (gateway) => {
    gateway.removeContentTypeParser('application/json');
    gateway.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 16384 },
      (_req, body, done) => done(null, body),
    );
    gateway.post('/api/whoop/webhook', async (req, reply) => {
      const raw = String(req.body),
        timestamp = String(req.headers['x-whoop-signature-timestamp'] || ''),
        signature = String(req.headers['x-whoop-signature'] || '');
      if (!validSignature(raw, timestamp, signature, whoopConfig().secret))
        return reply.code(401).send({ error: 'Firma non valida' });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: 'Notifica non valida' });
      }
      const result = await transports.whoop!.request({ method: 'POST', path: '/webhook', token: '', body });
      return reply.code(result.status).send(result.body);
    });
  });
  for (const endpoint of ['upload-url', 'download-url'])
    app.post('/api/media/' + endpoint, async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const token = bearer(req);
      if (!token) return reply.code(401).send({ error: 'Accesso richiesto' });
      const result = await transports.media!.request({
        method: 'POST',
        path: '/' + endpoint,
        token,
        body: req.body,
      });
      return reply.code(result.status).send(result.body);
    });
  for (const module of ['training', 'tracking'])
    for (const endpoint of ['records', 'mutations']) {
      app.route({
        method: endpoint === 'records' ? 'GET' : 'POST',
        url: `/api/${module}/${endpoint}`,
        handler: async (req, reply) => {
          reply.header('cache-control', 'no-store');
          const token = bearer(req);
          if (!token) return reply.code(401).send({ error: 'Accesso richiesto' });
          const path = `/${endpoint}${endpoint === 'records' ? `?after=${encodeURIComponent(String((req.query as any).after || 0))}` : ''}`;
          const response = await transports[module]!.request({
            method: req.method as any,
            path,
            token,
            body: req.body,
          });
          return reply.code(response.status).send(response.body);
        },
      });
    }
  app.get('/api/public-catalog/exercises', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const token = bearer(req);
    if (!token) return reply.code(401).send({ error: 'Accesso richiesto' });
    const result = await transports.publicCatalog!.request({
      method: 'GET',
      path: '/exercises?page=' + encodeURIComponent(String((req.query as any).page || 0)),
      token,
    });
    return reply.code(result.status).send(result.body);
  });
  const root = options.staticRoot || resolve('.output/public');
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
        );
      },
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.url.includes('.')
        ? reply.code(404).send({ error: 'Non trovato' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
