// Signal Inputs: filter normalization, upstream request shapes, matching, mappers.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { missingFilters, normalizeGithub, normalizeHiring, normalizeMedical, writersForInput } from "./filters.ts";
import {
  type AdapterCtx, apolloJobLocations, apolloSearchBody, fdaClauses, githubQueries, type InputRow, locationMatches,
  openFdaUrl, parseBreakthroughTable, runGithub, runHiring, runMedical, titleMatches,
} from "./sources.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const input: InputRow = { id: "11111111-1111-1111-1111-111111111111", team_id: "team-1", source_key: "hiring", name: "Hiring CMO in California", all_clients: false };

function fakeFetch(routes: Array<[RegExp, (url: string, init?: RequestInit) => unknown, number?]>) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fn = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const [re, h, status] of routes) {
      if (re.test(url)) return new Response(JSON.stringify(h(url, init)), { status: status ?? 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}
const ctx = (fetchFn: typeof fetch, extra: Partial<AdapterCtx> = {}): AdapterCtx => ({
  fetchFn, now: NOW, preview: false, config: {}, apolloKey: "k", githubToken: null, apolloCreditsLeft: 100, ...extra,
});

Deno.test("filters: bounded, de-duplicated, invalid values dropped", () => {
  const h = normalizeHiring({ job_titles: ["CMO", "cmo", " Chief Marketing Officer "], locations: ["California", { country: "US", city: "" }],
    company_sizes: ["11,50", "bogus"], posted_within_days: 500 });
  assertEquals(h.job_titles, ["CMO", "Chief Marketing Officer"]);
  assertEquals(h.locations, [{ country: null, state: "California", city: null }, { country: "US", state: null, city: null }]);
  assertEquals([h.company_sizes, h.posted_within_days], [["11,50"], 90]);
  assertEquals(missingFilters("hiring", normalizeHiring({})), "add at least one job title");
  const g = normalizeGithub({ topics: ["Clinical Trials", "bad topic!"], orgs: ["ok-org", "not ok"], min_stars: -3 });
  assertEquals([g.topics, g.orgs, g.min_stars, g.activity], [["clinical-trials"], ["ok-org"], 0, "created"]);
  const m = normalizeMedical({ sources: ["510k", "nope", "clinical_trials"], product_codes: ["hrs", "TOOLONG"] });
  assertEquals([m.sources, m.product_codes, m.within_days], [["510k", "clinical_trials"], ["HRS"], 30]);
});

Deno.test("writersForInput: a medical input runs only the writers of its selected sources", () => {
  assertEquals(writersForInput("medical", normalizeMedical({ sources: ["510k", "clinical_trials"] })), ["input_fda_clearance", "input_clinical_trial"]);
  assertEquals(writersForInput("medical", normalizeMedical({ sources: ["pma", "denovo", "breakthrough"] })), ["input_fda_clearance"]);
  assertEquals(writersForInput("medical", normalizeMedical({})), ["input_fda_clearance"]);
  assertEquals(writersForInput("hiring", normalizeHiring({ job_titles: ["CMO"] })), ["input_hiring"]);
});

Deno.test("hiring: Apollo search body uses the job-posting filters, job locations lowercased", () => {
  const f = normalizeHiring({ job_titles: ["CMO"], locations: [{ state: "CA" }, { city: "Austin", state: "Texas" }, { country: "Germany" }],
    company_sizes: ["51,200"], industries: ["software"], posted_within_days: 14 });
  assertEquals(apolloJobLocations(f.locations), ["california", "austin, texas", "germany"]);
  assertEquals(apolloSearchBody(f, NOW, 100), {
    q_organization_job_titles: ["CMO"], organization_job_posted_at_range: { min: "2026-10-02" }, page: 1, per_page: 100,
    organization_job_locations: ["california", "austin, texas", "germany"], organization_num_employees_ranges: ["51,200"],
    q_organization_keyword_tags: ["software"],
  });
});

Deno.test("hiring: title and location matching (CMO = Chief Marketing Officer; CA = California)", () => {
  assert(titleMatches("Chief Marketing Officer (CMO)", ["CMO"]));
  assert(titleMatches("Fractional CMO", ["Chief Marketing Officer"]));
  assert(!titleMatches("Marketing Coordinator", ["CMO"]));
  assert(!titleMatches("CMOS Engineer", ["CMO"]));
  assert(locationMatches({ city: "San Diego", state: "CA", country: "United States" }, [{ state: "California" }]));
  assert(!locationMatches({ city: "Austin", state: "TX", country: "United States" }, [{ state: "California" }]));
  assert(locationMatches({ state: "Texas", country: "US" }, [{ country: "United States" }]));
  assert(locationMatches({}, []));
});

Deno.test("hiring run: 1 credit per search + 1 per postings check; only companies with a matching posting are confirmed", async () => {
  const { fn, calls } = fakeFetch([
    [/mixed_companies\/search/, () => ({
      pagination: { total_entries: 3 },
      organizations: [
        { id: "o1", name: "Acme", primary_domain: "acme.com", industry: "software", estimated_num_employees: 120 },
        { id: "o2", name: "Beta", primary_domain: "beta.io" },
      ],
      accounts: [{ id: "a3", organization_id: "o3", name: "Gamma" }, { id: "dup", organization_id: "o1", name: "Acme" }],
    })],
    [/organizations\/o1\/job_postings/, () => ({ organization_job_postings: [
      { title: "Chief Marketing Officer", city: "San Francisco", state: "California", country: "United States", posted_at: "2026-10-10T00:00:00Z", url: "https://jobs/acme" },
    ] })],
    [/organizations\/o2\/job_postings/, () => ({ organization_job_postings: [
      { title: "Chief Marketing Officer", state: "New York", country: "United States", posted_at: "2026-10-10T00:00:00Z" },
    ] })],
  ]);
  const f = normalizeHiring({ job_titles: ["CMO"], locations: ["California"], posted_within_days: 30 });
  const r = await runHiring(input, f, ctx(fn, { config: { apollo_max_postings_lookups: 2 } }));
  assertEquals(calls.length, 3);
  assertEquals(r.credits, 3);
  assertEquals(r.total, 3);
  assertEquals(r.detail, { apollo_total: 3, companies: 3, postings_lookups: 2, verified: 1, unmatched: 1 });
  assertEquals(r.signals.map((s) => s.company_name), ["Acme", "Gamma"], "Beta's only CMO role is in New York; Gamma was not checked");
  const acme = r.signals[0];
  assertEquals([acme.url, acme.state, acme.company_size, acme.visibility, acme.team_id], ["https://jobs/acme", "California", "101-200".replace("101", "51"), "team", "team-1"]);
  assertEquals((acme.payload as Record<string, unknown>).input_id, input.id);
  assertEquals((r.signals[1].payload as Record<string, unknown>).verified, false);
  assert(acme.dedupe_key.startsWith(`in:${input.id}:apollo-org:`));
});

Deno.test("hiring preview: one search call, no postings checks, nothing to write beyond the count", async () => {
  const { fn, calls } = fakeFetch([[/mixed_companies\/search/, () => ({ pagination: { total_entries: 42 }, organizations: [{ id: "o1", name: "Acme" }] })]]);
  const r = await runHiring(input, normalizeHiring({ job_titles: ["CMO"] }), ctx(fn, { preview: true }));
  assertEquals([calls.length, r.credits, r.total, r.sample.length], [1, 1, 42, 1]);
  assertEquals((calls[0].body as Record<string, unknown>).per_page, 5);
  const capped = await runHiring(input, normalizeHiring({ job_titles: ["CMO"] }), ctx(fn, { apolloCreditsLeft: 0 }));
  assertEquals([capped.credits, capped.error], [0, "Apollo credit cap for Signal Inputs reached today"]);
});

Deno.test("github: query qualifiers; one query per topic", () => {
  const f = normalizeGithub({ keywords: ["clinical trial", "edc"], orgs: ["acme"], min_stars: 5, topics: ["clinical-trials", "healthcare"] });
  assertEquals(githubQueries(f, NOW), [
    `"clinical trial" OR edc org:acme stars:>=5 created:>=2026-09-16 fork:false archived:false topic:clinical-trials`,
    `"clinical trial" OR edc org:acme stars:>=5 created:>=2026-09-16 fork:false archived:false topic:healthcare`,
  ]);
});

Deno.test("github: organizations only pages past personal repos (3 pages without a token) and counts org repos", async () => {
  const repo = (id: number, type: string) => ({ id, full_name: `o${id}/r`, html_url: `https://github.com/o${id}/r`, stargazers_count: 0,
    created_at: "2026-10-10T00:00:00Z", owner: { login: `o${id}`, type } });
  const page = (n: number) => Array.from({ length: 100 }, (_, i) => repo(n * 1000 + i, i < 2 ? "Organization" : "User"));
  const { fn, calls } = fakeFetch([[/api\.github\.com\/search\/repositories/, (url) => ({
    total_count: 485, items: page(Number(new URL(url).searchParams.get("page"))) })]]);
  const gh: InputRow = { ...input, source_key: "github" };
  const f = normalizeGithub({ keywords: ["clinical trial"], owner: "org" });
  const run = await runGithub(gh, f, ctx(fn));
  assertEquals([calls.length, run.signals.length, run.total], [3, 6, 6]);
  assert(calls.every((c) => c.url.includes("per_page=100")));
  assertEquals(run.detail, { queries: 1, authenticated: false, scanned: 300, github_total: 485 });
  assert(run.signals.every((s) => s.company_name?.startsWith("o")));
  const prev = await runGithub(gh, f, ctx(fakeFetch([[/api\.github\.com/, (url) => ({ total_count: 485, items: page(Number(new URL(url).searchParams.get("page"))) })]]).fn, { preview: true }));
  assertEquals([prev.total, prev.signals.length, prev.sample.length], [6, 5, 5]);
  const any = await runGithub(gh, normalizeGithub({ keywords: ["clinical trial"] }), ctx(fakeFetch([[/api\.github\.com/, () => ({ total_count: 485, items: page(1).slice(0, 50) })]]).fn));
  assertEquals([any.total, any.signals.length], [485, 50]);
});

Deno.test("openFDA: clauses per endpoint, spaces as '+'", () => {
  const f = normalizeMedical({ sources: ["510k"], specialties: ["Orthopedic"], product_codes: ["HRS"], device_keywords: ["knee"], within_days: 30 });
  const c = fdaClauses("510k", f, NOW);
  assertEquals(c, [
    "decision_date:[20260916 TO 20261016]", `(product_code:"HRS")`, `(advisory_committee_description:"Orthopedic")`,
    `(device_name:"knee")`,
  ]);
  const url = openFdaUrl("510k", c, "decision_date", 5);
  assert(url.startsWith("https://api.fda.gov/device/510k.json?search=decision_date%3A%5B20260916+TO+20261016%5D+AND+"));
  assert(url.endsWith("&sort=decision_date:desc&limit=5"));
  assertEquals(fdaClauses("registrationlisting", f, NOW)[0], "products.created_date:[20260916 TO 20261016]");
});

Deno.test("breakthrough table parser", () => {
  const html = `<table><tr><th>Criteria</th></tr></table><table><tr><th>Manufacturer</th><th>Trade Name</th><th>Marketing Submission Number</th><th>Marketing Submission Decision Date</th></tr>
    <tr><td>PHAST CORP.</td><td>PHAST &amp; PANEL</td><td>k253316</td><td>06/26/2026</td></tr><tr><td>x</td><td>y</td><td>z</td><td>soon</td></tr></table>`;
  assertEquals(parseBreakthroughTable(html), [{ manufacturer: "PHAST CORP.", trade_name: "PHAST & PANEL", submission: "K253316", decision_date: "2026-06-26" }]);
});

Deno.test("medical run: 510(k)/De Novo, PMA originals only, trials; each tagged Medical Device and scoped to the team", async () => {
  const med: InputRow = { ...input, source_key: "medical", name: "Ortho" };
  const { fn } = fakeFetch([
    [/510k\.json/, () => ({ meta: { results: { total: 2 } }, results: [
      { k_number: "K260001", applicant: "Ortho Co", device_name: "Knee", decision_date: "2026-10-01", decision_code: "SESE", product_code: "HRS" },
      { k_number: "DEN250001", applicant: "Nova", device_name: "Hip", decision_date: "2026-10-02", decision_code: "DENG" },
    ] })],
    [/pma\.json/, () => ({ meta: { results: { total: 2 } }, results: [
      { pma_number: "P250001", supplement_number: "", applicant: "Big Ortho", decision_date: "2026-10-03", trade_name: "Spine X" },
      { pma_number: "P100001", supplement_number: "S010", applicant: "Old", decision_date: "2026-10-03" },
    ] })],
    [/clinicaltrials\.gov/, () => ({ totalCount: 1, studies: [{ protocolSection: {
      identificationModule: { nctId: "NCT0001", briefTitle: "Knee implant study" }, statusModule: { studyFirstPostDateStruct: { date: "2026-10-05" } },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Ortho Co", class: "INDUSTRY" } },
      contactsLocationsModule: { locations: [{ country: "United States" }] } } }] })],
  ]);
  const f = normalizeMedical({ sources: ["510k", "denovo", "pma", "clinical_trials"], specialties: ["Orthopedic"] });
  const clr = await runMedical("input_fda_clearance", med, f, ctx(fn));
  assertEquals(clr.signals.map((s) => (s.payload as Record<string, unknown>).kind), ["510k", "de_novo", "pma"]);
  assert(clr.signals.every((s) => s.markets?.[0] === "medical_device" && s.team_id === "team-1"));
  const trials = await runMedical("input_clinical_trial", med, f, ctx(fn));
  assertEquals([trials.signals.length, trials.signals[0].company_name, trials.signals[0].signal_type], [1, "Ortho Co", "clinical_trial"]);
  const none = await runMedical("input_fda_recall", med, f, ctx(fn));
  assertEquals([none.signals.length, none.total], [0, 0], "recalls not selected → nothing fetched");
});
