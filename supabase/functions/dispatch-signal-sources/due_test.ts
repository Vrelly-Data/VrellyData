// When a signal source is due: hour-truncated, full cadence — tolerant of a
// run stamped just after its tick, and no drift with an hourly dispatcher.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSourceDue } from "./due.ts";

const t = (s: string) => Date.parse(s);

Deno.test("daily: a run stamped 0.6s after yesterday's 13:05 tick is due at today's 13:05 (the #108 bug)", () => {
  assertEquals(isSourceDue("daily", "2026-10-08T13:05:00.600Z", t("2026-10-09T13:05:00.000Z")), true);
});

Deno.test("daily: not due an hour early — no drift with an hourly dispatcher", () => {
  assertEquals(isSourceDue("daily", "2026-10-08T13:05:00.600Z", t("2026-10-09T12:05:00.000Z")), false);
  // simulate 10 days of hourly ticks: runs stay at 13:05
  let last = "2026-10-01T13:05:01.000Z";
  const ran: string[] = [];
  for (let h = 0; h < 24 * 10; h++) {
    const now = t("2026-10-01T14:05:00.000Z") + h * 3_600_000;
    if (isSourceDue("daily", last, now)) { last = new Date(now + 900).toISOString(); ran.push(last.slice(11, 16)); }
  }
  assertEquals(ran.length, 10); // Oct 2 … Oct 11, one per day
  assertEquals([...new Set(ran)], ["13:05"]);
});

Deno.test("daily: a late run (13:50) is due again from 13:05 next day — at least cadence minus 1h", () => {
  assertEquals(isSourceDue("daily", "2026-10-08T13:50:00Z", t("2026-10-09T13:05:00Z")), true);
});

Deno.test("hourly and realtime run every tick; never-run sources are due; unknown cadence never", () => {
  assertEquals(isSourceDue("hourly", "2026-10-09T12:05:00.700Z", t("2026-10-09T13:05:00Z")), true);
  assertEquals(isSourceDue("realtime", "2026-10-09T12:05:00Z", t("2026-10-09T13:05:00Z")), true);
  assertEquals(isSourceDue("hourly", "2026-10-09T13:05:00.700Z", t("2026-10-09T13:30:00Z")), false);
  assertEquals(isSourceDue("daily", null, t("2026-10-09T13:05:00Z")), true);
  assertEquals(isSourceDue("weekly", null, t("2026-10-09T13:05:00Z")), false);
});
