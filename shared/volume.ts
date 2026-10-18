import {
  muscleGroups,
  normalizeMuscleTargets,
  newTarget,
  type Muscle,
  type MuscleTargets,
  type Exercise,
  type Prescription,
  type LocalRecord,
} from './domain.ts';

export function effectiveTargets(base: MuscleTargets = {}, overrides: MuscleTargets = {}): MuscleTargets {
  return {
    ...(normalizeMuscleTargets(base) as MuscleTargets),
    ...(normalizeMuscleTargets(overrides) as MuscleTargets),
  };
}
export function prescriptionTargets(e: Prescription, catalog: LocalRecord[] = []): MuscleTargets {
  const source = catalog.find((r) => r.id === e.exerciseId)?.payload as Exercise | undefined;
  const variant = source?.variants.find((v) => v.id === e.variant?.id) || e.variant;
  return effectiveTargets(source?.muscleTargets ?? e.muscleTargets, variant?.muscleTargets);
}
export function volume(exercises: Prescription[], catalog: LocalRecord[] = []): Record<Muscle, number> {
  const totals = Object.fromEntries(Object.keys(muscleGroups).map((m) => [m, 0])) as Record<Muscle, number>;
  for (const e of exercises) {
    const targets = prescriptionTargets(e, catalog);
    const sets = e.sets.filter((s) => s.countVolume !== false).length;
    for (const m of Object.keys(totals) as Muscle[]) totals[m] += sets * Math.round((targets[m] ?? 0) * 10);
  }
  for (const m of Object.keys(totals) as Muscle[]) totals[m] /= 10;
  return totals;
}
export function makePrescription(row: LocalRecord): Prescription {
  const e = row.payload as Exercise;
  return {
    id: crypto.randomUUID(),
    exerciseId: row.id,
    name: e.name,
    notes: '',
    exerciseType: e.exerciseType,
    mode: e.exerciseType === 'weights' ? 'external' : 'bodyweight',
    measurement: e.measurement || 'reps',
    variant: null,
    muscleTargets: { ...e.muscleTargets },
    assistance: [],
    band: '',
    alternatives: [],
    sets: [newTarget(e.measurement)],
  };
}
export function freezeTargets(e: Prescription, catalog: LocalRecord[]): Prescription {
  return {
    ...e,
    muscleTargets: prescriptionTargets(e, catalog),
    variant: e.variant ? { ...e.variant, muscleTargets: {} } : null,
  };
}
