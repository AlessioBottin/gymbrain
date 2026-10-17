import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  muscleTargetsSchema,
  planSchema,
  exerciseSchema,
  snapshotSession,
  type LocalRecord,
} from '../shared/domain.ts';
import { effectiveTargets, makePrescription, volume, freezeTargets } from '../shared/volume.ts';
import { db, saveRecord, savePlanWorkouts } from '../app/lib/store.ts';
after(() => db.delete());
const exercise = (name: string, muscleTargets: object): LocalRecord =>
  ({
    id: crypto.randomUUID(),
    payload: exerciseSchema.parse({
      name,
      notes: '',
      description: '',
      exerciseType: 'bodyweight',
      variants: [],
      videoUrl: '',
      muscleTargets,
    }),
  }) as LocalRecord;
test('Personal coefficients accept tenths including zero, reject unsupported groups and extra decimals', () => {
  for (const n of [0, 0.1, 0.3, 0.5, 1])
    assert.equal(muscleTargetsSchema.safeParse({ triceps: n }).success, true);
  for (const n of [-0.1, 1.1, 0.25, NaN])
    assert.equal(muscleTargetsSchema.safeParse({ triceps: n }).success, false);
  assert.equal(muscleTargetsSchema.safeParse({ unknown: 1 }).success, false);
});
test('Push up + HSPU: two sets chest, shoulders and triceps; warmup excluded', () => {
  const push = makePrescription(exercise('Push up', { chest: 1, triceps: 0.5 }));
  const hspu = makePrescription(exercise('HSPU', { frontSideDelts: 1, triceps: 0.5 }));
  push.sets.push({ ...push.sets[0]! });
  hspu.sets.push({ ...hspu.sets[0]! });
  const total = volume([push, hspu]);
  assert.equal(total.chest, 2);
  assert.equal(total.frontSideDelts, 2);
  assert.equal(total.triceps, 2);
  push.sets[0]!.countVolume = false;
  assert.equal(volume([push, hspu]).triceps, 1.5);
});
test('Variants inherit unspecified muscles and can explicitly override to zero; snapshots stay stable', () => {
  assert.deepEqual(effectiveTargets({ chest: 1, triceps: 0.5 }, { triceps: 0 }), { chest: 1, triceps: 0 });
  const row = exercise('Push', { chest: 1, triceps: 0.5 });
  const p = makePrescription(row);
  const variant = { id: crypto.randomUUID(), name: 'Variant', notes: '', muscleTargets: { triceps: 0 } };
  (row.payload as any).variants.push(variant);
  p.variant = variant;
  const frozen = freezeTargets(p, [row]);
  (row.payload as any).muscleTargets.chest = 0.5;
  assert.equal(volume([p], [row]).chest, 0.5);
  assert.equal(volume([frozen]).chest, 1);
  assert.equal(volume([frozen]).triceps, 0);
});
test('Plan periods reject inverted or partial ranges and retain legacy plans', () => {
  const base = { name: 'Plan', notes: '', order: 0 };
  assert.ok(planSchema.safeParse(base).success);
  assert.ok(planSchema.safeParse({ ...base, start: '2026-10-01', end: '2026-10-31' }).success);
  assert.ok(!planSchema.safeParse({ ...base, start: '2026-10-31', end: '2026-10-01' }).success);
  assert.ok(!planSchema.safeParse({ ...base, start: '2026-10-01' }).success);
});
test('Builder commits all days and outbox entries atomically, rolls back on stale revision', async () => {
  const owner = 'builder-test';
  const cycle = await saveRecord(owner, 'cycle', { name: 'Cycle', notes: '', start: '2026-10-01', weeks: 6 });
  const plan = await saveRecord(owner, 'plan', { name: 'Plan', notes: '', order: 0 }, { parentId: cycle.id });
  const payload = {
    name: 'Monday',
    notes: '',
    order: 0,
    exercises: [makePrescription(exercise('Push', { chest: 1 }))],
  };
  const day = await saveRecord(owner, 'workout', payload, { parentId: plan.id });
  const fresh = crypto.randomUUID();
  const before = await db.queue.count();
  await assert.rejects(
    savePlanWorkouts(owner, plan.id, [
      { id: fresh, payload },
      { id: day.id, revision: 0, payload },
    ]),
    /altra finestra/,
  );
  assert.equal(await db.records.get([owner, fresh]), undefined);
  assert.equal(await db.queue.count(), before);
  await savePlanWorkouts(owner, plan.id, [
    { id: fresh, payload },
    { id: day.id, revision: day.localRevision, payload },
  ]);
  assert.equal(await db.queue.count(), before + 2);
  const session = snapshotSession(day, null);
  assert.equal(session.exercises[0]!.muscleTargets?.chest, 1);
});
