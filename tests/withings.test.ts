import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import {
  configuration,
  seal,
  unseal,
  parseMeasures,
  WithingsProvider,
} from '../backend/withings/provider.ts'
import { createApp } from '../backend/app.ts'
import { createWithingsModule } from '../backend/modules/withings.ts'

function integrationDatabase() {
  const tables: Record<string, any[]> = {
    withings_states: [],
    withings_connections: [],
    withings_leases: [],
  }
  const leases = new Map<string, string>(),
    imported: any[] = []
  return {
    tables,
    imported,
    client: {
      from(table: string) {
        let operation = 'read',
          value: any,
          single = false
        const filters: ((r: any) => boolean)[] = []
        const query: any = {
          select: () => query,
          eq: (k: string, v: any) => {
            filters.push((r) => r[k] === v)
            return query
          },
          gt: (k: string, v: any) => {
            filters.push((r) => r[k] > v)
            return query
          },
          lt: (k: string, v: any) => {
            filters.push((r) => r[k] < v)
            return query
          },
          maybeSingle: () => {
            single = true
            return query
          },
          delete: () => {
            operation = 'delete'
            return query
          },
          update: (v: any) => {
            operation = 'update'
            value = v
            return query
          },
          insert: (v: any) => {
            operation = 'insert'
            value = v
            return query
          },
          then(resolve: any) {
            let rows = tables[table]!.filter((r) => filters.every((f) => f(r)))
            if (operation === 'delete') {
              tables[table] = tables[table]!.filter((r) => !rows.includes(r))
              if (table === 'withings_leases') for (const row of rows) leases.delete(row.user_id)
            }
            if (operation === 'update') for (const row of rows) Object.assign(row, value)
            if (operation === 'insert') {
              const row = {
                last_cursor: 0,
                scan_offset: 0,
                pending: true,
                subscribed: false,
                ...value,
              }
              tables[table]!.push(row)
              rows = [row]
            }
            return Promise.resolve({ error: null, data: single ? rows[0] || null : rows }).then(
              resolve,
            )
          },
        }
        return query
      },
      async rpc(name: string, args: any) {
        if (name === 'withings_acquire') {
          if (leases.has(args.owner_id) && leases.get(args.owner_id) !== args.lease)
            return { error: null, data: false }
          leases.set(args.owner_id, args.lease)
          tables.withings_leases = [{ user_id: args.owner_id, lease_id: args.lease }]
          return { error: null, data: true }
        }
        if (name === 'tracking_import_weight') {
          imported.push(args)
          return { error: null, data: true }
        }
        throw Error('Unexpected RPC')
      },
    },
  }
}

test('Withings module consumes OAuth state once, rotates before use, resumes pages and scopes account data', async () => {
  process.env.WITHINGS_CLIENT_ID = 'test-client'
  process.env.WITHINGS_CLIENT_SECRET = 'test-secret'
  process.env.WITHINGS_ENCRYPTION_KEY = 'ab'.repeat(32)
  process.env.APP_ORIGIN = 'https://gymbrain.example'
  const db = integrationDatabase(),
    provider = new WithingsProvider()
  let owner = 'alice',
    failPage = true,
    refreshes = 0,
    revoked = false
  provider.exchange = async () => ({
    access_token: 'first',
    refresh_token: 'refresh-1',
    expires_in: 10800,
    userid: '42',
    scope: 'user.metrics',
  })
  provider.refresh = async () => {
    refreshes++
    return { access_token: 'second', refresh_token: 'refresh-2', expires_in: 10800, userid: '42' }
  }
  provider.subscribe = async () => ({})
  provider.revoke = async (userid) => {
    assert.equal(userid, '42')
    revoked = true
    return {}
  }
  provider.measures = async (token, since, offset) => {
    assert.equal(token, 'second')
    assert.equal(since, 0)
    assert.equal(
      unseal(db.tables.withings_connections![0].tokens, 'alice').refresh_token,
      'refresh-2',
      'rotated token persisted before first use',
    )
    if (offset === 10 && failPage) {
      failPage = false
      throw Error('network interruption')
    }
    return {
      measuregrps: [
        {
          grpid: offset + 1,
          category: 1,
          date: 1700000000 + offset,
          measures: [{ type: 1, value: 75000, unit: -3 }],
        },
      ],
      more: offset === 0 ? 1 : 0,
      offset: 10,
    }
  }
  const app = createWithingsModule(
    (async () => ({ userId: owner, db: db.client, token: 'test' })) as any,
    (() => db.client) as any,
    provider,
  )
  const post = (path: string, body: any = {}) =>
    app.inject({ method: 'POST', url: path, payload: body })
  try {
    const start = (await post('/connect')).json()
    assert.match(start.url, /scope=user.metrics/)
    assert.equal(
      (await post('/callback', { state: start.state, code: 'auth-code' })).json().connected,
      true,
    )
    assert.equal(
      (await post('/callback', { state: start.state, code: 'auth-code' })).json().connected,
      false,
      'single-use callback',
    )
    const row = db.tables.withings_connections![0],
      tokens = unseal(row.tokens, 'alice')
    row.tokens = seal({ ...tokens, expiresAt: 0 }, 'alice')
    assert.equal((await post('/sync')).statusCode, 502)
    assert.equal(row.scan_offset, 10)
    assert.equal(row.last_cursor, 0, 'failure does not advance checkpoint')
    assert.equal((await post('/sync')).statusCode, 200)
    assert.equal(refreshes, 1)
    assert.equal(db.imported.length, 2)
    assert.ok(db.imported.every((r) => r.owner_id === 'alice'))
    assert.ok(row.last_cursor > 0)
    assert.equal(row.scan_offset, 0)
    const status = await app.inject('/status')
    assert.equal(status.json().connected, true)
    assert.ok(!status.body.includes('refresh'))
    assert.ok(!status.body.includes('webhook'))
    owner = 'bob'
    assert.equal((await app.inject('/status')).json().connected, false)
    await post('/disconnect')
    assert.equal(db.tables.withings_connections!.length, 1)
    owner = 'alice'
    assert.equal((await post('/disconnect')).statusCode, 200)
    assert.equal(revoked, true)
    assert.equal(db.tables.withings_connections!.length, 0)
  } finally {
    await app.close()
  }
})

test('Withings conversion, authenticated encryption and signed refresh protocol', async () => {
  const key = 'ab'.repeat(32),
    encrypted = seal({ refresh_token: 'private-token' }, 'alice', key)
  assert.ok(!encrypted.includes('private-token'))
  assert.equal(unseal(encrypted, 'alice', key).refresh_token, 'private-token')
  assert.throws(() => unseal(encrypted, 'bob', key))
  assert.throws(() => unseal(encrypted, 'alice', 'cd'.repeat(32)))
  const page = parseMeasures(
    {
      measuregrps: [
        {
          grpid: 123,
          category: 1,
          date: 1700000000,
          measures: [{ type: 1, value: 75420, unit: -3 }],
        },
        { grpid: 124, category: 2, date: 1700000000, measures: [{ type: 1, value: 70, unit: 0 }] },
      ],
      more: 1,
      offset: 10,
    },
    '42',
  )
  assert.equal(page.weights.length, 1)
  assert.deepEqual(page.weights[0], {
    kg: 75.42,
    measuredAt: '2023-11-14T22:13:20.000Z',
    source: 'withings',
    externalId: 'withings:42:123',
  })
  assert.equal(page.offset, 10)
  assert.throws(() => parseMeasures({ measuregrps: [], more: 1, offset: 0 }, '42'))
  process.env.WITHINGS_CLIENT_ID = 'test-client'
  process.env.WITHINGS_CLIENT_SECRET = 'test-secret'
  process.env.APP_ORIGIN = 'https://gymbrain.example'
  process.env.WITHINGS_ENCRYPTION_KEY = key
  assert.equal(configuration().configured, true)
  const calls: URLSearchParams[] = []
  const provider = new WithingsProvider((async (url: string, options: any) => {
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
    const p = new URLSearchParams(options.body)
    calls.push(p)
    const action = p.get('action')!
    const expected = createHmac('sha256', 'test-secret')
      .update(
        [action, 'test-client', p.get(action === 'getnonce' ? 'timestamp' : 'nonce')].join(','),
      )
      .digest('hex')
    assert.equal(p.get('signature'), expected)
    assert.ok(url.startsWith('https://wbsapi.withings.net/'))
    return Response.json({
      status: 0,
      body:
        action === 'getnonce'
          ? { nonce: 'unique-nonce' }
          : {
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_in: 10800,
              userid: 42,
            },
    })
  }) as typeof fetch)
  assert.equal((await provider.refresh('old-refresh')).refresh_token, 'new-refresh')
  assert.equal(calls[1]!.get('refresh_token'), 'old-refresh')
  assert.equal(calls[1]!.get('grant_type'), 'refresh_token')
  await assert.rejects(
    () =>
      new WithingsProvider((async () =>
        Response.json({ status: 401, error: 'secret-details' })) as typeof fetch).measures(
        'token',
        0,
        0,
      ),
    (e) => !String(e).includes('secret-details'),
  )
})

test('OAuth gateway binds callback to HttpOnly browser cookie and never forwards arbitrary redirects', async () => {
  const state = 'a'.repeat(64),
    calls: any[] = []
  const app = await createApp({
    transports: {
      withings: {
        async request(input) {
          calls.push(input)
          return {
            status: 200,
            body:
              input.path === '/connect'
                ? { url: 'https://account.withings.com/oauth2_user/authorize2', state }
                : { connected: true },
          }
        },
      },
    },
  })
  try {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/withings/connect' })).statusCode,
      401,
    )
    const start = await app.inject({
      method: 'POST',
      url: '/api/withings/connect',
      headers: { authorization: 'Bearer alice' },
    })
    assert.equal(start.json().state, undefined)
    assert.match(String(start.headers['set-cookie']), /HttpOnly; Secure; SameSite=Lax/)
    const count = calls.length
    const bad = await app.inject('/api/withings/callback?state=' + state + '&code=secret')
    assert.equal(bad.headers.location, '/?withings=error')
    assert.equal(calls.length, count)
    const success = await app.inject({
      url: '/api/withings/callback?state=' + state + '&code=secret&redirect=https://evil.example',
      headers: { cookie: '__Host-gymbrain-withings=' + state },
    })
    assert.equal(success.headers.location, '/?withings=connected')
    assert.match(String(success.headers['set-cookie']), /Max-Age=0/)
    assert.equal(
      (await app.inject({ method: 'HEAD', url: '/api/withings/webhook/' + state })).statusCode,
      204,
    )
  } finally {
    await app.close()
  }
})

test('Withings SQL: private state, exclusive leases, per-account idempotent import and retained deletions', async () => {
  const pg = new PGlite(),
    alice = '11111111-1111-4111-8111-111111111111',
    bob = '22222222-2222-4222-8222-222222222222'
  try {
    await pg.exec(
      `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select null::uuid$$; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$; insert into auth.users values('${alice}'),('${bob}');`,
    )
    for (const name of [
      '202610110001_core',
      '202610110002_server_authorization',
      '202610110003_withings',
    ])
      await pg.exec(await readFile('supabase/migrations/' + name + '.sql', 'utf8'))
    await pg.exec('set role authenticated')
    for (const table of ['withings_connections', 'withings_states', 'withings_leases'])
      await assert.rejects(() => pg.query('select * from public.' + table), /permission denied/)
    await assert.rejects(
      () => pg.query('select public.withings_acquire($1,$2)', [alice, crypto.randomUUID()]),
      /permission denied/,
    )
    await assert.rejects(
      () => pg.query('select public.tracking_import_weight($1,$2)', [alice, {}]),
      /permission denied/,
    )
    await pg.exec('reset role; set role service_role')
    const lease = crypto.randomUUID()
    const acquire = async (owner: string, id: string) =>
      (await pg.query<any>('select public.withings_acquire($1,$2) as locked', [owner, id])).rows[0]
        .locked
    assert.equal(await acquire(alice, lease), true)
    assert.equal(await acquire(alice, crypto.randomUUID()), false)
    assert.equal(await acquire(alice, lease), true)
    assert.equal(await acquire(bob, crypto.randomUUID()), true)
    const payload = {
      kg: 75.42,
      measuredAt: '2026-10-11T10:00:00.000Z',
      source: 'withings',
      externalId: 'withings:42:123',
    }
    const save = async (owner: string, data = payload) =>
      (await pg.query<any>('select public.tracking_import_weight($1,$2) as changed', [owner, data]))
        .rows[0].changed
    assert.equal(await save(alice), true)
    assert.equal(await save(alice), false)
    assert.equal(await save(bob), true)
    assert.equal(await save(alice, { ...payload, kg: 76 }), true)
    assert.equal(
      (await pg.query<any>('select version from public.tracking_records where user_id=$1', [alice]))
        .rows[0].version,
      2,
    )
    await pg.query('update public.tracking_records set deleted=true where user_id=$1', [alice])
    assert.equal(await save(alice), false)
    assert.equal(
      (await pg.query<any>('select payload from public.tracking_records where user_id=$1', [bob]))
        .rows[0].payload.kg,
      75.42,
    )
  } finally {
    await pg.close()
  }
})
