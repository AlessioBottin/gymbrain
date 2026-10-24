import { z } from 'zod';

export const uuid = z.string().uuid();
const text = z.string().max(4000);
const number = z.number().finite().min(0).max(2000).nullable();
const restSeconds = z.number().int().min(0).max(3600);
const segmentSchema = z
  .object({ reps: number, tut: number, load: number, restSeconds: restSeconds.optional() })
  .strict();
export const groupSchema = z.object({ id: uuid, type: z.enum(['jump', 'superset']), restSeconds }).strict();
const targetFields = z
  .object({
    countVolume: z.boolean().optional(),
    restSeconds: restSeconds.optional(),
    technique: z.enum(['standard', 'cluster', 'drop']).optional(),
    segments: z.array(segmentSchema).min(2).max(10).optional(),
    reps: number,
    rpe: z.number().min(1).max(10).nullable(),
    rir: z.number().min(0).max(10).nullable(),
    tut: number,
    load: number,
  })
  .strict();
function validTechnique(set: { technique?: string; segments?: { load: number | null }[] }) {
  if (!set.technique || set.technique === 'standard') return !set.segments;
  if (!set.segments || set.segments.length < 2) return false;
  return (
    set.technique !== 'drop' ||
    set.segments.every(
      (s, i, a) => i === 0 || s.load == null || a[i - 1]!.load == null || s.load <= a[i - 1]!.load!,
    )
  );
}
export const targetSchema = targetFields.refine(
  validTechnique,
  'Cluster/drop richiede almeno due passaggi; i carichi drop non possono aumentare.',
);
export const loadModeSchema = z.enum(['bodyweight', 'weighted', 'external', 'band']);
export const exerciseTypeSchema = z.enum(['bodyweight', 'weights']);
export const muscleGroups = {
  chest: 'Petto',
  glutes: 'Glutei',
  hamstrings: 'Femorali',
  quads: 'Quadricipiti',
  calves: 'Polpacci',
  lats: 'Dorsali',
  rhomboids: 'Romboidi',
  rearDelts: 'Deltoidi posteriori',
  traps: 'Trapezi',
  biceps: 'Bicipiti',
  triceps: 'Tricipiti',
  frontDelts: 'Deltoidi frontali',
  sideDelts: 'Deltoidi laterali',
  forearms: 'Avambracci',
  abs: 'Addominali',
  obliques: 'Obliqui (core)',
  erectors: 'Lombari',
  adductors: 'Adduttori',
} as const;
export type Muscle = keyof typeof muscleGroups;
export function normalizeMuscleTargets(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { frontSideDelts, back, ...targets } = value as Record<string, unknown>;
  if (frontSideDelts !== undefined) {
    if (targets.frontDelts === undefined) targets.frontDelts = frontSideDelts;
    if (targets.sideDelts === undefined) targets.sideDelts = frontSideDelts;
  }
  if (back !== undefined) {
    if (targets.lats === undefined) targets.lats = back;
    if (targets.rhomboids === undefined) targets.rhomboids = back;
  }
  return targets;
}
export const muscleTargetsSchema = z.preprocess(
  normalizeMuscleTargets,
  z.partialRecord(
    z.enum(Object.keys(muscleGroups) as [Muscle, ...Muscle[]]),
    z
      .number()
      .min(0)
      .max(1)
      .refine((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, 'Usa un solo decimale'),
  ),
);
export type MuscleTargets = z.infer<typeof muscleTargetsSchema>;
export const variantSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(100),
    notes: text.default(''),
    muscleTargets: muscleTargetsSchema.optional(),
  })
  .strict();
export const bandSchema = z
  .object({
    id: z.string().max(100),
    name: z.string().max(100),
    minKg: z.number().nonnegative().max(500),
    maxKg: z.number().positive().max(500),
  })
  .strict()
  .refine((b) => b.minKg <= b.maxKg);
export function normalizeExercise(value: any) {
  if (!value || typeof value !== 'object') return value;
  const { mode, ...rest } = value;
  return {
    ...rest,
    exerciseType: value.exerciseType || (mode === 'external' ? 'weights' : 'bodyweight'),
    variants: value.variants || [],
  };
}
export function normalizePrescription(value: any) {
  if (!value || typeof value !== 'object') return value;
  return {
    ...value,
    exerciseType: value.exerciseType || (value.mode === 'external' ? 'weights' : 'bodyweight'),
    variant: value.variant ?? null,
    assistance: value.assistance || [],
  };
}
export const exerciseSchema = z.preprocess(
  normalizeExercise,
  z
    .object({
      name: z.string().trim().min(1).max(100),
      description: text,
      notes: text,
      exerciseType: exerciseTypeSchema,
      measurement: z.enum(['reps', 'duration']).optional(),
      variants: z.array(variantSchema).max(30),
      muscleTargets: muscleTargetsSchema.optional(),
      videoUrl: z.union([z.literal(''), z.string().url().startsWith('https://')]),
      videoPath: z.string().max(300).default(''),
    })
    .strict(),
);
const prescriptionFields = z
  .object({
    id: uuid,
    exerciseId: uuid,
    group: groupSchema.optional(),
    name: z.string().min(1).max(100),
    notes: text,
    mode: loadModeSchema,
    exerciseType: exerciseTypeSchema,
    measurement: z.enum(['reps', 'duration']).optional(),
    variant: variantSchema.nullable(),
    muscleTargets: muscleTargetsSchema.optional(),
    assistance: z.array(bandSchema).max(8),
    band: z.string().max(200),
    alternatives: z.array(uuid).max(20),
    sets: z.array(targetSchema).min(1).max(30),
  })
  .strict();
export const prescriptionSchema = z.preprocess(normalizePrescription, prescriptionFields);
export const cycleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes: text,
    start: z.string().date(),
    weeks: z.number().int().min(1).max(52),
  })
  .strict();
export const planSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes: text,
    start: z.string().date().optional(),
    end: z.string().date().optional(),
    order: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine(
    (p) => (!p.start && !p.end) || (!!p.start && !!p.end && p.start <= p.end),
    'Indica inizio e fine del periodo, in ordine cronologico',
  );
export const workoutSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes: text,
    order: z.number().int().min(0).max(1000),
    exercises: z.array(prescriptionSchema).max(50),
  })
  .strict()
  .superRefine((workout, ctx) => {
    for (const e of workout.exercises) {
      if (!e.group) continue;
      const members = workout.exercises.filter((x) => x.group?.id === e.group!.id);
      if (
        members.length < 2 ||
        members.some((x) => x.group!.type !== e.group!.type || x.group!.restSeconds !== e.group!.restSeconds)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Ogni jump set o superset richiede almeno due esercizi e lo stesso recupero.',
        });
    }
  });
export const actualSetSchema = targetFields
  .extend({
    done: z.boolean(),
    segments: z
      .array(segmentSchema.extend({ done: z.boolean().optional() }))
      .min(2)
      .max(10)
      .optional(),
  })
  .refine(validTechnique, 'Passaggi cluster/drop non validi.');
export const sessionExerciseSchema = z.preprocess(
  normalizePrescription,
  prescriptionFields.extend({
    originalExerciseId: uuid,
    originalName: z.string().min(1).max(100),
    originalVariant: variantSchema.nullable().default(null),
    originalAssistance: z.array(bandSchema).max(8).default([]),
    targetSets: z.array(targetSchema).min(1).max(30),
    actual: z.array(actualSetSchema).min(1).max(30),
    sessionNotes: text,
    substitutionReason: text,
  }),
);
export const sessionSchema = z
  .object({
    name: z.string().min(1).max(100),
    workoutId: uuid,
    planId: uuid,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    bodyWeight: z.number().positive().max(500).nullable(),
    notes: text,
    exercises: z.array(sessionExerciseSchema).min(1).max(50),
  })
  .strict();
export const weightSchema = z
  .object({
    kg: z.number().positive().max(500),
    measuredAt: z.string().datetime(),
    source: z.enum(['manual', 'withings']),
    externalId: z.string().max(200).optional(),
  })
  .strict();
export const schemas = {
  exercise: exerciseSchema,
  cycle: cycleSchema,
  plan: planSchema,
  workout: workoutSchema,
  session: sessionSchema,
  weight: weightSchema,
};
export type Kind = keyof typeof schemas;
export type Module = 'training' | 'tracking';
export type Exercise = z.infer<typeof exerciseSchema>;
export type Prescription = z.infer<typeof prescriptionSchema>;
export type Workout = z.infer<typeof workoutSchema>;
export type TrainingSession = z.infer<typeof sessionSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Payload =
  | Exercise
  | z.infer<typeof cycleSchema>
  | z.infer<typeof planSchema>
  | Workout
  | TrainingSession
  | z.infer<typeof weightSchema>;
export interface RecordRow {
  id: string;
  user_id: string;
  kind: Kind;
  parent_id: string | null;
  payload: Payload;
  version: number;
  revision: number;
  deleted: boolean;
  updated_at: string;
}
export interface LocalRecord extends RecordRow {
  module: Module;
  dirty?: boolean;
  conflict?: RecordRow;
  localRevision: number;
}
export const moduleFor = (kind: Kind): Module =>
  ['session', 'weight'].includes(kind) ? 'tracking' : 'training';
export const mutationSchema = z
  .object({
    operationId: uuid,
    id: uuid,
    kind: z.enum(['exercise', 'cycle', 'plan', 'workout', 'session', 'weight']),
    parentId: uuid.nullable(),
    baseVersion: z.number().int().min(0),
    payload: z.unknown(),
    deleted: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const result = schemas[value.kind].safeParse(value.payload);
    if (!result.success)
      ctx.addIssue({
        code: 'custom',
        message:
          'Dati non validi: ' + result.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '),
      });
    if (value.kind === 'session' && result.success) {
      const session = result.data as TrainingSession;
      const recorded = session.exercises.flatMap((e) =>
        e.actual.filter((s) => s.done).map((s) => ({ s, e })),
      );
      if (recorded.some(({ s, e }) => !validRecordedSet(s, e.measurement)))
        ctx.addIssue({
          code: 'custom',
          message:
            'Una serie registrata richiede ripetizioni intere positive o secondi positivi per le isometrie.',
        });
      if (session.completedAt && !recorded.length)
        ctx.addIssue({ code: 'custom', message: 'Completa almeno una serie valida.' });
    }
    if (['plan', 'workout'].includes(value.kind) !== !!value.parentId)
      ctx.addIssue({ code: 'custom', message: 'Gerarchia non valida' });
  });
export type Mutation = z.infer<typeof mutationSchema>;
export const newTarget = (measurement = 'reps'): Target => ({
  reps: measurement === 'duration' ? null : 8,
  rpe: 8,
  rir: 2,
  tut: measurement === 'duration' ? 30 : null,
  load: null,
});
export function validRecordedSet(
  set: {
    reps: number | null;
    tut: number | null;
    technique?: string;
    segments?: { reps: number | null; tut: number | null; done?: boolean }[];
  },
  measurement = 'reps',
): boolean {
  if (set.technique === 'cluster' || set.technique === 'drop')
    return (
      !!set.segments &&
      set.segments.length >= 2 &&
      set.segments.every((s) => s.done === true && validRecordedSet(s, measurement))
    );
  return measurement === 'duration'
    ? set.tut != null && set.tut > 0
    : set.reps != null && Number.isInteger(set.reps) && set.reps > 0;
}
export function snapshotSession(workout: LocalRecord, bodyWeight: number | null): TrainingSession {
  const w = workoutSchema.parse(workout.payload);
  return {
    name: w.name,
    workoutId: workout.id,
    planId: workout.parent_id!,
    startedAt: new Date().toISOString(),
    completedAt: null,
    bodyWeight,
    notes: '',
    exercises: w.exercises.map((e) => ({
      ...JSON.parse(JSON.stringify(e)),
      originalExerciseId: e.exerciseId,
      originalName: e.name,
      originalVariant: e.variant ? { ...e.variant } : null,
      originalAssistance: e.assistance.map((b) => ({ ...b })),
      targetSets: JSON.parse(JSON.stringify(e.sets)),
      actual: e.sets.map((target) => ({
        countVolume: target.countVolume,
        technique: target.technique,
        restSeconds: target.restSeconds,
        segments: target.segments?.map((s) => ({
          reps: null,
          tut: null,
          load: null,
          restSeconds: s.restSeconds,
          done: false,
        })),
        reps: null,
        rpe: null,
        rir: null,
        tut: null,
        load: null,
        done: false,
      })),
      sessionNotes: '',
      substitutionReason: '',
    })),
  };
}
