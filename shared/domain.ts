import { z } from 'zod'

export const uuid = z.string().uuid()
const text = z.string().max(4000)
const number = z.number().finite().min(0).max(2000).nullable()
export const targetSchema = z
  .object({
    reps: number,
    rpe: z.number().min(1).max(10).nullable(),
    rir: z.number().min(0).max(10).nullable(),
    tut: number,
    load: number,
  })
  .strict()
export const loadModeSchema = z.enum(['bodyweight', 'weighted', 'external', 'band'])
export const exerciseTypeSchema = z.enum(['bodyweight', 'weights'])
export const variantSchema = z
  .object({ id: uuid, name: z.string().trim().min(1).max(100), notes: text.default('') })
  .strict()
export const bandSchema = z
  .object({
    id: z.string().max(100),
    name: z.string().max(100),
    minKg: z.number().nonnegative().max(500),
    maxKg: z.number().positive().max(500),
  })
  .strict()
  .refine((b) => b.minKg <= b.maxKg)
export function normalizeExercise(value: any) {
  if (!value || typeof value !== 'object') return value
  const { mode, ...rest } = value
  return {
    ...rest,
    exerciseType: value.exerciseType || (mode === 'external' ? 'weights' : 'bodyweight'),
    variants: value.variants || [],
  }
}
export function normalizePrescription(value: any) {
  if (!value || typeof value !== 'object') return value
  return {
    ...value,
    exerciseType: value.exerciseType || (value.mode === 'external' ? 'weights' : 'bodyweight'),
    variant: value.variant ?? null,
    assistance: value.assistance || [],
  }
}
export const exerciseSchema = z.preprocess(
  normalizeExercise,
  z
    .object({
      name: z.string().trim().min(1).max(100),
      description: text,
      notes: text,
      exerciseType: exerciseTypeSchema,
      variants: z.array(variantSchema).max(30),
      videoUrl: z.union([z.literal(''), z.string().url().startsWith('https://')]),
      videoPath: z.string().max(300).default(''),
    })
    .strict(),
)
const prescriptionFields = z
  .object({
    id: uuid,
    exerciseId: uuid,
    name: z.string().min(1).max(100),
    notes: text,
    mode: loadModeSchema,
    exerciseType: exerciseTypeSchema,
    variant: variantSchema.nullable(),
    assistance: z.array(bandSchema).max(8),
    band: z.string().max(200),
    alternatives: z.array(uuid).max(20),
    sets: z.array(targetSchema).min(1).max(30),
  })
  .strict()
export const prescriptionSchema = z.preprocess(normalizePrescription, prescriptionFields)
export const cycleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes: text,
    start: z.string().date(),
    weeks: z.number().int().min(1).max(52),
  })
  .strict()
export const planSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes: text,
    order: z.number().int().min(0).max(1000),
  })
  .strict()
export const workoutSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes: text,
    order: z.number().int().min(0).max(1000),
    exercises: z.array(prescriptionSchema).max(50),
  })
  .strict()
export const actualSetSchema = targetSchema.extend({ done: z.boolean() })
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
)
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
  .strict()
export const weightSchema = z
  .object({
    kg: z.number().positive().max(500),
    measuredAt: z.string().datetime(),
    source: z.enum(['manual', 'withings']),
    externalId: z.string().max(200).optional(),
  })
  .strict()
export const schemas = {
  exercise: exerciseSchema,
  cycle: cycleSchema,
  plan: planSchema,
  workout: workoutSchema,
  session: sessionSchema,
  weight: weightSchema,
}
export type Kind = keyof typeof schemas
export type Module = 'training' | 'tracking'
export type Exercise = z.infer<typeof exerciseSchema>
export type Prescription = z.infer<typeof prescriptionSchema>
export type Workout = z.infer<typeof workoutSchema>
export type TrainingSession = z.infer<typeof sessionSchema>
export type Target = z.infer<typeof targetSchema>
export type Payload =
  | Exercise
  | z.infer<typeof cycleSchema>
  | z.infer<typeof planSchema>
  | Workout
  | TrainingSession
  | z.infer<typeof weightSchema>
export interface RecordRow {
  id: string
  user_id: string
  kind: Kind
  parent_id: string | null
  payload: Payload
  version: number
  revision: number
  deleted: boolean
  updated_at: string
}
export interface LocalRecord extends RecordRow {
  module: Module
  dirty?: boolean
  conflict?: RecordRow
  localRevision: number
}
export const moduleFor = (kind: Kind): Module =>
  ['session', 'weight'].includes(kind) ? 'tracking' : 'training'
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
    const result = schemas[value.kind].safeParse(value.payload)
    if (!result.success)
      ctx.addIssue({
        code: 'custom',
        message:
          'Dati non validi: ' +
          result.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '),
      })
    if (['plan', 'workout'].includes(value.kind) !== !!value.parentId)
      ctx.addIssue({ code: 'custom', message: 'Gerarchia non valida' })
  })
export type Mutation = z.infer<typeof mutationSchema>
export const newTarget = (): Target => ({ reps: 8, rpe: 8, rir: 2, tut: null, load: null })
export function snapshotSession(workout: LocalRecord, bodyWeight: number | null): TrainingSession {
  const w = workoutSchema.parse(workout.payload)
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
      actual: e.sets.map(() => ({
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
  }
}
