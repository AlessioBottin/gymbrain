import { exerciseSchema } from './domain.ts';

// Explicit projection: personal notes, file paths and owner identity never leave the private catalog.
export function publicExercise(row: { id: string; payload: unknown }) {
  const e = exerciseSchema.parse(row.payload);
  return {
    id: row.id,
    name: e.name,
    description: e.description,
    exerciseType: e.exerciseType,
    measurement: e.measurement || 'reps',
    muscleTargets: e.muscleTargets || {},
    variants: e.variants.map((v) => ({ id: v.id, name: v.name, muscleTargets: v.muscleTargets })),
  };
}
export type PublicExercise = ReturnType<typeof publicExercise>;
