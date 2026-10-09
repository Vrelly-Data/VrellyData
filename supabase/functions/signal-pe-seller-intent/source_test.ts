// PE seller intent: mapper, scoring, admin-only visibility, keyset paging
// over signals_pe_candidates.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchPeSellerIntent, mapPeCandidate, type PeCandidate, scorePe } from "./source.ts";
import type { SourceContext } from "../_shared/signals.ts";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const row: PeCandidate = {
  person_key: "email:jane@northrim.example", last_at: "2026-10-05T14:00:00Z", first_at: "2026-09-01T10:00:00Z", interested_rows: 3,
  full_name: "Jane  Roe", job_title: "Founder & CEO", seniority: "owner", company_name: "Northrim Horizon",
  company_domain: "https://www.northrim.example/about", industry: "Construction", company_size: "27", city: "Austin",
  state: "TX", country: "United States", email: "Jane@Northrim.example", linkedin_url: "https://linkedin.com/in/janeroe",
  channel: "email", campaign_name: "Owner outreach Q3", source: "reply2_backfill",
  reply_text: "Tomos, thanks for the notes earlier this year. Happy to talk about a sale.",
};

Deno.test("mapPeCandidate: person/company/location/excerpt; dedupe pe:<person_key>; always admin", () => {
  const s = mapPeCandidate(row, NOW)!;
  assertEquals(s.signal_type, "seller_intent");
  assertEquals(s.dedupe_key, "pe:email:jane@northrim.example");
  assertEquals(s.visibility, "admin");
  assertEquals([s.person_name, s.person_title, s.person_email], ["Jane Roe", "Founder & CEO", "jane@northrim.example"]);
  assertEquals([s.company_name, s.company_domain], ["Northrim Horizon", "northrim.example"]);
  assertEquals([s.city, s.state, s.country], ["Austin", "TX", "United States"]);
  assertEquals(s.occurred_at, "2026-10-05T14:00:00.000Z");
  assertEquals(s.payload?.reply_excerpt, row.reply_text);
  assertEquals([s.payload?.industry, s.payload?.company_size, s.payload?.reply_date], ["Construction", "27", "2026-10-05T14:00:00.000Z"]);
  assertEquals(s.title, "Jane Roe, Founder & CEO at Northrim Horizon replied interested");
  assertEquals(s.url, null);
});

Deno.test("scorePe: owner/founder/CEO titles and recency raise the score", () => {
  const ownerRecent = scorePe(row, NOW);
  const ownerOld = scorePe({ ...row, last_at: "2024-01-01T00:00:00Z" }, NOW);
  const analystRecent = scorePe({ ...row, job_title: "Analyst" }, NOW);
  assertEquals(ownerRecent, 100);
  assert(ownerOld < ownerRecent && analystRecent < ownerRecent);
  assertEquals(scorePe({ ...row, job_title: "Owner", last_at: "2026-09-20T00:00:00Z" }, NOW), 90);
  assertEquals(scorePe({ ...row, job_title: "VP Ops", last_at: "2026-01-01T00:00:00Z" }, NOW), 40);
});

Deno.test("mapPeCandidate: missing names degrade gracefully; no person_key or date → skipped", () => {
  const s = mapPeCandidate({ person_key: "li:abc", last_at: "2026-10-01T00:00:00Z" }, NOW)!;
  assertEquals(s.title, "A SourceCo prospect replied interested");
  assertEquals(mapPeCandidate({ ...row, person_key: "" }, NOW), null);
  assertEquals(mapPeCandidate({ ...row, last_at: "nope" }, NOW), null);
});

Deno.test("fetch: first run is the backfill (since=null), keyset-paged on person_key; later runs overlap 2 days", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const all = Array.from({ length: 5 }, (_, i) => ({ ...row, person_key: `k${i}` }));
  const supabase = { rpc: (fn: string, args: Record<string, unknown>) => {
    assertEquals(fn, "signals_pe_candidates");
    calls.push(args);
    const after = args.p_after as string | null;
    const rest = all.filter((r) => after === null || r.person_key > after).slice(0, args.p_limit as number);
    return Promise.resolve({ data: rest, error: null });
  } };
  const ctx = (last: string | null): SourceContext => ({ supabase, source: { key: "pe_seller_intent", vertical: "private_equity", kind: "internal", cadence: "daily", default_visibility: "admin", config: {} },
    config: { backfill_sources: ["reply2_backfill"], page_size: 2 }, lastSuccessAt: last, fetchFn: fetch, now: NOW });
  const r = await fetchPeSellerIntent(ctx(null));
  assertEquals(calls.map((c) => c.p_after), [null, "k1", "k3"]);
  assertEquals(calls[0].p_since, null);
  assertEquals(calls[0].p_config, { backfill_sources: ["reply2_backfill"], page_size: 2 });
  assertEquals([r.fetched, r.signals.length, r.detail?.backfill], [5, 5, true]);
  calls.length = 0;
  await fetchPeSellerIntent(ctx("2026-10-08T13:05:00.000Z"));
  assertEquals(calls[0].p_since, "2026-10-06T13:05:00.000Z");
});
