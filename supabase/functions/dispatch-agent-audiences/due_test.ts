// dispatch-agent-audiences: the due test tolerates the cron/run timing skew.
// Regression: a daily audience whose last run started 0.6s after yesterday's
// 13:47 tick was "not due" at today's 13:47 tick (23h59m59.4s), so daily
// audiences ran every other day.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadHandler } from "../_shared/testing/fake_platform.ts";

await loadHandler(new URL("./index.ts", import.meta.url).href); // stubs Deno.serve for the import
const mod = await import(new URL("./index.ts", import.meta.url).href);
const isDue = mod.isDue as (c: string, last: string | null, now: number) => boolean;

Deno.test("daily: due at the next day's tick even though the last run started just after the previous tick", () => {
  assertEquals(isDue("daily", "2026-10-08T13:47:00.621Z", Date.parse("2026-10-09T13:47:00.037Z")), true);
});

Deno.test("daily: not due again the same UTC day", () => {
  assertEquals(isDue("daily", "2026-10-09T13:47:00.621Z", Date.parse("2026-10-09T14:47:00Z")), false);
  assertEquals(isDue("daily", "2026-10-09T13:47:00.621Z", Date.parse("2026-10-09T23:59:59Z")), false);
  assertEquals(isDue("daily", "2026-10-15T00:05:00Z", Date.parse("2026-10-15T13:47:00Z")), false);
});

Deno.test("daily: due if it has not run yet today, however recent yesterday's run was", () => {
  // Regression 2026-10-15: manual run 19:40 UTC the day before made the 13:47 auto-add skip.
  assertEquals(isDue("daily", "2026-10-14T19:40:00Z", Date.parse("2026-10-15T13:47:00.040Z")), true);
  assertEquals(isDue("daily", "2026-10-14T23:59:59Z", Date.parse("2026-10-15T13:47:00Z")), true);
  assertEquals(isDue("daily", "not a date", Date.parse("2026-10-15T13:47:00Z")), true);
});

Deno.test("weekly / monthly keep their period; never-run is due; manual/unknown never", () => {
  assertEquals(isDue("weekly", "2026-10-02T13:47:00.5Z", Date.parse("2026-10-09T13:47:00Z")), true);
  assertEquals(isDue("weekly", "2026-10-05T13:47:00Z", Date.parse("2026-10-09T13:47:00Z")), false);
  assertEquals(isDue("monthly", "2026-09-09T13:47:00.5Z", Date.parse("2026-10-09T13:47:00Z")), true);
  assertEquals(isDue("daily", null, Date.now()), true);
  assertEquals(isDue("manual", null, Date.now()), false);
  assertEquals(isDue("hourly", null, Date.now()), false);
});
