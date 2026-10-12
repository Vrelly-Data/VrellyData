// openFDA 510(k): mapper against a LIVE response (fixture captured 2026-10-09)
// and the paged fetch (limit + skip) against a fake openFDA.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fda510kUrl, fetchOpenFda510k, map510k, score510k } from "./source.ts";
import type { SourceContext } from "../_shared/signals.ts";

const live = JSON.parse(Deno.readTextFileSync(new URL("../_shared/testing/signal_fixtures/openfda_510k.json", import.meta.url)));
const NOW = Date.parse("2026-10-09T15:00:00Z");

Deno.test("map510k: live record → company=applicant, person=contact, k_number dedupe, FDA page url", () => {
  const s = map510k(live.results[0], NOW)!;
  assertEquals(s.signal_type, "510k_cleared");
  assertEquals(s.dedupe_key, "510k:k260945");
  assertEquals(s.company_name, "Fit-Pro KFT (Ltd.) - DBA E-Fit");
  assertEquals(s.person_name, "Janos Papp"); // double space collapsed
  assertEquals(s.country, "HU");
  assertEquals(s.occurred_at, "2026-09-27T00:00:00.000Z");
  assertEquals(s.url, "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K260945");
  assertEquals(s.payload?.k_number, "K260945");
  assertEquals(s.payload?.decision_description, "Substantially Equivalent");
  assertEquals(s.payload?.product_code, null); // "" upstream
  assert(s.title.startsWith("Fit-Pro KFT (Ltd.) - DBA E-Fit cleared K260945: Ultima System"));
  assertEquals(s.visibility, undefined, "visibility comes from the source default (all_clients)");
});

Deno.test("map510k: openfda.* enrichment lands in the payload; missing k_number or date → skipped", () => {
  const s = map510k(live.results[1], NOW)!;
  assertEquals(s.dedupe_key, "510k:k252139");
  assert(typeof s.payload?.medical_specialty === "string" || Array.isArray(s.payload?.medical_specialty));
  assertEquals(map510k({ ...live.results[0], k_number: "" }, NOW), null);
  assertEquals(map510k({ ...live.results[0], decision_date: undefined }, NOW), null);
});

Deno.test("score510k: US + recent + SE + contact ranks above an old foreign record", () => {
  const us = score510k({ country_code: "US", decision_description: "Substantially Equivalent", decision_date: "2026-10-07", contact: "A B" }, NOW);
  const old = score510k({ country_code: "HU", decision_description: "Substantially Equivalent", decision_date: "2026-08-01" }, NOW);
  assertEquals(us, 100);
  assert(old < us && old >= 50);
  assertEquals(fda510kUrl("K1 2"), "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K1%202");
});

function ctx(fetchFn: typeof fetch, lastSuccessAt: string | null, config: Record<string, unknown> = {}): SourceContext {
  return { supabase: null, source: { key: "openfda_510k", vertical: "medical_device", kind: "api", cadence: "daily", default_visibility: "all_clients", config },
    config: { lookback_days_initial: 30, lookback_days: 10, page_size: 2, max_pages: 5, ...config }, lastSuccessAt, fetchFn, now: NOW };
}

Deno.test("fetch: first run uses lookback_days_initial; pages with limit+skip until total", async () => {
  const urls: string[] = [];
  const records = Array.from({ length: 5 }, (_, i) => ({ ...live.results[0], k_number: `K90000${i}` }));
  const fake = ((u: string) => {
    urls.push(u);
    const skip = Number(new URL(u).searchParams.get("skip"));
    return Promise.resolve(new Response(JSON.stringify({ meta: { last_updated: "2026-09-28", results: { skip, limit: 2, total: 5 } }, results: records.slice(skip, skip + 2) })));
  }) as unknown as typeof fetch;
  const r = await fetchOpenFda510k(ctx(fake, null));
  assertEquals(urls.length, 3);
  assert(urls[0].includes("decision_date:[20260909+TO+20261009]"), urls[0]);
  assertEquals(urls.map((u) => new URL(u).searchParams.get("skip")), ["0", "2", "4"]);
  assertEquals([r.fetched, r.signals.length, r.error], [5, 5, null]);
  assertEquals(r.detail?.window_days, 30);
});

Deno.test("fetch: later runs use lookback_days; 404 (no matches) is an empty success; 500 is an error", async () => {
  const urls: string[] = [];
  const notFound = ((u: string) => { urls.push(u); return Promise.resolve(new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })); }) as unknown as typeof fetch;
  const r = await fetchOpenFda510k(ctx(notFound, "2026-10-08T13:05:00Z"));
  assert(urls[0].includes("decision_date:[20260929+TO+20261009]"), urls[0]);
  assertEquals([r.fetched, r.error], [0, null]);
  const boom = (() => Promise.resolve(new Response("upstream down", { status: 500 }))) as unknown as typeof fetch;
  const r2 = await fetchOpenFda510k(ctx(boom, null));
  assert(r2.error?.includes("HTTP 500"));
});
