export interface WhoopRecord {
  kind: 'sleep' | 'recovery' | 'cycle' | 'workout';
  provider_id: string;
  measured_at: string;
  provider_updated_at: string;
  payload: any;
}
export interface WhoopLink {
  session_id: string;
  workout_id: string;
}
export function recoveryBefore(records: WhoopRecord[], start: string) {
  const time = Date.parse(start);
  const sleeps = records
    .filter(
      (r) =>
        r.kind === 'sleep' &&
        !r.payload.nap &&
        r.payload.score_state === 'SCORED' &&
        Date.parse(r.payload.end) <= time &&
        time - Date.parse(r.payload.end) < 36 * 3600000,
    )
    .sort((a, b) => Date.parse(b.payload.end) - Date.parse(a.payload.end));
  const sleep = sleeps[0];
  const recovery = sleep
    ? records.find(
        (r) =>
          r.kind === 'recovery' &&
          r.payload.sleep_id === sleep.provider_id &&
          r.payload.score_state === 'SCORED' &&
          Date.parse(r.payload.created_at) <= time,
      )
    : undefined;
  // Historical values can have been rescored: make that limitation visible.
  return { sleep, recovery, rescored: !!recovery && Date.parse(recovery.provider_updated_at) > time };
}
export function overlappingWorkouts(records: WhoopRecord[], start: string, end: string) {
  const a = Date.parse(start),
    b = Date.parse(end);
  return records.filter(
    (r) => r.kind === 'workout' && Date.parse(r.payload.start) < b && Date.parse(r.payload.end) > a,
  );
}
export function sleepHours(record?: WhoopRecord) {
  const stages = record?.payload?.score?.stage_summary;
  if (!stages) return null;
  const values = [
    stages.total_light_sleep_time_milli,
    stages.total_slow_wave_sleep_time_milli,
    stages.total_rem_sleep_time_milli,
  ];
  return values.every((v) => typeof v === 'number') ? values.reduce((a, b) => a + b, 0) / 3600000 : null;
}
