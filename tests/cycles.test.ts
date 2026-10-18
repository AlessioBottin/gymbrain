import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCycle, activePlan, comparePlanDates } from '../shared/cycles';
import type { LocalRecord } from '../shared/domain';

const cycle = (id: string, start: string, weeks: number) =>
  ({ id, payload: { start, weeks } }) as LocalRecord;
test('Default cycle uses date boundaries, latest overlapping start and no out-of-period fallback', () => {
  const old = cycle('old', '2026-09-01', 2);
  const current = cycle('current', '2026-10-12', 1);
  const future = cycle('future', '2026-11-01', 4);
  const rows = [old, future, current];
  assert.equal(activeCycle(rows, '2026-10-12')?.id, 'current');
  assert.equal(activeCycle(rows, '2026-10-18')?.id, 'current');
  assert.equal(activeCycle(rows, '2026-10-19'), undefined);
  assert.equal(activeCycle([...rows, cycle('overlap', '2026-10-15', 2)], '2026-10-18')?.id, 'overlap');
  assert.equal(activeCycle([], '2026-10-18'), undefined);
});

test('Default plan matches inclusive period boundaries and skips undated plans', () => {
  const plan = (id: string, start?: string, end?: string) => ({ id, payload: { start, end } }) as LocalRecord;
  const current = plan('current', '2026-10-01', '2026-10-18');
  const rows = [plan('undated'), plan('future', '2026-10-19', '2026-11-01'), current];
  assert.equal(activePlan(rows, '2026-10-01')?.id, 'current');
  assert.equal(activePlan(rows, '2026-10-18')?.id, 'current');
  assert.equal(activePlan(rows, '2026-10-19')?.id, 'future');
  assert.equal(activePlan(rows, '2026-09-30'), undefined);
  assert.equal(
    activePlan([...rows, plan('overlap', '2026-10-15', '2026-10-20')], '2026-10-18')?.id,
    'overlap',
  );
});

test('Plan ordering uses start and end dates regardless of stored positions, undated last', () => {
  const plan = (id: string, start: string | undefined, end: string | undefined, order: number) =>
    ({ id, payload: { name: id, start, end, order } }) as LocalRecord;
  const rows = [
    plan('undated', undefined, undefined, 0),
    plan('future', '2026-12-01', '2026-12-31', 1),
    plan('long', '2026-10-01', '2026-11-01', 2),
    plan('short', '2026-10-01', '2026-10-31', 99),
  ];
  assert.deepEqual(
    rows.sort(comparePlanDates).map((r) => r.id),
    ['short', 'long', 'future', 'undated'],
  );
});
