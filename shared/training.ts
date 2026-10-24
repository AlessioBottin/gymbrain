import type { Prescription, TrainingSession } from './domain.ts';
export type TrainingStep = { exercise: number; set: number; restSeconds: number };
// Group order follows the first occurrence; exercises within each round follow their screen order.
export function trainingSequence(exercises: Prescription[]): TrainingStep[] {
  const result: TrainingStep[] = [],
    visited = new Set<string>();
  exercises.forEach((exercise, i) => {
    if (exercise.group && visited.has(exercise.group.id)) return;
    const members = exercise.group
      ? exercises.map((e, index) => ({ e, index })).filter((x) => x.e.group?.id === exercise.group!.id)
      : [{ e: exercise, index: i }];
    if (exercise.group) visited.add(exercise.group.id);
    const rounds = Math.max(...members.map((x) => x.e.sets.length));
    for (let round = 0; round < rounds; round++) {
      const active = members.filter((x) => round < x.e.sets.length);
      active.forEach((x, index) =>
        result.push({
          exercise: x.index,
          set: round,
          restSeconds: exercise.group
            ? exercise.group.type === 'superset' && index < active.length - 1
              ? 0
              : exercise.group.restSeconds
            : (x.e.restSeconds ?? x.e.sets[round]?.restSeconds ?? 90),
        }),
      );
    }
  });
  return result;
}
export function nextTrainingStep(session: TrainingSession): TrainingStep | undefined {
  const exercises = session.exercises.map((e) => ({ ...e, sets: e.actual }));
  return trainingSequence(exercises).find((s) => !session.exercises[s.exercise]!.actual[s.set]!.done);
}
