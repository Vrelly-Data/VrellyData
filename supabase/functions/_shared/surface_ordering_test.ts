import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideSurfaceAndClassify } from "./surface.ts";

function firstPath(ts: string | null, prior: string | null, isExisting: boolean) {
  return decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: isExisting,
    newestProspectTimestamp: ts,
    priorWatermark: prior,
    nowMs: new Date("2026-09-30T12:00:00Z").getTime(),
  });
}

Deno.test("ordering: webhook then poller (same ts) second path no-op", () => {
  const ts = "2026-09-30T11:00:00Z";
  const a = firstPath(ts, null, false);
  const b = firstPath(ts, a.newWatermark, true);
  assertEquals(a.surface, true);
  assertEquals(b.surface, false);
  assertEquals(b.willClassify, false);
});

Deno.test("ordering: poller then webhook (same ts) second path no-op", () => {
  const ts = "2026-09-30T11:00:00Z";
  const a = firstPath(ts, null, false);
  const b = firstPath(ts, a.newWatermark, true);
  assertEquals(a.surface, true);
  assertEquals(b.surface, false);
});

Deno.test("ordering: recover then poller (same ts) second path no-op", () => {
  const ts = "2026-09-29T12:00:00Z";
  const a = firstPath(ts, null, false); // recover inserts pending + watermark
  const b = firstPath(ts, a.newWatermark, true);
  assertEquals(b.surface, false);
});

Deno.test("ordering: poller then recover (same ts) second path no-op", () => {
  const ts = "2026-09-29T12:00:00Z";
  const a = firstPath(ts, null, false);
  const b = firstPath(ts, a.newWatermark, true);
  assertEquals(b.surface, false);
});

Deno.test("ordering: sub-second precision difference is a no-op on second path", () => {
  const prior = "2026-09-30T12:00:22Z";
  const incoming = "2026-09-30T12:00:22.123Z";
  const a = firstPath(prior, null, false);
  const b = firstPath(incoming, a.newWatermark, true);
  assertEquals(b.surface, false);
});

Deno.test("missing timestamp twice: no second surface", () => {
  const a = firstPath(null, null, false);
  // first may surface pending for new lead (decision returns surface=true even when ts missing)
  const b = firstPath(null, a.newWatermark, true);
  assertEquals(b.surface, false);
});

