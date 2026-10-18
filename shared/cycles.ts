import type { LocalRecord } from './domain';

export function activeCycle(cycles: LocalRecord[], today: string): LocalRecord | undefined {
  const date = Date.parse(today);
  return cycles
    .filter((row) => {
      const { start, weeks } = row.payload as { start: string; weeks: number };
      const first = Date.parse(start);
      return date >= first && date < first + weeks * 7 * 86400000;
    })
    .sort(
      (a, b) =>
        (b.payload as { start: string }).start.localeCompare((a.payload as { start: string }).start) ||
        a.id.localeCompare(b.id),
    )[0];
}

export function activePlan(plans: LocalRecord[], today: string): LocalRecord | undefined {
  return plans
    .filter((row) => {
      const { start, end } = row.payload as { start?: string; end?: string };
      return !!start && !!end && start <= today && today <= end;
    })
    .sort(
      (a, b) =>
        (b.payload as { start: string }).start.localeCompare((a.payload as { start: string }).start) ||
        a.id.localeCompare(b.id),
    )[0];
}

export function comparePlanDates(a: LocalRecord, b: LocalRecord): number {
  const left = a.payload as { start?: string; end?: string; name: string };
  const right = b.payload as { start?: string; end?: string; name: string };
  return (
    (left.start || '9999-12-31').localeCompare(right.start || '9999-12-31') ||
    (left.end || '9999-12-31').localeCompare(right.end || '9999-12-31') ||
    left.name.localeCompare(right.name, 'it') ||
    a.id.localeCompare(b.id)
  );
}
