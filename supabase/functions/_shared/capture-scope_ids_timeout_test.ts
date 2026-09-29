// capture-scope helper: id coercion + timeouts that really ABORT.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkCaptureGate, listEnabledCampaignIds, normalizeCampaignId, numericCampaignIds } from "./capture-scope.ts";
import { FakeSupabase, SERVICE_KEY, SUPA, noProviders, testOpts, withFakes } from "./testing/fake_platform.ts";

Deno.test("normalizeCampaignId: numbers and strings map to one canonical id; junk is missing", () => {
  assertEquals(normalizeCampaignId(518402), "518402");
  assertEquals(normalizeCampaignId("518402"), "518402");
  assertEquals(normalizeCampaignId(" 518402 "), "518402");
  assertEquals(normalizeCampaignId(518402n), "518402");
  for (const v of [null, undefined, "", "  ", "null", "undefined", NaN, Infinity, {}, [], true]) {
    assertEquals(normalizeCampaignId(v), null, `expected null for ${String(v)}`);
  }
});

Deno.test("numericCampaignIds: integers only, de-duplicated, order kept", () => {
  assertEquals(numericCampaignIds(["518402", "2", "abc", "2", "-3", "1.5", "0", ""]), [518402, 2]);
  assertEquals(numericCampaignIds([]), []);
});

// Minimal builder that records filters and can hang until aborted.
class RecordingBuilder {
  filters: Record<string, unknown> = {};
  signal: AbortSignal | null = null;
  constructor(private result: { data: unknown; error: unknown } | "hang", private withAbortSupport = true) {
    if (!withAbortSupport) (this as unknown as { abortSignal?: unknown }).abortSignal = undefined;
  }
  select() { return this; }
  eq(col: string, val: unknown) { this.filters[col] = val; return this; }
  abortSignal(s: AbortSignal) { this.signal = s; return this; }
  maybeSingle() { return this.exec(); }
  then<T>(res: (v: { data: unknown; error: unknown }) => T, rej?: (e: unknown) => T) { return this.exec().then(res, rej); }
  private exec(): Promise<{ data: unknown; error: unknown }> {
    if (this.result !== "hang") return Promise.resolve(this.result);
    return new Promise((_, reject) => {
      this.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  }
}
const dbWith = (b: RecordingBuilder) => ({ from: (_t: string) => b });

Deno.test("checkCaptureGate: numeric id is queried as its string form (external_campaign_id is TEXT)", async () => {
  const b = new RecordingBuilder({ data: { capture_enabled: true, name: "n" }, error: null });
  const r = await checkCaptureGate(dbWith(b), "int-1", 518402);
  assertEquals(r.allowed, true);
  assertEquals(b.filters["external_campaign_id"], "518402");
  assertEquals(b.filters["integration_id"], "int-1");
});

Deno.test("checkCaptureGate: capture_enabled null is not enabled", async () => {
  const b = new RecordingBuilder({ data: { capture_enabled: null, name: "n" }, error: null });
  assertEquals((await checkCaptureGate(dbWith(b), "int-1", "1")).reason, "capture_disabled");
});

Deno.test("checkCaptureGate: missing integration id fails closed (lookup_error)", async () => {
  const b = new RecordingBuilder({ data: { capture_enabled: true }, error: null });
  assertEquals((await checkCaptureGate(dbWith(b), "", "1")).reason, "lookup_error");
});

Deno.test("checkCaptureGate: timeout ABORTS the query and returns lookup_error on time", async () => {
  const b = new RecordingBuilder("hang");
  const t0 = Date.now();
  const r = await checkCaptureGate(dbWith(b), "int-1", "1", { timeoutMs: 250 });
  const elapsed = Date.now() - t0;
  assertEquals(r, { allowed: false, reason: "lookup_error" });
  assert(b.signal?.aborted, "the query's AbortSignal must be aborted");
  assert(elapsed < 1000, `returned after ${elapsed}ms`);
});

Deno.test("checkCaptureGate: builder without abortSignal still times out (hard bound)", async () => {
  const b = new RecordingBuilder("hang", false);
  const t0 = Date.now();
  const r = await checkCaptureGate(dbWith(b), "int-1", "1", { timeoutMs: 250 });
  assertEquals(r.reason, "lookup_error");
  assert(Date.now() - t0 < 1000);
});

Deno.test("listEnabledCampaignIds: trims, de-duplicates, returns row ids; timeout aborts", async () => {
  const ok = new RecordingBuilder({ data: [
    { id: "r1", external_campaign_id: " 518402 " },
    { id: "r2", external_campaign_id: "518402" },
    { id: "r3", external_campaign_id: "518403" },
    { id: "r4", external_campaign_id: "" },
  ], error: null });
  assertEquals(await listEnabledCampaignIds(dbWith(ok), "int-1"), { ok: true, ids: ["518402", "518403"], rowIds: ["r1", "r3"] });
  assertEquals(ok.filters["capture_enabled"], true);

  const hang = new RecordingBuilder("hang");
  const r = await listEnabledCampaignIds(dbWith(hang), "int-1", { timeoutMs: 250 });
  assertEquals(r, { ok: false, reason: "lookup_error" });
  assert(hang.signal?.aborted);
});

// End to end through the REAL supabase-js client: the HTTP request itself is
// cancelled (the fake PostgREST sees the AbortSignal fire).
Deno.test({
  name: "checkCaptureGate + listEnabledCampaignIds via supabase-js: hanging PostgREST request is aborted",
  ...testOpts,
  async fn() {
    const spec = "https://esm.sh/@supabase/supabase-js@2";
    const { createClient } = await import(spec);
    const db = new FakeSupabase({ synced_campaigns: [] });
    db.fail["synced_campaigns"] = "hang";
    const { result } = await withFakes(db, noProviders, async () => {
      const client = createClient(SUPA, SERVICE_KEY);
      const gate = await checkCaptureGate(client, "int-1", 42, { timeoutMs: 250 });
      const list = await listEnabledCampaignIds(client, "int-1", { timeoutMs: 250 });
      return { gate, list };
    });
    assertEquals(result.gate.reason, "lookup_error");
    assertEquals(result.list, { ok: false, reason: "lookup_error" });
    assertEquals(db.aborted, ["GET synced_campaigns", "GET synced_campaigns"]);
  },
});
