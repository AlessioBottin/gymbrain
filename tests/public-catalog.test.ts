import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicCatalogModule } from '../backend/modules/publicCatalog.ts';
import { publicExercise } from '../shared/publicCatalog.ts';
import { exerciseSchema } from '../shared/domain.ts';

const payload = {
  name: 'Pull-up',
  description: 'Trazione',
  notes: 'Personal note',
  exerciseType: 'bodyweight',
  measurement: 'reps',
  videoUrl: '',
  videoPath: 'private/file.mp4',
  isPublic: true,
  muscleTargets: { lats: 1 },
  variants: [
    { id: crypto.randomUUID(), name: 'Wide', notes: 'Private variant note', muscleTargets: { biceps: 0.5 } },
  ],
};
test('Public projection excludes private data and retains usable variants and muscle targets', () => {
  const projected = publicExercise({ id: crypto.randomUUID(), payload });
  assert.equal(projected.name, 'Pull-up');
  assert.deepEqual(projected.muscleTargets, { lats: 1 });
  assert.equal(projected.variants[0]!.muscleTargets!.biceps, 0.5);
  for (const secret of ['Personal note', 'Private variant note', 'private/file.mp4', 'videoPath', 'user_id'])
    assert.ok(!JSON.stringify(projected).includes(secret));
  assert.equal(exerciseSchema.parse(payload).isPublic, true);
  const { isPublic, ...privatePayload } = payload;
  assert.equal(exerciseSchema.parse(privatePayload).isPublic, undefined);
});
test('Shared catalog requires authentication', async () => {
  const app = createPublicCatalogModule();
  try {
    assert.equal((await app.inject('/exercises')).statusCode, 401);
  } finally {
    await app.close();
  }
});
test('Shared catalog only queries published active exercises and paginates', async () => {
  const filters: any[] = [];
  const query: any = {
    select: (fields: string) => {
      assert.equal(fields, 'id,payload');
      return query;
    },
    eq: (...args: any[]) => {
      filters.push(args);
      return query;
    },
    order: (column: string) => {
      assert.equal(column, 'id');
      return query;
    },
    range: async (start: number, end: number) => {
      assert.equal(start, 100);
      assert.equal(end, 200);
      return { data: Array.from({ length: 101 }, () => ({ id: crypto.randomUUID(), payload })), error: null };
    },
  };
  const app = createPublicCatalogModule(async () => ({
    userId: 'reader',
    token: 'valid',
    db: {
      from: (table: string) => {
        assert.equal(table, 'training_records');
        return query;
      },
    } as any,
  }));
  try {
    const response = await app.inject('/exercises?page=1');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(filters, [
      ['kind', 'exercise'],
      ['deleted', false],
      ['payload->>isPublic', 'true'],
    ]);
    assert.equal(response.json().exercises.length, 100);
    assert.equal(response.json().hasMore, true);
    assert.equal((await app.inject('/exercises?page=-1')).statusCode, 400);
  } finally {
    await app.close();
  }
});
