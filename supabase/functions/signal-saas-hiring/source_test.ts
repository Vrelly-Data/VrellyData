// SaaS hiring: Greenhouse / Lever / Ashby mappers against LIVE responses
// (fixtures captured 2026-10-09), keyword scoring, age filter, per-board errors.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Board, fetchSaasHiring, fromAshby, fromGreenhouse, fromLever, mapPosting, matchedKeywords, parseBoard, readBoards, DEFAULT_ROLE_KEYWORDS } from "./source.ts";
import type { SourceContext } from "../_shared/signals.ts";

const fx = (n: string) => JSON.parse(Deno.readTextFileSync(new URL(`../_shared/testing/signal_fixtures/${n}`, import.meta.url)));
const NOW = Date.parse("2026-10-09T15:00:00Z");

Deno.test("Greenhouse: live job → posting (department, location, first_published) → hiring signal", () => {
  const p = fromGreenhouse(fx("greenhouse_jobs.json").jobs[0])!;
  assertEquals([p.id, p.title, p.department, p.location], ["8184174", "Account Manager", "Business Development", "London, United Kingdom"]);
  assertEquals(p.published_at, "2026-09-09T08:35:19.000Z");
  const s = mapPosting({ ats: "greenhouse", token: "airbnb" }, p, DEFAULT_ROLE_KEYWORDS, NOW)!;
  assertEquals(s.dedupe_key, "job:greenhouse:airbnb:8184174");
  assertEquals(s.company_name, "Airbnb"); // from the board's company_name
  assertEquals(s.url, "https://careers.airbnb.com/positions/8184174?gh_jid=8184174");
  assertEquals(s.title, "Airbnb is hiring: Account Manager (London, United Kingdom)");
  assertEquals(s.payload?.department, "Business Development");
  assertEquals([s.signal_type, s.markets], ["hiring", ["other"]], "no industry known → other");
  const staffing = mapPosting({ ats: "greenhouse", token: "x", industry: "Staffing and Recruiting" }, p, [], NOW)!;
  assertEquals([staffing.markets, staffing.industry], [["recruiting"], "Staffing and Recruiting"]);
  assertEquals(mapPosting({ ats: "greenhouse", token: "x", industry: "Computer Software" }, p, [], NOW)!.markets, ["saas"]);
});

Deno.test("Lever: live posting → team as department, createdAt ms → ISO", () => {
  const p = fromLever(fx("lever_postings.json")[0])!;
  assertEquals([p.id, p.title, p.department, p.location], ["6ed76ce8-4156-4b60-b120-403538bd66cd", "Administrative Business Partner", "Administrative", "Singapore, Singapore"]);
  assertEquals(p.published_at, "2026-08-11T17:38:11.368Z");
  assertEquals(p.url, "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd");
  const s = mapPosting({ ats: "lever", token: "palantir", company_name: "Palantir", company_domain: "palantir.com" }, p, [], NOW)!;
  assertEquals([s.dedupe_key, s.company_name, s.company_domain], ["job:lever:palantir:6ed76ce8-4156-4b60-b120-403538bd66cd", "Palantir", "palantir.com"]);
});

Deno.test("Ashby: live job → postal address to city/state/country; unlisted jobs dropped", () => {
  const j = fx("ashby_jobs.json").jobs[0];
  const p = fromAshby(j)!;
  assertEquals([p.title, p.department, p.city, p.state, p.country], ["Security Engineer, Cloud", "Engineering", "New York City", "NY", "USA"]);
  assertEquals(p.url, "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245");
  assertEquals(fromAshby({ ...j, isListed: false }), null);
  assertEquals(parseBoard("ashby", fx("ashby_jobs.json")).length, 2);
  assertEquals(parseBoard("lever", { not: "an array" }).length, 0);
});

Deno.test("role keywords: whole words, case-insensitive; a match raises the score", () => {
  assertEquals(matchedKeywords("Senior Account Executive, Mid-Market", DEFAULT_ROLE_KEYWORDS), ["Account Executive"]);
  assertEquals(matchedKeywords("SDR Team Lead", DEFAULT_ROLE_KEYWORDS), ["SDR"]);
  assertEquals(matchedKeywords("Head of Sales & RevOps", DEFAULT_ROLE_KEYWORDS), ["Head of Sales", "RevOps"]);
  assertEquals(matchedKeywords("SDRAM firmware engineer", DEFAULT_ROLE_KEYWORDS), []);
  const b: Board = { ats: "ashby", token: "x" };
  const base = { id: "1", department: "Sales", location: null, url: null, published_at: "2026-10-08T00:00:00Z", company_name: null };
  const ae = mapPosting(b, { ...base, title: "Account Executive" }, DEFAULT_ROLE_KEYWORDS, NOW)!;
  const eng = mapPosting(b, { ...base, title: "Backend Engineer", department: "Engineering" }, DEFAULT_ROLE_KEYWORDS, NOW)!;
  assertEquals([ae.score, eng.score], [100, 50]);
  assertEquals(ae.payload?.matched_keywords, ["Account Executive"]);
});

Deno.test("readBoards: drops malformed entries and unknown ATSs", () => {
  assertEquals(readBoards({ boards: [{ ats: "greenhouse", token: " airbnb " }, { ats: "workday", token: "x" }, { ats: "lever" }, null] }), [{ ats: "greenhouse", token: "airbnb" }]);
  assertEquals(readBoards({}), []);
});

Deno.test("fetch: only postings within max_age_days; a failing board is reported, the others still land", async () => {
  const fake = ((u: string) => {
    if (u.includes("greenhouse")) return Promise.resolve(new Response(JSON.stringify(fx("greenhouse_jobs.json"))));
    if (u.includes("lever")) return Promise.resolve(new Response("nope", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(fx("ashby_jobs.json"))));
  }) as unknown as typeof fetch;
  const config = { boards: [{ ats: "greenhouse", token: "airbnb" }, { ats: "lever", token: "missing" }, { ats: "ashby", token: "ramp" }], max_age_days: 60 };
  const ctx: SourceContext = { supabase: null, source: { key: "saas_hiring", signal_type: "hiring", default_markets: [], kind: "api", cadence: "daily", default_visibility: "all_clients", config }, config, lastSuccessAt: null, fetchFn: fake, now: NOW };
  const r = await fetchSaasHiring(ctx);
  assertEquals(r.fetched, 4);
  assertEquals(r.signals.map((s) => s.dedupe_key), ["job:greenhouse:airbnb:8184174"]); // the others are older than 60 days
  assert(r.error?.includes("lever:missing HTTP 404"));
  const empty = await fetchSaasHiring({ ...ctx, config: { boards: [] } });
  assertEquals([empty.signals.length, empty.error, empty.detail?.watchlist_size], [0, null, 0]);
});
