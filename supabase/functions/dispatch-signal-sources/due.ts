// When is a signal source due? Pure, so it is unit-tested.
//
// The cron runs this dispatcher hourly at :05. A plain "cadence minus 1 hour"
// test drifts with an hourly tick: a daily source run at 13:05 is due again
// at 12:05 the next day (exactly 23h), then 11:05, ... So both instants are
// truncated to the hour and compared against the FULL cadence: a run stamped
// anywhere in 13:00–13:59 is due again from 13:00 next day. That admits up to
// an hour of lateness (the #108 every-other-day bug: a run stamped 0.6s after
// its tick) without moving the schedule. 'realtime' sources (the pixel
// rollup) are rolled up on every tick.

export const CADENCE_HOURS: Record<string, number> = { hourly: 1, daily: 24, realtime: 1 };

const HOUR = 3_600_000;
const truncHour = (ms: number) => Math.floor(ms / HOUR) * HOUR;

export function isSourceDue(cadence: string, lastRunAt: string | null | undefined, now: number): boolean {
  const hours = CADENCE_HOURS[cadence];
  if (!hours) return false;
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return true;
  return truncHour(now) - truncHour(last) >= hours * HOUR;
}
