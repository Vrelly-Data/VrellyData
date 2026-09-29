import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideSurfaceAndClassify, normalizeIsoMs, buildSurfaceUpdateFields } from "./surface.ts";
Deno.test("buildSurfaceUpdateFields: surface → pending+watermark (when not already pending)", () => {
  const decision = {
    surface: true,
    willClassify: true,
    newWatermark: "2026-09-30T12:00:00.000Z",
    setPending: true,
    isStale: false,
    seedWatermark: null,
  };
  const f = buildSurfaceUpdateFields(decision, { isExistingLead: true, alreadyPending: false });
  assertEquals(f, { last_surfaced_reply_at: "2026-09-30T12:00:00.000Z", inbox_status: "pending" });
});

Deno.test("buildSurfaceUpdateFields: seed → watermark only", () => {
  const decision = {
    surface: false,
    willClassify: false,
    newWatermark: null,
    setPending: false,
    isStale: true,
    seedWatermark: "2026-09-28T09:00:00.000Z",
  };
  const f = buildSurfaceUpdateFields(decision, { isExistingLead: true, alreadyPending: true });
  assertEquals(f, { last_surfaced_reply_at: "2026-09-28T09:00:00.000Z" });
});

Deno.test("buildSurfaceUpdateFields: other → empty", () => {
  const decision = {
    surface: false,
    willClassify: false,
    newWatermark: null,
    setPending: false,
    isStale: false,
    seedWatermark: null,
  };
  const f = buildSurfaceUpdateFields(decision, { isExistingLead: false });
  assertEquals(f, {});
});

Deno.test("stale: surface pending, no classify, watermark advanced", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ts = "2026-09-28T11:00:00.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: false,
    newestProspectTimestamp: ts,
    priorWatermark: null,
    nowMs: now,
  });
  assertEquals(r.surface, true);
  assertEquals(r.setPending, true);
  assertEquals(r.willClassify, false);
  assertEquals(r.newWatermark, ts);
});

Deno.test("fresh: willClassify=false (kill switch)", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ts = "2026-09-30T11:30:00.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: false,
    newestProspectTimestamp: ts,
    priorWatermark: null,
    nowMs: now,
  });
  assertEquals(r.surface, true);
  assertEquals(r.willClassify, false);
});

Deno.test("handled lead + stale with older non-null watermark: pending only", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ts = "2026-09-28T10:00:00.000Z";
  const prior = "2026-09-27T10:00:00.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: "dismissed",
    isExistingLead: true,
    newestProspectTimestamp: ts,
    priorWatermark: prior,
    nowMs: now,
  });
  assertEquals(r.surface, true);
  assertEquals(r.setPending, true);
  assertEquals(r.willClassify, false);
});

Deno.test("opted_out suppressed", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ts = "2026-09-30T11:30:00.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: "opted_out",
    isExistingLead: true,
    newestProspectTimestamp: ts,
    priorWatermark: null,
    nowMs: now,
  });
  // shouldResurface returns false when suppressed
  assertEquals(r.surface, false);
  assertEquals(r.setPending, false);
});

Deno.test("missing timestamp: stale", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: false,
    newestProspectTimestamp: null,
    priorWatermark: null,
    nowMs: now,
  });
  assertEquals(r.isStale, true);
  assertEquals(r.willClassify, false);
});

Deno.test("null watermark + stale seed-only: existing, no surface; watermark set", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ts = "2026-09-28T09:00:00.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: true,
    newestProspectTimestamp: ts,
    priorWatermark: null,
    nowMs: now,
  });
  assertEquals(r.surface, false);
  assertEquals(r.setPending, false);
  assertEquals(r.willClassify, false);
  assertEquals(r.newWatermark, ts);
});

Deno.test("null watermark + missing timestamp: existing, no surface; no watermark", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: true,
    newestProspectTimestamp: null,
    priorWatermark: null,
    nowMs: now,
  });
  assertEquals(r.surface, false);
  assertEquals(r.newWatermark, null);
});

Deno.test("null watermark + fresh surfaces", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ts = "2026-09-30T11:30:00.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: true,
    newestProspectTimestamp: ts,
    priorWatermark: null,
    nowMs: now,
  });
  assertEquals(r.surface, true);
  assertEquals(r.setPending, true);
  assertEquals(r.willClassify, false);
});

Deno.test("normalizeIsoMs aligns precision", () => {
  const a = "2026-09-30T12:00:00Z"; // no ms
  const b = "2026-09-30T12:00:00.000Z"; // ms
  assertEquals(normalizeIsoMs(a), "2026-09-30T12:00:00.000Z");
  assertEquals(normalizeIsoMs(b), "2026-09-30T12:00:00.000Z");
});

// Existing T2 watermark, older T1 incoming: no surface, no seed
Deno.test("existing watermark newer than incoming: no surface, no seed", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const prior = "2026-09-30T12:00:22.000Z";
  const incomingOlder = "2026-09-30T12:00:21.000Z";
  const r = decideSurfaceAndClassify({
    dispositionTag: null,
    isExistingLead: true,
    newestProspectTimestamp: incomingOlder,
    priorWatermark: prior,
    nowMs: now,
  });
  assertEquals(r.surface, false);
  assertEquals(r.seedWatermark, null);
});

