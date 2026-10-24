import 'fake-indexeddb/auto'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { db, GymDB, saveRecord, acknowledge, resolveConflict } from '../app/lib/store.ts'
import Dexie from 'dexie'
import { snapshotSession, type LocalRecord } from '../shared/domain.ts'
after(async () => db.delete())

test('Offline catalog migration preserves queued retry bytes and upgrades existing cache', async () => {
  const name = 'migration-' + crypto.randomUUID(),
    old = new Dexie(name)
  old
    .version(1)
    .stores({
      records: '[user_id+id],user_id,[user_id+kind]',
      queue: '++seq,owner,[owner+module]',
      meta: 'key',
    })
  const row = {
    id: crypto.randomUUID(),
    user_id: 'alice',
    kind: 'exercise',
    module: 'training',
    parent_id: null,
    payload: {
      name: 'Pull-up',
      description: '',
      notes: '',
      mode: 'weighted',
      videoUrl: '',
      videoPath: '',
    },
    version: 2,
    revision: 4,
    localRevision: 3,
    deleted: false,
    dirty: true,
    updated_at: new Date().toISOString(),
  }
  const operation = {
    owner: 'alice',
    module: 'training',
    localRevision: 3,
    mutation: {
      operationId: crypto.randomUUID(),
      id: row.id,
      kind: 'exercise',
      parentId: null,
      baseVersion: 2,
      payload: row.payload,
      deleted: false,
    },
  }
  await old.table('records').put(row)
  await old.table('queue').add(operation)
  const before = await old.table('queue').toArray()
  old.close()
  const upgraded = new GymDB(name)
  try {
    const record = await upgraded.records.get(['alice', row.id])
    assert.equal((record!.payload as any).exerciseType, 'bodyweight')
    assert.deepEqual((record!.payload as any).variants, [])
    assert.equal(record!.localRevision, 3)
    assert.deepEqual(await upgraded.queue.toArray(), before)
  } finally {
    await upgraded.delete()
  }
})
test('Atomic local queue, isolation, immutable retry payload and acknowledgement during edits', async () => {
  const payload = {
    name: 'Pull-up',
    description: '',
    notes: '',
    mode: 'bodyweight' as const,
    videoUrl: '',
    videoPath: '',
  }
  const a = await saveRecord('alice', 'exercise', payload),
    ops = await db.queue.where('owner').equals('alice').toArray()
  assert.equal(ops.length, 1)
  assert.equal(ops[0]!.mutation.baseVersion, 0)
  await saveRecord('bob', 'exercise', { ...payload, name: 'Private' })
  assert.equal((await db.records.where('user_id').equals('alice').toArray()).length, 1)
  const edited = await saveRecord(
    'alice',
    'exercise',
    { ...payload, name: 'Updated' },
    { id: a.id, expectedRevision: 1 },
  )
  assert.equal((await db.queue.get(ops[0]!.seq!))!.mutation.payload.name, 'Pull-up')
  await acknowledge('alice', ops[0]!, { ...a, version: 1, revision: 1 })
  const local = await db.records.get(['alice', a.id])
  assert.equal((local!.payload as any).name, 'Updated')
  assert.equal(local!.dirty, true)
  const next = (await db.queue.where('owner').equals('alice').toArray())[0]!
  assert.equal(next.mutation.baseVersion, 1)
  await assert.rejects(
    () => saveRecord('alice', 'exercise', payload, { id: a.id, expectedRevision: 1 }),
    /altra finestra|altra|finestra/,
  )
  await db.records.update(['alice', a.id], {
    conflict: { ...a, version: 4, payload: { ...payload, name: 'Remote' } },
  })
  await resolveConflict('alice', a.id, true)
  const resolved = (await db.queue.where('owner').equals('alice').toArray())[0]!
  assert.equal(resolved.mutation.baseVersion, 4)
  assert.equal((resolved.mutation.payload as any).name, 'Updated')
  assert.notEqual(resolved.mutation.operationId, next.mutation.operationId)
  assert.equal(edited.localRevision, 2)
})
test('Sessions snapshot targets, leave perceived values empty and preserve original exercise', () => {
  const row = {
    id: crypto.randomUUID(),
    parent_id: crypto.randomUUID(),
    payload: {
      name: 'Upper',
      notes: '',
      order: 0,
      exercises: [
        {
          id: crypto.randomUUID(),
          exerciseId: crypto.randomUUID(),
          name: 'Pull-up',
          notes: 'Explosive',
          mode: 'weighted',
          band: '',
          alternatives: [],
          sets: [{ reps: 6, rpe: 8, rir: 2, tut: null, load: 10 }],
        },
      ],
    },
  } as LocalRecord
  const session = snapshotSession(row, 74.8)
  ;(row.payload as any).exercises[0].sets[0].reps = 12
  assert.equal(session.exercises[0]!.targetSets[0]!.reps, 6)
  assert.equal(session.exercises[0]!.actual[0]!.rpe, null)
  assert.equal(session.exercises[0]!.originalName, 'Pull-up')
  assert.equal(session.bodyWeight, 74.8)
})

test('Account creation requires connectivity; cached edits and workout progress survive offline', async () => {
  const owner = 'offline-policy';
  const original = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  const payload = {
    name: 'Push',
    notes: '',
    description: '',
    exerciseType: 'bodyweight' as const,
    variants: [],
    videoUrl: '',
  };
  const row = await saveRecord(owner, 'exercise', payload);
  const workout = await saveRecord(owner, 'workout', {
    name: 'Monday',
    notes: '',
    order: 0,
    exercises: [
      {
        id: crypto.randomUUID(),
        exerciseId: row.id,
        name: 'Push',
        notes: '',
        mode: 'bodyweight',
        exerciseType: 'bodyweight',
        measurement: 'reps',
        variant: null,
        assistance: [],
        band: '',
        alternatives: [],
        sets: [{ reps: 8, load: null, rpe: null, rir: null, tut: null }],
      },
    ],
  });
  try {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await assert.rejects(saveRecord(owner, 'exercise', payload), /connessione/);
    await assert.rejects(
      saveRecord(owner, 'cycle', { name: 'New', notes: '', start: '2026-10-24', weeks: 4 }),
      /connessione/,
    );
    const updated = await saveRecord(
      owner,
      'exercise',
      { ...payload, notes: 'Offline edit' },
      { id: row.id },
    );
    assert.equal(updated.dirty, true);
    const session = snapshotSession({ ...workout, parent_id: crypto.randomUUID() }, 75);
    session.exercises[0]!.actual[0]!.reps = 8;
    session.exercises[0]!.actual[0]!.done = true;
    const progress = await saveRecord(owner, 'session', session);
    assert.equal((await db.records.get([owner, progress.id]))?.dirty, true);
    assert.ok(
      (await db.queue.where('owner').equals(owner).toArray()).some((op) => op.mutation.id === progress.id),
    );
  } finally {
    if (original) Object.defineProperty(navigator, 'onLine', original);
    else Reflect.deleteProperty(navigator, 'onLine');
  }
});
