// Explicit live check. Creates two marked test accounts without sending email,
// exercises the real API, then removes only those accounts and their test rows.
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { createApp } from '../backend/app.ts'
if (process.env.RUN_LIVE_TESTS !== 'yes')
  throw new Error('Set RUN_LIVE_TESTS=yes to run the isolated cloud check')
const url = process.env.SUPABASE_URL!,
  secret = process.env.SUPABASE_SECRET_KEY!,
  key = process.env.SUPABASE_PUBLISHABLE_KEY!
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }),
  run = crypto.randomUUID(),
  created: string[] = [],
  app = await createApp()
try {
  const people = []
  for (const label of ['alice', 'bob']) {
    const email = `gymbrain-test-${run}-${label}@example.com`,
      password = crypto.randomUUID() + 'G!7a'
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { gymbrain_test_run: run },
    })
    if (error) throw error
    created.push(data.user.id)
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await client.auth.signInWithPassword({ email, password })
    if (signed.error) throw signed.error
    people.push({ id: data.user.id, token: signed.data.session!.access_token, client })
  }
  const [alice, bob] = people,
    record = crypto.randomUUID(),
    operationId = crypto.randomUUID()
  const mutation = {
    operationId,
    id: record,
    kind: 'exercise',
    parentId: null,
    baseVersion: 0,
    payload: {
      name: 'Isolated cloud test',
      description: '',
      notes: '',
      mode: 'bodyweight',
      videoUrl: '',
      videoPath: '',
    },
    deleted: false,
  }
  const send = (token: string, body: any) =>
    app.inject({
      method: 'POST',
      url: '/api/training/mutations',
      headers: { authorization: 'Bearer ' + token },
      payload: body,
    })
  const response = await send(alice!.token, mutation)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().record.user_id, alice!.id)
  assert.deepEqual((await send(alice!.token, mutation)).json(), response.json())
  const query = (token: string) =>
    app.inject({ url: '/api/training/records?after=0', headers: { authorization: 'Bearer ' + token } })
  assert.equal((await query(alice!.token)).json().records.length, 1)
  assert.equal((await query(bob!.token)).json().records.length, 0)
  const forged = await send(bob!.token, { ...mutation, operationId: crypto.randomUUID(), baseVersion: 1 })
  assert.equal(forged.statusCode, 409)
  assert.equal(forged.json().record, null)
  assert.equal((await send(alice!.token, { ...mutation, user_id: bob!.id })).statusCode, 400)
  const direct = await alice!.client.from('training_records').select('*')
  assert.ok(direct.error, 'Authenticated browser must not query the DB directly')
  assert.equal(
    (await app.inject({ url: '/api/training/records', headers: { authorization: 'Bearer invalid' } }))
      .statusCode,
    401,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/media/download-url',
        headers: { authorization: 'Bearer ' + bob!.token },
        payload: { path: alice!.id + '/' + crypto.randomUUID() + '.mp4' },
      })
    ).statusCode,
    403,
  )
  console.log(
    'PASS: real Supabase auth, server-scoped writes/reads, isolation, retry, forged owner rejection, direct DB denial, media isolation.',
  )
} finally {
  for (const id of created) {
    const { data, error } = await admin.auth.admin.getUserById(id)
    if (error) throw error
    if (data.user.app_metadata.gymbrain_test_run !== run) throw new Error('Test cleanup ownership mismatch')
    const removed = await admin.auth.admin.deleteUser(id)
    if (removed.error) throw removed.error
  }
  await app.close()
  console.log('Temporary test accounts and rows removed.')
}
