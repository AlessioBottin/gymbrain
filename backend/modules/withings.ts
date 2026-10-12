import Fastify from 'fastify'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authenticate, serverClient, errors } from '../lib/auth.ts'
import {
  configuration,
  digest,
  seal,
  unseal,
  parseMeasures,
  WithingsProvider,
} from '../withings/provider.ts'

export function createWithingsModule(
  auth = authenticate,
  database = serverClient,
  provider = new WithingsProvider(),
) {
  const app = Fastify({ bodyLimit: 8192 })
  errors(app)
  const running = new Set<Promise<unknown>>()
  function launch(owner: string) {
    const task = synchronize(owner)
      .catch(() => undefined)
      .finally(() => running.delete(task))
    running.add(task)
  }
  app.addHook('onClose', async () => {
    await Promise.allSettled(running)
  })
  const checked = <T extends { error: any; data?: any }>(result: T): T['data'] => {
    if (result.error) throw new Error('Archivio integrazione non disponibile')
    return result.data
  }
  async function connection(owner: string) {
    return checked(
      await database().from('withings_connections').select('*').eq('user_id', owner).maybeSingle(),
    )
  }
  async function patch(owner: string, changes: object) {
    checked(await database().from('withings_connections').update(changes).eq('user_id', owner))
  }
  async function acquire(owner: string, lease: string) {
    return checked(await database().rpc('withings_acquire', { owner_id: owner, lease })) === true
  }
  async function release(owner: string, lease: string) {
    checked(
      await database().from('withings_leases').delete().eq('user_id', owner).eq('lease_id', lease),
    )
  }
  function requireConfig() {
    if (!configuration().configured)
      throw Object.assign(new Error('Collegamento Withings non ancora configurato'), {
        statusCode: 503,
      })
  }
  async function synchronize(owner: string, automatic = false) {
    requireConfig()
    const lease = randomUUID()
    if (!(await acquire(owner, lease))) return { busy: true, more: true, imported: 0 }
    let imported = 0
    try {
      const row = await connection(owner)
      if (!row) return { connected: false, imported: 0, more: false }
      if (
        automatic &&
        !row.pending &&
        row.last_attempt &&
        Date.now() - Date.parse(row.last_attempt) < 300000
      )
        return { imported: 0, more: false }
      await patch(owner, { last_attempt: new Date().toISOString() })
      let tokens = unseal(row.tokens, owner)
      if (tokens.expiresAt < Date.now() + 60000) {
        const refreshed = await provider.refresh(tokens.refresh_token)
        if (refreshed.userid && refreshed.userid !== row.provider_user)
          throw new Error('Withings identity mismatch')
        tokens = { ...tokens, ...refreshed, expiresAt: Date.now() + refreshed.expires_in * 1000 }
        // Persist the rotated refresh token BEFORE making any request with the new access token.
        await patch(owner, { tokens: seal(tokens, owner) })
      }
      if (!row.subscribed) {
        try {
          await provider.subscribe(tokens.access_token, tokens.webhookSecret)
          await patch(owner, { subscribed: true })
        } catch {
          /* Import still works; status offers app-open/manual catch-up. Retry on next sync. */
        }
      }
      const started = row.scan_started || Math.floor(Date.now() / 1000)
      let offset = row.scan_offset || 0
      await patch(owner, { scan_started: started, pending: true })
      const deadline = Date.now() + 45000
      for (let page = 0; page < 5; page++) {
        if (!(await acquire(owner, lease))) throw new Error('Lease expired')
        const parsed = parseMeasures(
          await provider.measures(tokens.access_token, row.last_cursor, offset),
          row.provider_user,
        )
        for (const weight of parsed.weights) {
          if (!(await acquire(owner, lease))) throw new Error('Lease expired')
          if (
            checked(
              await database().rpc('tracking_import_weight', { owner_id: owner, document: weight }),
            )
          )
            imported++
        }
        if (!parsed.more) {
          await patch(owner, {
            last_cursor: Math.max(0, started - 60),
            scan_offset: 0,
            scan_started: null,
            last_sync: new Date().toISOString(),
            pending: false,
            error: null,
          })
          return { imported, more: false }
        }
        if (parsed.offset <= offset) throw new Error('Invalid Withings pagination')
        offset = parsed.offset
        await patch(owner, { scan_offset: offset })
        if (Date.now() > deadline) break
      }
      return { imported, more: true }
    } catch {
      await patch(owner, {
        error:
          'Sincronizzazione non riuscita. Riprova; se persiste, scollega e ricollega Withings.',
        pending: true,
      })
      throw Object.assign(
        new Error('Withings non disponibile. I dati già importati restano salvati.'),
        { statusCode: 502 },
      )
    } finally {
      await release(owner, lease)
    }
  }
  app.get('/status', async (req) => {
    const { userId } = await auth(req)
    if (!configuration().configured) return { configured: false, connected: false }
    const row = await connection(userId)
    return {
      configured: true,
      connected: !!row,
      lastSync: row?.last_sync || null,
      notifications: !!row?.subscribed,
      pending: !!row?.pending,
      error: row?.error || null,
    }
  })
  app.post('/connect', async (req) => {
    const { userId } = await auth(req)
    requireConfig()
    if (await connection(userId))
      throw Object.assign(new Error('Scollega prima il tuo account Withings'), { statusCode: 409 })
    const db = database(),
      state = randomBytes(32).toString('hex')
    checked(await db.from('withings_states').delete().eq('user_id', userId))
    checked(await db.from('withings_states').delete().lt('expires_at', new Date().toISOString()))
    checked(
      await db
        .from('withings_states')
        .insert({
          user_id: userId,
          state_hash: digest(state),
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
    )
    const cfg = configuration(),
      url = new URL('https://account.withings.com/oauth2_user/authorize2')
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      scope: 'user.metrics',
      redirect_uri: cfg.callback,
      state,
    }).toString()
    return { url: url.toString(), state }
  })
  app.post('/callback', async (req) => {
    requireConfig()
    const { state, code } = z
      .object({ state: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(2048) })
      .parse(req.body)
    const db = database()
    const stored = checked(
      await db
        .from('withings_states')
        .delete()
        .eq('state_hash', digest(state))
        .gt('expires_at', new Date().toISOString())
        .select('user_id')
        .maybeSingle(),
    )
    if (!stored) return { connected: false }
    const owner = stored.user_id,
      lease = randomUUID()
    if (!(await acquire(owner, lease))) return { connected: false }
    try {
      if (await connection(owner)) return { connected: false }
      const token = await provider.exchange(code)
      if (!token.userid || (token.scope && !token.scope.split(',').includes('user.metrics')))
        return { connected: false }
      const webhookSecret = randomBytes(32).toString('hex')
      checked(
        await db
          .from('withings_connections')
          .insert({
            user_id: owner,
            provider_user: token.userid,
            tokens: seal(
              { ...token, expiresAt: Date.now() + token.expires_in * 1000, webhookSecret },
              owner,
            ),
            webhook_hash: digest(webhookSecret),
          }),
      )
      return { connected: true }
    } finally {
      await release(owner, lease)
    }
  })
  app.post('/sync', async (req) => {
    const { userId } = await auth(req)
    return synchronize(userId, (req.body as any)?.automatic === true)
  })
  app.post('/disconnect', async (req) => {
    const { userId } = await auth(req)
    requireConfig()
    const lease = randomUUID()
    if (!(await acquire(userId, lease)))
      throw Object.assign(new Error('Sincronizzazione in corso. Riprova tra poco.'), {
        statusCode: 409,
      })
    try {
      const row = await connection(userId)
      if (row) {
        await provider.revoke(row.provider_user)
        checked(await database().from('withings_connections').delete().eq('user_id', userId))
      }
      checked(await database().from('withings_states').delete().eq('user_id', userId))
      return { connected: false }
    } finally {
      await release(userId, lease)
    }
  })
  app.post('/webhook', async (req) => {
    requireConfig()
    const { secret, userid, appli } = z
      .object({
        secret: z.string().regex(/^[a-f0-9]{64}$/),
        userid: z.string().regex(/^\d+$/),
        appli: z.literal('1'),
      })
      .parse(req.body)
    const row = checked(
      await database()
        .from('withings_connections')
        .select('user_id,provider_user')
        .eq('webhook_hash', digest(secret))
        .maybeSingle(),
    )
    if (row && row.provider_user === userid) {
      await patch(row.user_id, { pending: true })
      // Durable flag survives a Render restart. Opening the app also drains it.
      setImmediate(() => launch(row.user_id))
    }
    return { received: true }
  })
  return app
}
