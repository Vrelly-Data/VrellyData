// Signals pipeline: helpers (dedupe, domains), the chunked upsert, and
// runSignalSource's run-log outcomes against a fake PostgREST.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clampScore, dedupeBatch, dedupeKey, fixText, fixTextDeep, normalizeDomain, runSignalSource, type SignalInput, toIso, upsertSignals,
} from "./signals.ts";
import { FakeSupabase, json, noProviders, setTestEnv, testOpts, withFakes } from "./testing/fake_platform.ts";

const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
// deno-lint-ignore no-explicit-any
const { createClient } = (await import(SUPABASE_JS)) as any;
setTestEnv();

const sig = (key: string, at: string, extra: Partial<SignalInput> = {}): SignalInput => ({
  signal_type: "t", occurred_at: at, title: key, dedupe_key: key, score: 10, ...extra,
});

Deno.test("dedupeKey: prefix + trimmed lower-cased parts; an empty part throws instead of collapsing", () => {
  assertEquals(dedupeKey("510k", " K260945 "), "510k:k260945");
  assertEquals(dedupeKey("job", "greenhouse", "Airbnb", 8184174), "job:greenhouse:airbnb:8184174");
  assertEquals(dedupeKey("gh", 264192686, "release", "2026-10-09"), "gh:264192686:release:2026-10-09");
  assertThrows(() => dedupeKey("pe", ""));
  assertThrows(() => dedupeKey("pe", null));
  assertThrows(() => dedupeKey("", "x"));
});

Deno.test("dedupeBatch: one row per key, the latest occurred_at wins", () => {
  const { rows, duplicates } = dedupeBatch([
    sig("a", "2026-10-01T00:00:00Z", { title: "old" }),
    sig("b", "2026-10-01T00:00:00Z"),
    sig("a", "2026-10-05T00:00:00Z", { title: "new" }),
    sig("a", "2026-10-03T00:00:00Z", { title: "middle" }),
  ]);
  assertEquals(duplicates, 2);
  assertEquals(rows.find((r) => r.dedupe_key === "a")?.title, "new");
  assertEquals(rows.length, 2);
});

Deno.test("normalizeDomain / clampScore / toIso", () => {
  assertEquals(normalizeDomain("https://www.Supabase.com/docs?x=1"), "supabase.com");
  assertEquals(normalizeDomain("meritcapital.com"), "meritcapital.com");
  assertEquals(normalizeDomain("http://user@sub.example.co.uk:8080/"), "sub.example.co.uk");
  assertEquals(normalizeDomain("not a domain"), null);
  assertEquals(normalizeDomain(""), null);
  assertEquals([clampScore(-5), clampScore(42.6), clampScore(400), clampScore(NaN)], [0, 43, 100, 0]);
  assertEquals(toIso("2026-09-27"), "2026-09-27T00:00:00.000Z");
  assertEquals(toIso(1786469891368), "2026-08-11T17:38:11.368Z");
  assertEquals(toIso("garbage"), null);
});

Deno.test({
  name: "upsertSignals: dedupes in-batch, writes in chunks through signals_upsert, sums the counts",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase();
    const sent: number[] = [];
    db.rpc.signals_upsert = (b: { p_source_key: string; p_rows: unknown[] }) => {
      assertEquals(b.p_source_key, "openfda_510k");
      sent.push(b.p_rows.length);
      return { received: b.p_rows.length, inserted: b.p_rows.length - 1, updated: 1, deduped: 0, rejected: 0 };
    };
    const rows = Array.from({ length: 5 }, (_, i) => sig(`k${i}`, "2026-10-01T00:00:00Z")).concat(sig("k0", "2026-10-02T00:00:00Z"));
    const { result } = await withFakes(db, noProviders, () => upsertSignals(createClient("http://supabase.test", "svc"), "openfda_510k", rows, 2));
    assertEquals(sent, [2, 2, 1]);
    assertEquals(result, { inserted: 2, updated: 3, deduped: 1, rejected: 0 });
  },
});

function runDb(start: unknown, upsert?: (b: { p_rows: unknown[] }) => unknown) {
  const db = new FakeSupabase();
  const finished: Record<string, unknown>[] = [];
  db.rpc.signals_start_run = start;
  db.rpc.signals_upsert = upsert ?? ((b: { p_rows: unknown[] }) => ({ inserted: b.p_rows.length, updated: 0, deduped: 0, rejected: 0 }));
  db.rpc.signals_finish_run = (b: Record<string, unknown>) => { finished.push(b); return null; };
  return { db, finished };
}
const started = { run_id: "run-1", last_success_at: null, source: { key: "s", signal_type: "t", default_markets: [], kind: "api", cadence: "daily", default_visibility: "all_clients", config: { a: 1 } } };

Deno.test({
  name: "runSignalSource: success writes the run counts; the fetcher sees config + first-run flag",
  ...testOpts,
  async fn() {
    const { db, finished } = runDb(started);
    let seen: unknown;
    const { result } = await withFakes(db, noProviders, () => runSignalSource({
      supabase: createClient("http://supabase.test", "svc"), sourceKey: "s",
      fetcher: (ctx) => { seen = [ctx.config, ctx.lastSuccessAt]; return Promise.resolve({ signals: [sig("x", "2026-10-01T00:00:00Z")], fetched: 3 }); },
    }));
    assertEquals(seen, [{ a: 1 }, null]);
    assertEquals(result.status, "success");
    assertEquals([finished[0].p_status, finished[0].p_fetched, finished[0].p_inserted, finished[0].p_run_id], ["success", 3, 1, "run-1"]);
  },
});

Deno.test({
  name: "runSignalSource: a fetch error with signals → partial (signals still written); with none → failed; a throw → failed",
  ...testOpts,
  async fn() {
    const cases: Array<[() => Promise<{ signals: SignalInput[]; fetched: number; error?: string }>, string, number]> = [
      [() => Promise.resolve({ signals: [sig("x", "2026-10-01T00:00:00Z")], fetched: 1, error: "page 2 HTTP 500" }), "partial", 1],
      [() => Promise.resolve({ signals: [], fetched: 0, error: "HTTP 500" }), "failed", 0],
      [() => Promise.reject(new Error("boom")), "failed", 0],
    ];
    for (const [fetcher, want, inserted] of cases) {
      const { db, finished } = runDb(started);
      const { result } = await withFakes(db, noProviders, () => runSignalSource({ supabase: createClient("http://supabase.test", "svc"), sourceKey: "s", fetcher }));
      assertEquals(result.status, want);
      assertEquals(finished[0].p_status, want);
      assertEquals(finished[0].p_inserted, inserted);
      assert(String(finished[0].p_error).length > 0);
    }
  },
});

Deno.test({
  name: "runSignalSource: an upsert failure is a failed run with the error recorded",
  ...testOpts,
  async fn() {
    const { db, finished } = runDb(started, () => json({ code: "XX000", message: "simulated upsert error" }, 500));
    const { result } = await withFakes(db, noProviders, () => runSignalSource({
      supabase: createClient("http://supabase.test", "svc"), sourceKey: "s",
      fetcher: () => Promise.resolve({ signals: [sig("x", "2026-10-01T00:00:00Z")], fetched: 1 }),
    }));
    assertEquals(result.status, "failed");
    assertEquals(finished[0].p_status, "failed");
    assert(String(finished[0].p_error).includes("simulated upsert error"));
  },
});

Deno.test({
  name: "runSignalSource: inactive / already running → skipped, fetcher never called, no finish",
  ...testOpts,
  async fn() {
    for (const why of ["inactive", "already_running"]) {
      const { db, finished } = runDb({ skipped: why });
      let called = false;
      const { result } = await withFakes(db, noProviders, () => runSignalSource({
        supabase: createClient("http://supabase.test", "svc"), sourceKey: "s",
        fetcher: () => { called = true; return Promise.resolve({ signals: [], fetched: 0 }); },
      }));
      assertEquals([result.status, result.skipped, called, finished.length], ["skipped", why, false, 0]);
    }
  },
});

Deno.test("fixText: cp1252 symbols read as C1 controls, UTF-8 mojibake, idempotent, leaves good text alone", () => {
  assertEquals(fixText("3M\u0099 Attest\u0099 Steam"), "3M™ Attest™ Steam");
  assertEquals(fixText("Smith\u0092s \u0093quote\u0094 \u0096 dash"), "Smith’s “quote” – dash");
  assertEquals(fixText("MickaÃ«l Keromnes"), "Mickaël Keromnes");
  assertEquals(fixText("Veronika SÃ¼di"), "Veronika Südi");
  assertEquals(fixText("Itâ€™s fine"), "It’s fine");
  for (const good of ["Ambu® aScope 0º", "Crème brûlée", "Zürich © 2026", "Ãngel", "東京", "plain"]) {
    assertEquals(fixText(good), good);
  }
  for (const x of ["3M\u0099 Attest\u0099", "MickaÃ«l", "Itâ€™s"]) assertEquals(fixText(fixText(x)), fixText(x), "idempotent");
  assertEquals(fixText("a\u0000b\u0007c\td\ne"), "abc\td\ne");
  assertEquals(fixTextDeep({ t: "X\u0099", a: ["Ã«", 1], n: null }), { t: "X™", a: ["ë", 1], n: null });
});

Deno.test("upsertSignals: every string is repaired before the write", async () => {
  let sent: SignalInput[] = [];
  const supabase = { rpc: (_fn: string, args: { p_rows: SignalInput[] }) => { sent = args.p_rows; return Promise.resolve({ data: { inserted: 1 }, error: null }); } };
  await upsertSignals(supabase, "s", [sig("k", "2026-10-01T00:00:00Z", { title: "3M\u0099 Attest\u0099", payload: { device_name: "Attest\u0099" } })]);
  assertEquals([sent[0].title, sent[0].payload?.device_name], ["3M™ Attest™", "Attest™"]);
});

Deno.test({
  name: "runSignalSource: afterUpsert runs after the write; its error makes the run partial, its detail is kept",
  ...testOpts,
  async fn() {
    for (const [after, want] of [
      [() => Promise.resolve({ detail: { enriched: 2 } }), "success"],
      [() => Promise.resolve({ detail: { enriched: 0 }, error: "lookup failed" }), "partial"],
      [() => Promise.reject(new Error("boom")), "partial"],
    ] as const) {
      const { db, finished } = runDb(started);
      const { result } = await withFakes(db, noProviders, () => runSignalSource({
        supabase: createClient("http://supabase.test", "svc"), sourceKey: "s",
        fetcher: () => Promise.resolve({ signals: [sig("x", "2026-10-01T00:00:00Z")], fetched: 1 }),
        afterUpsert: after,
      }));
      assertEquals([result.status, finished[0].p_status, finished[0].p_inserted], [want, want, 1]);
      if (want === "success") assertEquals((finished[0].p_detail as Record<string, unknown>).enriched, 2);
    }
  },
});
