import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, saveRecord } from '../app/lib/store.ts';
import { snapshotSession, mutationSchema, type LocalRecord } from '../shared/domain.ts';
after(() => db.delete());

test('Partial workouts enforce positive reps or duration on both local saves and API mutations', async () => {
  const row = {
    id: crypto.randomUUID(),
    parent_id: crypto.randomUUID(),
    payload: {
      name: 'Test',
      notes: '',
      order: 0,
      exercises: [
        {
          id: crypto.randomUUID(),
          exerciseId: crypto.randomUUID(),
          name: 'Plank',
          notes: '',
          mode: 'bodyweight',
          measurement: 'duration',
          band: '',
          alternatives: [],
          sets: Array.from({ length: 3 }, () => ({ reps: null, tut: 30, load: null, rpe: null, rir: null })),
        },
      ],
    },
  } as LocalRecord;
  const session = snapshotSession(row, null);
  session.completedAt = new Date().toISOString();
  const mutation = {
    operationId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    kind: 'session',
    parentId: null,
    baseVersion: 0,
    payload: session,
    deleted: false,
  };
  assert.equal(mutationSchema.safeParse(mutation).success, false);
  const set = session.exercises[0]!.actual[0]!;
  set.done = true;
  set.tut = 25;
  assert.equal(mutationSchema.safeParse(mutation).success, true);
  await saveRecord('local', 'session', session);
  assert.equal(session.exercises[0]!.actual.filter((s) => s.done).length, 1);
  set.tut = 0;
  assert.equal(mutationSchema.safeParse(mutation).success, false);
  await assert.rejects(saveRecord('local', 'session', session), /positive/);
  session.exercises[0]!.measurement = 'reps';
  set.tut = 25;
  for (const value of [null, 0, 1.5]) {
    set.reps = value;
    assert.equal(mutationSchema.safeParse(mutation).success, false);
  }
  set.reps = 5;
  assert.equal(mutationSchema.safeParse(mutation).success, true);
});
