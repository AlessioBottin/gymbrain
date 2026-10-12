import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const alice = '11111111-1111-4111-8111-111111111111',
  bob = '22222222-2222-4222-8222-222222222222',
  cycle = '33333333-3333-4333-8333-333333333333'
test('SQL migration chain: server-only grants, owner scoping, hierarchy, retries and conflicts', async () => {
  const pg = new PGlite()
  try {
    await pg.exec(
      `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security; create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$; insert into auth.users values('${alice}'),('${bob}');`,
    )
    await pg.exec(await readFile('supabase/migrations/202610110001_core.sql', 'utf8'))
    await pg.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);`,
    )
    const call = async (
      id: string,
      base: number,
      name: string,
      op = crypto.randomUUID(),
      parent: string | null = null,
      kind = 'cycle',
    ) => {
      const { rows } = await pg.query<{ value: any }>(
        `select public.training_apply($1,$2,$3,$4,$5,$6,false) as value`,
        [op, id, kind, parent, base, { name, notes: '', start: '2026-10-11', weeks: 6 }],
      )
      return rows[0]!.value
    }
    const op = crypto.randomUUID(),
      first = await call(cycle, 0, 'Forza', op)
    assert.equal(first.record.user_id, alice)
    assert.equal(first.record.version, 1)
    assert.deepEqual(await call(cycle, 0, 'Forza', op), first, 'retry returns same receipt')
    await assert.rejects(() => call(cycle, 0, 'Changed payload', op), /Operation ID already used/)
    const second = await call(cycle, 1, 'Forza 2')
    assert.equal(second.record.version, 2)
    assert.ok(second.record.revision > first.record.revision)
    const conflict = await call(cycle, 1, 'Outdated')
    assert.equal(conflict.conflict, true)
    assert.equal(conflict.record.payload.name, 'Forza 2')
    await assert.rejects(
      () => pg.exec(`update public.training_records set payload='{}' where id='${cycle}'`),
      /permission denied/,
    )
    await pg.exec(`select set_config('request.jwt.claim.sub','${bob}',false)`)
    assert.equal((await pg.query('select * from public.training_records')).rows.length, 0)
    await assert.rejects(
      () => call(crypto.randomUUID(), 0, 'Invalid plan', undefined, cycle, 'plan'),
      /Invalid parent/,
    )
    const other = await call(cycle, 0, 'Bob private')
    assert.equal(other.record.user_id, bob)
    await pg.exec(`select set_config('request.jwt.claim.sub','${alice}',false)`)
    assert.equal(
      (await pg.query<any>('select payload from public.training_records')).rows[0].payload.name,
      'Forza 2',
    )
    await pg.exec('reset role; set role anon;')
    await assert.rejects(
      () => pg.query('select * from public.training_records'),
      /permission denied/,
    )
    await assert.rejects(() => call(cycle, 0, 'anon'), /permission denied/)
    await pg.exec('reset role;')
    await pg.exec(
      await readFile('supabase/migrations/202610110002_server_authorization.sql', 'utf8'),
    )
    await pg.exec('set role authenticated;')
    await assert.rejects(
      () => pg.query('select * from public.training_records'),
      /permission denied/,
    )
    await assert.rejects(() => call(cycle, 2, 'Bypass legacy endpoint'), /permission denied/)
    await assert.rejects(
      () =>
        pg.query("select public.training_server_apply($1,$2,$3,'cycle',null,0,'{}',false)", [
          bob,
          crypto.randomUUID(),
          crypto.randomUUID(),
        ]),
      /permission denied/,
    )
    await pg.exec('reset role; set role service_role;')
    const result = await pg.query<any>(
      "select public.training_server_apply($1,$2,$3,'cycle',null,2,$4,false) as value",
      [alice, crypto.randomUUID(), cycle, { name: 'Server-scoped update' }],
    )
    assert.equal(result.rows[0].value.record.user_id, alice)
    assert.equal(result.rows[0].value.record.version, 3)
    assert.equal(
      (await pg.query<any>('select payload from public.training_records where user_id=$1', [bob]))
        .rows[0].payload.name,
      'Bob private',
    )
    const legacyId = crypto.randomUUID(),
      legacy = {
        name: 'Panca',
        mode: 'external',
        description: 'Descrizione',
        notes: 'Da conservare',
        videoUrl: 'https://example.com/video',
        videoPath: '',
      }
    await pg.query(
      "insert into public.training_records(user_id,id,kind,payload) values($1,$2,'exercise',$3)",
      [alice, legacyId, legacy],
    )
    const historical = {
      exercises: [{ name: 'Pull-up', mode: 'weighted', band: '', actual: [{ load: 12 }] }],
    }
    await pg.query(
      "insert into public.tracking_records(user_id,id,kind,payload) values($1,$2,'session',$3)",
      [alice, crypto.randomUUID(), historical],
    )
    await pg.exec('reset role')
    await pg.exec(await readFile('supabase/migrations/202610110004_exercise_variants.sql', 'utf8'))
    const migrated = (
      await pg.query<any>('select * from public.training_records where user_id=$1 and id=$2', [
        alice,
        legacyId,
      ])
    ).rows[0]
    assert.equal(migrated.payload.mode, undefined)
    assert.equal(migrated.payload.exerciseType, 'weights')
    assert.deepEqual(migrated.payload.variants, [])
    assert.equal(migrated.payload.notes, legacy.notes)
    assert.equal(migrated.payload.videoUrl, legacy.videoUrl)
    assert.equal(migrated.version, 2)
    assert.deepEqual(
      (
        await pg.query<any>(
          'select original_record from public.catalog_v2_backup where user_id=$1',
          [alice],
        )
      ).rows[0].original_record.payload,
      legacy,
    )
    assert.deepEqual(
      (await pg.query<any>("select payload from public.tracking_records where kind='session'"))
        .rows[0].payload,
      historical,
    )
    await pg.exec('set role service_role')
    await pg.query('update public.training_records set payload=$1 where user_id=$2 and id=$3', [
      { ...legacy, mode: 'weighted' },
      alice,
      legacyId,
    ])
    assert.equal(
      (
        await pg.query<any>(
          'select payload from public.training_records where user_id=$1 and id=$2',
          [alice, legacyId],
        )
      ).rows[0].payload.exerciseType,
      'bodyweight',
    )
    await pg.exec('reset role; set role authenticated')
    await assert.rejects(
      () => pg.query('select * from public.catalog_v2_backup'),
      /permission denied/,
    )
  } finally {
    await pg.close()
  }
})
