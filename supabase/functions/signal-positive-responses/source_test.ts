// High Intent (positive_response): mapper, NAMING (nothing client-visible
// reveals a reply), team scoping, markets, keyset paging, and the enrichment
// hook's wiring.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enrichPositiveResponses, fetchPositiveResponses, mapPositiveCandidate, type PositiveCandidate, scorePositive } from "./source.ts";
import type { SourceContext } from "../_shared/signals.ts";
import { signalCustomFields } from "../_shared/signal-resolver.ts";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const TEAM = "72e9eafb-8065-4079-8dc3-1349432c9305";
const row: PositiveCandidate = {
  scope_key: `${TEAM}:email:jane@northrim.example`, team_id: TEAM, team_default_market: "private_equity",
  person_key: "email:jane@northrim.example", last_at: "2026-10-05T14:00:00Z", first_at: "2026-09-01T10:00:00Z", interested_rows: 3,
  full_name: "Jane  Roe", job_title: "Founder & CEO", seniority: "owner", company_name: "Northrim Horizon",
  company_domain: "https://www.northrim.example/about", industry: "Construction", company_size: "11-50", city: "Austin",
  state: "TX", country: "United States", email: "Jane@Northrim.example", linkedin_url: "https://linkedin.com/in/janeroe",
  platform: "Smartlead", channel: "email", campaign_name: "Owner outreach Q3", source: "smartlead_backfill",
  reply_text: "Tomos, thanks for the notes earlier this year. Happy to talk about a sale.",
};

// Anything that would tell a client this came from someone replying to outbound.
const REVEALING = /\brepl(y|ied|ies)\b|\binterested\b|positive[ _]?response|campaign|smartlead|reply\.io|heyreach|outreach|excerpt|inference|channel/i;

Deno.test("mapPositiveCandidate: team-scoped High Intent; dedupe hi:<team>:<person>; markets from the team default", () => {
  const s = mapPositiveCandidate(row, NOW)!;
  assertEquals(s.signal_type, "positive_response");
  assertEquals(s.dedupe_key, `hi:${TEAM}:email:jane@northrim.example`);
  assertEquals([s.visibility, s.team_id], ["team", TEAM]);
  assertEquals(s.markets, ["private_equity"]);
  assertEquals([s.person_name, s.person_title, s.person_email], ["Jane Roe", "Founder & CEO", "jane@northrim.example"]);
  assertEquals([s.company_name, s.company_domain], ["Northrim Horizon", "northrim.example"]);
  assertEquals([s.industry, s.seniority, s.company_size], ["Construction", "owner", "11-50"]);
  assertEquals(s.occurred_at, "2026-10-05T14:00:00.000Z");
});

Deno.test("NAMING: title/payload/url carry no reply text, campaign, platform or channel; admin_detail does", () => {
  const s = mapPositiveCandidate(row, NOW)!;
  assertEquals(s.title, "High intent: Jane Roe, Founder & CEO at Northrim Horizon");
  assertEquals(s.url, null);
  assertEquals(s.payload, {});
  const clientVisible = JSON.stringify({ ...s, admin_detail: undefined, signal_type: undefined, dedupe_key: undefined });
  assert(!REVEALING.test(clientVisible), `client-visible fields leak: ${clientVisible}`);
  assert(!clientVisible.includes("Happy to talk about a sale"));
  assert(!clientVisible.includes("Owner outreach Q3"));
  // Admins keep the evidence.
  assertEquals(s.admin_detail?.reply_excerpt, row.reply_text);
  assertEquals([s.admin_detail?.campaign_name, s.admin_detail?.platform, s.admin_detail?.channel], ["Owner outreach Q3", "Smartlead", "email"]);
  // The custom field pushed into the client's Reply.io / Smartlead.
  const cf = signalCustomFields({ type: "positive_response", title: s.title, occurred_at: s.occurred_at, url: s.url ?? null });
  assertEquals(cf.signal_type, "high_intent");
  assert(!REVEALING.test(JSON.stringify(cf)));
});

Deno.test("mapPositiveCandidate: no team found → admin-only; no team default → markets from industry, else other", () => {
  const admin = mapPositiveCandidate({ ...row, team_id: null, team_default_market: null, scope_key: "admin:x" }, NOW)!;
  assertEquals([admin.visibility, admin.team_id, admin.dedupe_key], ["admin", null, "hi:admin:email:jane@northrim.example"]);
  assertEquals(admin.markets, ["other"]);
  const saas = mapPositiveCandidate({ ...row, team_default_market: null, industry: "Computer Software" }, NOW)!;
  assertEquals(saas.markets, ["saas"]);
  const seller = mapPositiveCandidate({ ...row, team_default_market: null, industry: null, keywords: "exit planning, sell my business" }, NOW)!;
  assertEquals(seller.markets, ["private_equity"]);
});

Deno.test("scorePositive: owner/founder/CEO titles and recency raise the score", () => {
  assertEquals(scorePositive(row, NOW), 100);
  assert(scorePositive({ ...row, last_at: "2024-01-01T00:00:00Z" }, NOW) < 100);
  assertEquals(scorePositive({ job_title: "VP Ops", last_at: "2026-01-01T00:00:00Z" }, NOW), 40);
});

Deno.test("mapPositiveCandidate: missing names degrade to the company / 'Unnamed contact'; no key or date → skipped", () => {
  assertEquals(mapPositiveCandidate({ ...row, full_name: null, job_title: null }, NOW)!.title, "High intent: Northrim Horizon");
  assertEquals(mapPositiveCandidate({ scope_key: "admin:li:abc", team_id: null, person_key: "li:abc", last_at: "2026-10-01T00:00:00Z" }, NOW)!.title,
    "High intent: Unnamed contact");
  assertEquals(mapPositiveCandidate({ ...row, person_key: "" }, NOW), null);
  assertEquals(mapPositiveCandidate({ ...row, last_at: "nope" }, NOW), null);
});

const ctxWith = (supabase: unknown, last: string | null, config: Record<string, unknown> = { page_size: 2 }): SourceContext => ({
  supabase,
  source: { key: "positive_responses", signal_type: "positive_response", default_markets: [], kind: "internal", cadence: "hourly", default_visibility: "team", config },
  config, lastSuccessAt: last, fetchFn: fetch, now: NOW,
});

Deno.test("fetch: first run is the backfill (since=null), keyset-paged on scope_key; later runs overlap 2 days", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const all = Array.from({ length: 5 }, (_, i) => ({ ...row, person_key: `k${i}`, scope_key: `${TEAM}:k${i}` }));
  const supabase = { rpc: (fn: string, args: Record<string, unknown>) => {
    assertEquals(fn, "signals_positive_candidates");
    calls.push(args);
    const after = args.p_after as string | null;
    const rest = all.filter((r) => after === null || r.scope_key > after).slice(0, args.p_limit as number);
    return Promise.resolve({ data: rest, error: null });
  } };
  const r = await fetchPositiveResponses(ctxWith(supabase, null));
  assertEquals(calls.map((c) => c.p_after), [null, `${TEAM}:k1`, `${TEAM}:k3`]);
  assertEquals(calls[0].p_since, null);
  assertEquals([r.fetched, r.signals.length, r.detail?.backfill], [5, 5, true]);
  calls.length = 0;
  await fetchPositiveResponses(ctxWith(supabase, "2026-10-08T13:05:00.000Z"));
  assertEquals(calls[0].p_since, "2026-10-06T13:05:00.000Z");
});

Deno.test("enrich hook: queue → free lookups → apply (signal + inference write-back); empty queue does nothing", async () => {
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const queue = [{
    signal_id: "s1", team_id: TEAM, team_default_market: null, person_key: "email:a@acme.io", person_name: "Ann Lee",
    company_name: "Acme", company_domain: null, email: "a@acme.io", linkedin: null, industry: null, person_title: null,
    seniority: null, city: null, state: null, country: null, company_size: null, keywords: null, apollo_done: false, free_done: false,
  }];
  const supabase = { rpc: (fn: string, args: Record<string, unknown>) => {
    rpcs.push([fn, args]);
    if (fn === "signals_hi_enrichment_queue") return Promise.resolve({ data: queue, error: null });
    if (fn === "signals_hi_free_lookups") {
      return Promise.resolve({ data: {
        by_email: [{ email: "a@acme.io", person_title: "CEO", seniority: "c_suite", state: "TX", country: "United States", industry: "Computer Software", company_size: "11-50" }],
        by_domain: [], inference: [],
      }, error: null });
    }
    if (fn === "signals_hi_team_apollo") return Promise.resolve({ data: [{ team_id: TEAM, enabled: false, user_id: null, agent_config_id: null }], error: null });
    if (fn === "signals_hi_apply_enrichment") return Promise.resolve({ data: { signals: 1, inference_rows: 2 }, error: null });
    throw new Error(`unexpected rpc ${fn}`);
  } };
  const out = await enrichPositiveResponses(ctxWith(supabase, null));
  assertEquals(out.error, null);
  assertEquals(out.detail?.enriched, 1);
  assertEquals(out.detail?.inference_rows_written_back, 2);
  const apply = rpcs.find(([fn]) => fn === "signals_hi_apply_enrichment")![1].p_rows as Array<Record<string, unknown>>;
  assertEquals(apply[0].title, "High intent: Ann Lee, CEO at Acme");
  assertEquals(apply[0].markets, ["saas"]);
  assertEquals((apply[0].filled as Record<string, string>).person_title, "prospects_email");

  const empty = { rpc: () => Promise.resolve({ data: [], error: null }) };
  assertEquals((await enrichPositiveResponses(ctxWith(empty, null))).detail, { enrich_queue: 0 });
});
