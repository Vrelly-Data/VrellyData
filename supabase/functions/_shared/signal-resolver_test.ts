import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ApolloEnrichedPerson, ApolloSearchPerson } from "./apollo.ts";
import { compileSignalAudience } from "./signal-audience.ts";
import {
  type CachedContact, type CandidateSignal, emailAtDomain, type EnrichResult, type FreeResolution,
  passesUsRules, type ResolverDeps, resolveSignals, signalCustomFields,
} from "./signal-resolver.ts";

const sig = (id: string, over: Partial<CandidateSignal> = {}): CandidateSignal => ({
  id, source_key: "openfda_510k", vertical: "medical_device", signal_type: "510k_cleared",
  occurred_at: "2026-09-27T00:00:00Z", title: `Acme ${id} cleared K1`, url: "https://fda.example/K1", score: 80,
  company_name: `Acme ${id}`, company_domain: null, person_name: null, person_title: null,
  city: null, state: "TX", country: "US", ...over,
});

const vrellyPerson = (email: string) => ({
  source: "vrelly" as const, prospect_id: crypto.randomUUID(), email, first_name: "Ann", last_name: "Lee",
  title: "CEO", linkedin_url: null, company_name: "Acme", company_domain: "acme.com", city: null, state: "TX", country: "US",
});

const searchPerson = (id: string, title: string, has_email = true): ApolloSearchPerson => ({
  apollo_person_id: id, first_name: "Bo", last_name_obfuscated: "K***", title, organization_name: "Beta",
  has_email, has_direct_phone: false, has_city: true, has_state: true, has_country: true,
  org_has_industry: true, org_has_employee_count: true, org_has_revenue: false, org_has_phone: false, last_refreshed_at: null,
});

const enriched = (id: string, email: string, title = "CEO", country = "United States"): ApolloEnrichedPerson => ({
  apollo_person_id: id, first_name: "Bo", last_name: "Kim", name: "Bo Kim", title, email, email_status: "verified",
  linkedin_url: `https://linkedin.com/in/${id}`, organization_name: "Beta", organization_domain: "beta.com",
  organization_industry: null, organization_employee_count: null, organization_revenue: null,
  city: "Austin", state: "Texas", country, revealed_for_current_team: null, contact_id: null,
});

interface Log { search: string[]; enrich: string[][]; cacheWrites: number; lookups: string[] }

function fakeDeps(opts: {
  free: FreeResolution[];
  refused?: number;
  search?: (domain: string) => ApolloSearchPerson[] | Error;
  enrich?: (ids: string[]) => EnrichResult;
  cache?: Map<string, CachedContact[]>;
  lookups?: Map<string, { apollo_searched_at: string | null; apollo_candidates: number }>;
  pushedApollo?: string[];
  knownEmails?: string[];
}): { deps: ResolverDeps; log: Log } {
  const log: Log = { search: [], enrich: [], cacheWrites: 0, lookups: [] };
  const deps: ResolverDeps = {
    resolveFree: (ids) => Promise.resolve({ signals: opts.free.filter((f) => ids.includes(f.signal_id)), refused: opts.refused ?? 0 }),
    readCache: () => Promise.resolve(opts.cache ?? new Map()),
    readLookups: () => Promise.resolve(opts.lookups ?? new Map()),
    apolloSearch: (domain) => {
      log.search.push(domain);
      const r = opts.search?.(domain) ?? [];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    apolloEnrich: (ids) => {
      log.enrich.push(ids);
      return Promise.resolve(opts.enrich?.(ids) ?? { people: [], credits_spent: 0, insufficient_credits: false, failed: 0 });
    },
    pushedApolloIds: (ids) => Promise.resolve(new Set(ids.filter((i) => (opts.pushedApollo ?? []).includes(i)))),
    knownContacts: (emails) => Promise.resolve({ emails: new Set(emails.filter((e) => (opts.knownEmails ?? []).includes(e))), linkedins: new Set() }),
    writeCache: (rows) => { log.cacheWrites += rows.length; return Promise.resolve(); },
    writeLookup: (row) => { log.lookups.push(`${row.company_key}:${row.apollo_candidates}`); return Promise.resolve(); },
  };
  return { deps, log };
}

const compiled = (extra: Record<string, unknown> = {}) =>
  compileSignalAudience({ persona: { job_titles: ["CEO"] }, max_per_company: 2, ...extra });

const free = (id: string, people: ReturnType<typeof vrellyPerson>[], domain: string | null = null, derived: string | null = null): FreeResolution => ({
  signal_id: id, company_key: domain || derived ? `d:${domain ?? derived}` : null, domain, derived_domain: derived, people,
});

Deno.test("order: free sources first — Apollo is never called for a company Vrelly matched", async () => {
  const { deps, log } = fakeDeps({ free: [free("a", [vrellyPerson("ann@acme.com")], "acme.com")] });
  const o = await resolveSignals([sig("a")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o.resolved[0].apollo, "not_needed");
  assertEquals(o.resolved[0].people.map((p) => p.source), ["vrelly"]);
  assertEquals(log.search, []);
  assertEquals(log.enrich, []);
  assertEquals(o.credits_spent, 0);
});

Deno.test("order: Apollo only for the companies with nobody, on the derived domain", async () => {
  const { deps, log } = fakeDeps({
    free: [free("a", [vrellyPerson("ann@acme.com")], "acme.com"), free("b", [], null, "beta.com")],
    search: () => [searchPerson("p1", "CEO")],
    enrich: (ids) => ({ people: ids.map((i) => enriched(i, `${i}@beta.com`)), credits_spent: ids.length, insufficient_credits: false, failed: 0 }),
  });
  const o = await resolveSignals([sig("a"), sig("b")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(log.search, ["beta.com"]);
  assertEquals(log.enrich, [["p1"]]);
  assertEquals(o.resolved[1].apollo, "enriched");
  assertEquals(o.resolved[1].people[0].source, "apollo");
  assertEquals(o.resolved[1].people[0].email, "p1@beta.com");
  assertEquals(o.credits_spent, 1);
  assertEquals(log.cacheWrites, 1);
});

Deno.test("cache: a company bought before is served from signal_contacts at no cost", async () => {
  const cached: CachedContact = {
    ...enriched("p9", "p9@beta.com"), source: "apollo", email: "p9@beta.com", linkedin_url: null,
    company_name: "Beta", company_domain: "beta.com", company_key: "d:beta.com", resolved_at: new Date().toISOString(),
  } as unknown as CachedContact;
  const { deps, log } = fakeDeps({ free: [free("b", [], "beta.com")], cache: new Map([["d:beta.com", [cached]]]) });
  const o = await resolveSignals([sig("b")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o.resolved[0].apollo, "cached");
  assertEquals(o.resolved[0].people[0].cached, true);
  assertEquals(log.search, []);
  assertEquals(log.enrich, []);
  assertEquals(o.credits_spent, 0);
});

Deno.test("cache: an expired cache row is not served", async () => {
  const old = { company_key: "d:beta.com", resolved_at: "2026-01-01T00:00:00Z", source: "apollo", email: "x@beta.com" } as unknown as CachedContact;
  const { deps, log } = fakeDeps({ free: [free("b", [], "beta.com")], cache: new Map([["d:beta.com", [old]]]) });
  await resolveSignals([sig("b")], { mode: "preview", compiled: compiled(), budget: 0 }, deps);
  assertEquals(log.search, ["beta.com"]);
});

Deno.test("lookups: Apollo is not searched again for a company it had nobody at (30 days)", async () => {
  const { deps, log } = fakeDeps({
    free: [free("b", [], "beta.com")],
    lookups: new Map([["d:beta.com", { apollo_searched_at: new Date().toISOString(), apollo_candidates: 0 }]]),
  });
  const o = await resolveSignals([sig("b")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o.resolved[0].apollo, "none_found");
  assertEquals(log.search, []);
});

Deno.test("preview: Apollo candidates are searched (free) but never enriched; credits estimated", async () => {
  const { deps, log } = fakeDeps({
    free: [free("b", [], "beta.com"), free("c", [], "gamma.com")],
    search: (d) => d === "beta.com" ? [searchPerson("p1", "CEO"), searchPerson("p2", "CEO"), searchPerson("p3", "CEO")] : [searchPerson("q1", "CEO")],
  });
  const o = await resolveSignals([sig("b"), sig("c")], { mode: "preview", compiled: compiled(), budget: 0 }, deps);
  assertEquals(log.enrich, []);
  assertEquals(o.estimated_credits, 3); // 2 (max per company) + 1
  assertEquals(o.resolved[0].people.every((p) => p.pending && p.email === null), true);
  assertEquals(o.credits_spent, 0);
});

Deno.test("cap: the monthly budget stops enrichment cleanly; later companies are skipped, not bought", async () => {
  const { deps, log } = fakeDeps({
    free: [free("b", [], "beta.com"), free("c", [], "gamma.com"), free("d", [], "delta.com")],
    search: (d) => [searchPerson(`${d}-1`, "CEO"), searchPerson(`${d}-2`, "CEO")],
    enrich: (ids) => ({ people: ids.map((i) => enriched(i, `${i.split("-")[0].split(".")[0]}@${i.split("-")[0]}`)), credits_spent: ids.length, insufficient_credits: false, failed: 0 }),
  });
  const o = await resolveSignals([sig("b"), sig("c"), sig("d")], { mode: "run", compiled: compiled(), budget: 3 }, deps);
  assertEquals(log.enrich, [["beta.com-1", "beta.com-2"], ["gamma.com-1"]]);
  assertEquals(o.credits_spent, 3);
  assertEquals(o.stop_reason, "monthly_cap");
  assertEquals(o.resolved[2].apollo, "budget");
  assertEquals(log.search, ["beta.com", "gamma.com"]); // delta never searched
});

Deno.test("cap: a zero budget buys nothing at all", async () => {
  const { deps, log } = fakeDeps({ free: [free("b", [], "beta.com")], search: () => [searchPerson("p1", "CEO")] });
  const o = await resolveSignals([sig("b")], { mode: "run", compiled: compiled(), budget: 0 }, deps);
  assertEquals(log.enrich, []);
  assertEquals(log.search, []);
  assertEquals(o.stop_reason, "monthly_cap");
  assertEquals(o.resolved[0].apollo, "budget");
});

Deno.test("422: insufficient credits keeps what was bought and stops the fallback", async () => {
  let calls = 0;
  const { deps, log } = fakeDeps({
    free: [free("b", [], "beta.com"), free("c", [], "gamma.com")],
    search: (d) => [searchPerson(`${d}`, "CEO")],
    enrich: (ids) => {
      calls++;
      return { people: [enriched(ids[0], "x@beta.com")], credits_spent: 1, insufficient_credits: true, failed: 0 };
    },
  });
  const o = await resolveSignals([sig("b"), sig("c")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(calls, 1);
  assertEquals(o.stop_reason, "apollo_insufficient_credits");
  assertEquals(o.resolved[0].people.length, 1);
  assertEquals(o.resolved[1].apollo, "insufficient_credits");
  assertEquals(log.search, ["beta.com"]);
});

Deno.test("persona: Apollo's fuzzy titles are re-checked as whole words BEFORE paying", async () => {
  const { deps, log } = fakeDeps({
    free: [free("b", [], "beta.com")],
    search: () => [searchPerson("p1", "CEO Assistant"), searchPerson("p2", "Chief Executive"), searchPerson("p3", "CEO", false), searchPerson("p4", "Co-founder & CEO")],
  });
  await resolveSignals([sig("b")], {
    mode: "run", budget: 100,
    compiled: compileSignalAudience({ persona: { job_titles: ["CEO"], exclude_job_titles: ["Assistant"] } }),
  }, deps);
  // p1 excluded word, p2 not a whole-word match, p3 has no email
  assertEquals(log.enrich, [["p4"]]);
});

Deno.test("dedupe: Apollo ids already pushed are dropped before enrichment; known emails after", async () => {
  const { deps, log } = fakeDeps({
    free: [free("b", [], "beta.com")],
    search: () => [searchPerson("p1", "CEO"), searchPerson("p2", "CEO")],
    pushedApollo: ["p1"],
    enrich: (ids) => ({ people: ids.map((i) => enriched(i, `${i}@beta.com`)), credits_spent: ids.length, insufficient_credits: false, failed: 0 }),
    knownEmails: ["p2@beta.com"],
  });
  const o = await resolveSignals([sig("b")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(log.enrich, [["p2"]]);
  assertEquals(o.resolved[0].people, []);
});

Deno.test("guards: an enriched email off the company domain, or abroad, is not used", async () => {
  const { deps } = fakeDeps({
    free: [free("b", [], "beta.com")],
    search: () => [searchPerson("p1", "CEO"), searchPerson("p2", "CEO")],
    enrich: () => ({ people: [enriched("p1", "p1@gmail.com"), enriched("p2", "p2@beta.com", "CEO", "Germany")], credits_spent: 2, insufficient_credits: false, failed: 0 }),
  });
  const o = await resolveSignals([sig("b")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o.resolved[0].people, []);
  assertEquals(o.credits_spent, 2); // spent, honestly reported
});

Deno.test("no domain, disabled, department-only: Apollo is skipped with the reason", async () => {
  const { deps, log } = fakeDeps({ free: [free("a", [], null, null), free("b", [], "beta.com")] });
  const o1 = await resolveSignals([sig("a")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o1.resolved[0].apollo, "no_domain");
  const o2 = await resolveSignals([sig("b")], { mode: "run", compiled: compiled({ use_apollo: false }), budget: 100 }, deps);
  assertEquals(o2.resolved[0].apollo, "disabled");
  const o3 = await resolveSignals([sig("b")], { mode: "run", compiled: compileSignalAudience({ persona: { departments: ["Sales"] } }), budget: 100 }, deps);
  assertEquals(o3.resolved[0].apollo, "persona_unsupported");
  assertEquals(log.search, []);
});

Deno.test("two signals at one company: searched and bought once", async () => {
  const { deps, log } = fakeDeps({
    free: [free("b1", [], "beta.com"), free("b2", [], "beta.com")],
    search: () => [searchPerson("p1", "CEO")],
    enrich: (ids) => ({ people: ids.map((i) => enriched(i, `${i}@beta.com`)), credits_spent: ids.length, insufficient_credits: false, failed: 0 }),
  });
  const o = await resolveSignals([sig("b1"), sig("b2")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(log.search.length, 1);
  assertEquals(log.enrich.length, 1);
  assertEquals(o.resolved[1].people.length, 1);
});

Deno.test("visibility: a signal the SQL refused is never resolved", async () => {
  // resolveFree returns nothing for 'pe' (not visible to this user).
  const { deps, log } = fakeDeps({ free: [], refused: 1 });
  const o = await resolveSignals([sig("pe", { vertical: "private_equity" })], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o.resolved, []);
  assertEquals(o.refused, 1);
  assertEquals(log.search, []);
});

Deno.test("an Apollo search failure is reported, not fatal", async () => {
  const { deps } = fakeDeps({ free: [free("b", [], "beta.com")], search: () => new Error("Apollo search HTTP 502") });
  const o = await resolveSignals([sig("b")], { mode: "run", compiled: compiled(), budget: 100 }, deps);
  assertEquals(o.resolved[0].apollo, "failed");
  assert(o.resolved[0].apollo_error?.includes("502"));
});

Deno.test("helpers: emailAtDomain, passesUsRules, custom fields", () => {
  assert(emailAtDomain("a@beta.com", "beta.com"));
  assert(emailAtDomain("a@eu.beta.com", "https://www.beta.com/"));
  assert(!emailAtDomain("a@notbeta.com", "beta.com"));
  assert(passesUsRules("a@beta.io", "United States"));
  assert(!passesUsRules("a@beta.co.uk", null));
  assert(!passesUsRules("a@beta.com", "Canada"));
  assertEquals(signalCustomFields(sig("a")), {
    signal_type: "510k_cleared", signal_title: "Acme a cleared K1", signal_date: "2026-09-27", signal_url: "https://fda.example/K1",
  });
  assertEquals(signalCustomFields({ ...sig("a"), url: null }).signal_url, "");
});
