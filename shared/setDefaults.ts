import type { Target, Prescription } from './domain.ts';
export function setAssistance(sets: Target[], index: number, fallback: Prescription['assistance'] = []) {
  return sets[index]?.assistance ?? sets[0]?.assistance ?? fallback;
}
export function setLoad(sets: (Target & { done?: boolean })[], index: number, value: number | null) {
  const old = sets[index]?.load;
  if (!sets[index]) return;
  sets[index]!.load = value;
  if (index === 0)
    for (const set of sets.slice(1)) {
      if (!set.done && (set.load == null || set.load === old)) set.load = value;
    }
}
