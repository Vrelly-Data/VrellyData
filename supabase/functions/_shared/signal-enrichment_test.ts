// High Intent enrichment: ORDER (prospects by email → by domain → inference
// → Apollo), free before paid, Apollo only when the team opted in, within
// budget, stopping cleanly on Apollo's 422; never overwrites.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ApolloMatchDetail, type EnrichDeps, type EnrichTarget, enrichHighIntent, lookupDomain, missingFields,
  normalizeCompanySize, type TeamApollo,
} from "./signal-enrichment.ts";
import { apolloBulkMatch, apolloPersonToFields } from "./signal-enrichment-supabase.ts";

const TEAM = "t-1";
const target = (id: string, extra: Partial<EnrichTarget> = {}): EnrichTarget => ({
  signal_id: id, team_id: TEAM, person_key: `email:${id}@acme.io`, person_name: "Ann Lee", company_name: "Acme",
  company_domain: null, email: `${id}@acme.io`, linkedin: null, team_default_market: null, apollo_done: false,
  free_done: false, current: {}, ...extra,
});

interface Log { calls: string[]; matched: ApolloMatchDetail[][]; spend: number[] }

function fakeDeps(o: {
  byEmail?: Record<string, Record<string, string>>;
  byDomain?: Record<string, Record<string, string>>;
  inference?: Record<string, Record<string, string>>;
  team?: Partial<TeamApollo> | null;
  budget?: number | null;
  apollo?: (d: ApolloMatchDetail[]) => { matches: Array<Record<string, string> | null>; credits: number; insufficient?: boolean };
}, log: Log): EnrichDeps {
  return {
    freeLookups(targets) {
      log.calls.push(`free:${targets.length}`);
      return Promise.resolve({
        byEmail: new Map(Object.entries(o.byEmail ?? {})),
        byDomain: new Map(Object.entries(o.byDomain ?? {})),
        inference: new Map(Object.entries(o.inference ?? {})),
      });
    },
    teamApollo(ids) {
      log.calls.push(`team:${ids.join(",")}`);
      const t = o.team === null ? undefined : { enabled: true, user_id: "u-1", agent_config_id: "c-1", ...(o.team ?? {}) };
      return Promise.resolve(new Map(t ? ids.map((id) => [id, t as TeamApollo]) : []));
    },
    apolloBudget() {
      log.calls.push("budget");
      return Promise.resolve(o.budget === null ? null : { key: "k", keySource: "shared", remaining: o.budget ?? 100 });
    },
    apolloMatch(_key, details) {
      log.calls.push(`apollo:${details.length}`);
      log.matched.push(details);
      const r = o.apollo ? o.apollo(details) : { matches: details.map(() => null), credits: 0 };
      return Promise.resolve({ matches: r.matches, credits: r.credits, insufficient: r.insufficient ?? false, error: null });
    },
    recordSpend(row) {
      log.spend.push(row.credits);
      return Promise.resolve();
    },
  };
}
const newLog = (): Log => ({ calls: [], matched: [], spend: [] });

Deno.test("ORDER: prospects-by-email beats domain beats inference; each only fills what is still empty", async () => {
  const log = newLog();
  const out = await enrichHighIntent([target("a", { current: { person_title: "Owner" } })], fakeDeps({
    byEmail: { "a@acme.io": { person_title: "CEO (never used: already set)", seniority: "c_suite", state: "TX" } },
    byDomain: { "acme.io": { industry: "Computer Software", company_size: "51 to 100", seniority: "vp (company-level lookups never give person fields)" } },
    inference: { a: { industry: "Construction (later step: loses)", country: "United States", city: "Austin", company_size: "2" } },
  }, log), {});
  const r = out.results[0];
  assertEquals(r.values, {
    person_title: "Owner", seniority: "c_suite", state: "TX", industry: "Computer Software", company_size: "51-100",
    country: "United States", city: "Austin",
  });
  assertEquals(r.filled, {
    seniority: "prospects_email", state: "prospects_email", industry: "prospects_domain", company_size: "prospects_domain",
    country: "inference", city: "inference",
  });
  assertEquals(r.markets, ["saas"]);
  assertEquals(r.title, "High intent: Ann Lee, Owner at Acme");
  assertEquals(r.apollo_status, "not_needed");
  assertEquals(log.calls, ["free:1"], "nothing missing → no team lookup, no Apollo");
});

Deno.test("FREE BEFORE PAID: Apollo is only asked for what the free steps could not fill", async () => {
  const log = newLog();
  const out = await enrichHighIntent([target("a"), target("b")], fakeDeps({
    byEmail: { "a@acme.io": { person_title: "CEO", seniority: "c_suite", country: "US", industry: "Software", company_size: "11-50" } },
    apollo: (d) => ({ matches: d.map(() => ({ person_title: "VP Sales", seniority: "vp", country: "United States", industry: "Internet", company_size: "120" })), credits: d.length }),
  }, log));
  assertEquals(log.calls, ["free:2", `team:${TEAM}`, "budget", "apollo:1"]);
  assertEquals(log.matched[0][0].email, "b@acme.io", "only the signal the free steps left incomplete");
  const [a, b] = out.results;
  assertEquals(a.apollo_status, "not_needed");
  assertEquals(a.filled.person_title, "prospects_email");
  assertEquals(b.apollo_status, "matched");
  assertEquals([b.values.person_title, b.values.company_size, b.filled.person_title], ["VP Sales", "51-200", "apollo"]);
  assertEquals([out.credits_spent, log.spend], [1, [1]]);
});

Deno.test("Apollo OFF for the team (the default) → never called; status 'disabled' so it is retried if turned on", async () => {
  const log = newLog();
  const out = await enrichHighIntent([target("a")], fakeDeps({ team: { enabled: false } }, log));
  assertEquals(log.calls, ["free:1", `team:${TEAM}`]);
  assertEquals(out.results[0].apollo_status, "disabled");
  assertEquals(out.credits_spent, 0);
});

Deno.test("admin-only signals (no team) never use Apollo", async () => {
  const log = newLog();
  const out = await enrichHighIntent([target("a", { team_id: null })], fakeDeps({}, log));
  assertEquals(log.calls, ["free:1"]);
  assertEquals(out.results[0].apollo_status, "disabled");
});

Deno.test("budget: at most the team's remaining credits; none left → 'budget', nothing bought", async () => {
  const log = newLog();
  const ts = Array.from({ length: 5 }, (_, i) => target(`p${i}`));
  const out = await enrichHighIntent(ts, fakeDeps({
    budget: 3, apollo: (d) => ({ matches: d.map(() => ({ industry: "Software" })), credits: d.length }),
  }, log));
  assertEquals(log.calls.filter((c) => c.startsWith("apollo:")), ["apollo:3"]);
  assertEquals(out.results.map((r) => r.apollo_status), ["matched", "matched", "matched", "budget", "budget"]);

  const log2 = newLog();
  const none = await enrichHighIntent([target("a")], fakeDeps({ budget: 0 }, log2));
  assertEquals(log2.calls.some((c) => c.startsWith("apollo:")), false);
  assertEquals(none.results[0].apollo_status, "budget");
});

Deno.test("422 insufficient credits: stops cleanly for the run, later teams deferred, nothing marked final", async () => {
  const log = newLog();
  const ts = [...Array.from({ length: 12 }, (_, i) => target(`a${i}`)), target("z", { team_id: "t-2" })];
  const out = await enrichHighIntent(ts, fakeDeps({ apollo: (d) => ({ matches: d.map(() => null), credits: 0, insufficient: true }) }, log));
  assertEquals(log.calls.filter((c) => c.startsWith("apollo:")), ["apollo:10"], "one call, then stop");
  assert(out.insufficient_credits);
  const st = Object.fromEntries(out.results.map((r) => [r.signal_id, r.apollo_status]));
  assertEquals(st.a0, "insufficient_credits");
  assertEquals(st.a11, "insufficient_credits");
  assertEquals(st.z, "deferred");
});

Deno.test("per-run cap and Apollo's 10-record chunks", async () => {
  const log = newLog();
  const ts = Array.from({ length: 30 }, (_, i) => target(`p${i}`));
  await enrichHighIntent(ts, fakeDeps({ budget: 1000 }, log), { apolloMaxPerRun: 25 });
  assertEquals(log.calls.filter((c) => c.startsWith("apollo:")), ["apollo:10", "apollo:10", "apollo:5"]);
});

Deno.test("an unreadable budget is not permission to spend", async () => {
  const log = newLog();
  const deps = fakeDeps({}, log);
  deps.apolloBudget = () => Promise.reject(new Error("ledger down"));
  const out = await enrichHighIntent([target("a")], deps);
  assertEquals(log.calls.some((c) => c.startsWith("apollo:")), false);
  assertEquals(out.results[0].apollo_status, "deferred");
  assert(out.errors[0].includes("ledger down"));
});

Deno.test("signals Apollo already finished are not sent again; no identifier → no call", async () => {
  const log = newLog();
  const out = await enrichHighIntent([
    target("done", { apollo_done: true }),
    target("anon", { email: null, linkedin: null, person_name: null }),
  ], fakeDeps({}, log));
  assertEquals(log.calls.some((c) => c.startsWith("apollo:")), false);
  assertEquals(out.results.map((r) => r.apollo_status), [null, "no_identifier"]);
});

Deno.test("helpers: personal-mail domains are never company domains; sizes bucketed; location missing = no state and no country", () => {
  assertEquals(lookupDomain({ company_domain: null, email: "x@gmail.com" }), null);
  assertEquals(lookupDomain({ company_domain: "www.Acme.io", email: "x@gmail.com" }), "acme.io");
  assertEquals(lookupDomain({ company_domain: null, email: "x@acme.io" }), "acme.io");
  assertEquals([normalizeCompanySize(7), normalizeCompanySize("34000"), normalizeCompanySize("251 to 500"), normalizeCompanySize("11-50")],
    ["1-10", "5001+", "251-500", "11-50"]);
  assertEquals(missingFields({ state: "TX", industry: "x", person_title: "y", seniority: "z", company_size: "1-10" }), ["city", "country"]);
  assertEquals(missingFields({}).includes("country"), true);
});

Deno.test("apolloBulkMatch: never personal emails or phones; keeps request order; 422 credits → insufficient", async () => {
  let body: Record<string, unknown> = {};
  const ok = (_u: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({
      credits_consumed: 1,
      matches: [null, { id: "p1", title: "CEO", seniority: "c_suite", state: "TX", organization: { industry: "Software", estimated_num_employees: 40 } }],
    }), { status: 200 }));
  };
  const r = await apolloBulkMatch(ok as typeof fetch, "key", [{ email: "a@x.io" }, { email: "b@x.io" }]);
  assertEquals([body.reveal_personal_emails, body.reveal_phone_number], [false, false]);
  assertEquals(r.matches[0], null);
  assertEquals(r.matches[1]?.person_title, "CEO");
  assertEquals(r.matches[1]?.company_size, "11-50");
  assertEquals(r.credits, 1);
  const out = (() => Promise.resolve(new Response("You have insufficient credits", { status: 422 }))) as unknown as typeof fetch;
  const r2 = await apolloBulkMatch(out, "key", [{ email: "a@x.io" }]);
  assertEquals([r2.insufficient, r2.credits, r2.error], [true, 0, null]);
  assertEquals(apolloPersonToFields(null), null);
});
