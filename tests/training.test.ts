import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newTarget,
  targetSchema,
  workoutSchema,
  snapshotSession,
  validRecordedSet,
  type Prescription,
  type LocalRecord,
} from '../shared/domain.ts';
import { trainingSequence, nextTrainingStep } from '../shared/training.ts';
import { volume } from '../shared/volume.ts';
function exercise(name: string): Prescription {
  return {
    id: crypto.randomUUID(),
    exerciseId: crypto.randomUUID(),
    name,
    notes: '',
    mode: 'external',
    exerciseType: 'weights',
    variant: null,
    muscleTargets: { chest: 1 },
    assistance: [],
    band: '',
    alternatives: [],
    sets: [newTarget(), newTarget()],
  };
}
test('Jump alternates A/rest/B/rest for N rounds; superset rests only at end of round', () => {
  const a = exercise('A'),
    b = exercise('B');
  const group = { id: crypto.randomUUID(), type: 'jump' as const, restSeconds: 60 };
  a.group = { ...group };
  b.group = { ...group };
  assert.deepEqual(trainingSequence([a, b]), [
    { exercise: 0, set: 0, restSeconds: 60 },
    { exercise: 1, set: 0, restSeconds: 60 },
    { exercise: 0, set: 1, restSeconds: 60 },
    { exercise: 1, set: 1, restSeconds: 60 },
  ]);
  a.group.type = b.group.type = 'superset';
  assert.deepEqual(
    trainingSequence([a, b]).map((s) => s.restSeconds),
    [0, 60, 0, 60],
  );
  b.sets.pop();
  assert.deepEqual(
    trainingSequence([a, b]).map((s) => s.restSeconds),
    [0, 60, 60],
  );
});
test('Invalid isolated or inconsistent groups are rejected', () => {
  const a = exercise('A'),
    b = exercise('B');
  a.group = { id: crypto.randomUUID(), type: 'jump', restSeconds: 60 };
  const workout = { name: 'Day', notes: '', order: 0, exercises: [a, b] };
  assert.equal(workoutSchema.safeParse(workout).success, false);
  b.group = { ...a.group, restSeconds: 90 };
  assert.equal(workoutSchema.safeParse(workout).success, false);
  b.group.restSeconds = 60;
  assert.equal(workoutSchema.safeParse(workout).success, true);
});
test('Cluster/drop pass validation, snapshot, progress and volume count the whole set once', () => {
  const a = exercise('A');
  a.sets = [
    {
      ...newTarget(),
      technique: 'cluster',
      segments: [
        { reps: 4, tut: null, load: 50, restSeconds: 20 },
        { reps: 4, tut: null, load: 50 },
      ],
    },
  ];
  const row = {
    id: crypto.randomUUID(),
    parent_id: crypto.randomUUID(),
    payload: { name: 'Day', notes: '', order: 0, exercises: [a] },
  } as LocalRecord;
  const session = snapshotSession(row, 75),
    actual = session.exercises[0]!.actual[0]!;
  assert.equal(actual.segments![0]!.reps, null);
  assert.equal(actual.segments![0]!.restSeconds, 20);
  assert.equal(validRecordedSet(actual), false);
  for (const part of actual.segments!) {
    part.reps = 4;
    part.done = true;
  }
  assert.equal(validRecordedSet(actual), true);
  assert.equal(nextTrainingStep(session)?.exercise, 0);
  actual.done = true;
  assert.equal(nextTrainingStep(session), undefined);
  assert.equal(volume([a]).chest, 1);
  assert.equal(targetSchema.safeParse({ ...newTarget(), technique: 'cluster' }).success, false);
  const drop = { ...a.sets[0]!, technique: 'drop' as const };
  drop.segments![1]!.load = 60;
  assert.equal(targetSchema.safeParse(drop).success, false);
  drop.segments![1]!.load = 40;
  assert.equal(targetSchema.safeParse(drop).success, true);
});
