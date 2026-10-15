import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validSignature, normalize, WhoopProvider } from '../backend/whoop/provider.ts';
import { recoveryBefore, overlappingWorkouts, sleepHours } from '../shared/whoop.ts';
import { createApp } from '../backend/app.ts';

test('WHOOP validates exact signed bytes, rejects tampering and replay', () => {
  const raw = JSON.stringify({ user_id: 1, type: 'sleep.updated' }),
    now = Date.now(),
    time = String(now),
    secret = 'test-secret';
  const signature = createHmac('sha256', secret)
    .update(time + raw)
    .digest('base64');
  assert.equal(validSignature(raw, time, signature, secret, now), true);
  assert.equal(validSignature(raw + ' ', time, signature, secret, now), false);
  assert.equal(validSignature(raw, time, signature, secret, now + 300001), false);
  assert.equal(validSignature(raw, time, signature, '', now), false);
});
test('WHOOP data cannot be assigned to another provider identity; missing sleep is not zero', () => {
  const raw = { id: 'abc', user_id: 2, start: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T11:00:00Z' };
  assert.throws(() => normalize('workout', raw, '1'));
  assert.equal(normalize('workout', raw, '2').provider_id, 'abc');
  assert.equal(sleepHours(), null);
});
test('WHOOP prior sleep selection excludes future sleep and flags rescoring; activity overlap is bounded', () => {
  const rec = (kind: any, id: string, payload: any): any => ({
    kind,
    provider_id: id,
    measured_at: payload.start,
    provider_updated_at: payload.updated_at,
    payload,
  });
  const records = [
    rec('sleep', 'before', {
      end: '2026-10-11T07:00:00Z',
      score_state: 'SCORED',
      nap: false,
      score: {
        stage_summary: {
          total_light_sleep_time_milli: 3600000,
          total_slow_wave_sleep_time_milli: 3600000,
          total_rem_sleep_time_milli: 3600000,
        },
      },
    }),
    rec('sleep', 'future', { end: '2026-10-12T07:00:00Z', score_state: 'SCORED' }),
    rec('recovery', '1', {
      sleep_id: 'before',
      created_at: '2026-10-11T07:01:00Z',
      updated_at: '2026-10-11T15:00:00Z',
      score_state: 'SCORED',
    }),
    rec('workout', 'during', { start: '2026-10-11T10:10:00Z', end: '2026-10-11T10:50:00Z' }),
    rec('workout', 'after', { start: '2026-10-11T11:00:00Z', end: '2026-10-11T12:00:00Z' }),
  ];
  const result = recoveryBefore(records, '2026-10-11T10:00:00Z');
  assert.equal(result.sleep?.provider_id, 'before');
  assert.equal(result.rescored, true);
  assert.equal(sleepHours(result.sleep), 3);
  assert.deepEqual(
    overlappingWorkouts(records, '2026-10-11T10:00:00Z', '2026-10-11T11:00:00Z').map((r) => r.provider_id),
    ['during'],
  );
  assert.equal(recoveryBefore(records, '2026-10-15T10:00:00Z').sleep, undefined);
});
test('WHOOP v2 collection pagination preserves opaque cursors and respects 429', async () => {
  let observed = '';
  const provider = new WhoopProvider(async (url) => {
    observed = String(url);
    return new Response(JSON.stringify({ records: [], next_token: 'next' }), { status: 200 });
  });
  assert.equal(
    (await provider.page('sleep', 'private', { end: '2026-10-11T10:00:00Z', next: 'a+b&c' })).next_token,
    'next',
  );
  assert.equal(new URL(observed).searchParams.get('nextToken'), 'a+b&c');
  const limited = new WhoopProvider(
    async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
  );
  await assert.rejects(
    () => limited.page('cycle', 'private', { end: new Date().toISOString() }),
    (e: any) => e.statusCode === 429 && e.retryAfter === 120,
  );
});
test('WHOOP migration denies client grants and serializes owner leases', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('11111111-1111-4111-8111-111111111111');`,
    );
    await pg.exec(await readFile('supabase/migrations/202610120005_whoop.sql', 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      const r = await pg.query<any>(
        `select has_table_privilege('${role}','public.whoop_records','SELECT,INSERT,UPDATE,DELETE') as allowed, has_function_privilege('${role}','public.whoop_acquire(uuid,uuid)','EXECUTE') as rpc`,
      );
      assert.deepEqual(r.rows[0], { allowed: false, rpc: false });
    }
    await pg.exec('set role service_role;');
    const call = (lease: string) =>
      pg.query<any>(`select whoop_acquire('11111111-1111-4111-8111-111111111111',$1) as acquired`, [lease]);
    assert.equal((await call('22222222-2222-4222-8222-222222222222')).rows[0].acquired, true);
    assert.equal((await call('33333333-3333-4333-8333-333333333333')).rows[0].acquired, false);
  } finally {
    await pg.close();
  }
});
test('WHOOP gateway enforces browser state and validates raw webhook before forwarding', async () => {
  const previous = process.env.WHOOP_CLIENT_SECRET;
  process.env.WHOOP_CLIENT_SECRET = 'test-only';
  let called = 0;
  const app = await createApp({
    transports: {
      whoop: {
        async request(r) {
          called++;
          return {
            status: 200,
            body:
              r.path === '/connect'
                ? { url: 'https://api.prod.whoop.com/oauth/oauth2/auth', state: 'a'.repeat(64) }
                : { connected: true },
          };
        },
      },
    },
  });
  try {
    assert.equal((await app.inject('/api/whoop/status')).statusCode, 401);
    assert.match(
      (await app.inject('/api/whoop/callback?state=' + 'a'.repeat(64) + '&code=code')).headers.location!,
      /error/,
    );
    assert.equal(called, 0);
    const connected = await app.inject({
      method: 'POST',
      url: '/api/whoop/connect',
      headers: { authorization: 'Bearer test' },
      payload: {},
    });
    assert.match(String(connected.headers['set-cookie']), /HttpOnly; Secure; SameSite=Lax/);
    assert.equal(connected.json().state, undefined);
    const body = '{"user_id":1}',
      time = String(Date.now()),
      sig = createHmac('sha256', 'test-only')
        .update(time + body)
        .digest('base64');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/whoop/webhook',
          headers: {
            'content-type': 'application/json',
            'x-whoop-signature-timestamp': time,
            'x-whoop-signature': sig,
          },
          payload: body + ' ',
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/whoop/webhook',
          headers: {
            'content-type': 'application/json',
            'x-whoop-signature-timestamp': time,
            'x-whoop-signature': sig,
          },
          payload: body,
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.WHOOP_CLIENT_SECRET;
    else process.env.WHOOP_CLIENT_SECRET = previous;
  }
});
