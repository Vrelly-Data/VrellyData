// run-agent-audience, source 'signals': planning, push mapping and what gets
// recorded — with the resolver's I/O and the database stubbed.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { CandidateSignal, EnrichResult, FreeResolution, ResolvedPerson, ResolverDeps } from "../_shared/signal-resolver.ts";
import { type Counters, personKey, planPage, runSignalsSource, toPushContact } from "./signals.ts";

const USER = "00000000-0000-4000-8000-0000000000r1";
const sig = (id: string, over: Partial<CandidateSignal> = {}): CandidateSignal => ({
  id, type: "fda_clearance", markets: ["medical_device"],
  occurred_at: "2026-09-27T12:00:00Z", title: `Acme ${id} cleared K1`, url: `https://fda.example/${id}`, score: 80,
  company_name: `Acme ${id}`, company_domain: `${id}.com`, person_name: null, person_title: null,
  city: null, state: "TX", country: "US", ...over,
});
const person = (email: string, over: Partial<ResolvedPerson> = {}): ResolvedPerson => ({
  source: "vrelly", prospect_id: crypto.randomUUID(), email, first_name: "Ann", last_name: "Lee", title: "CEO",
  linkedin_url: null, company_name: "Acme", company_domain: email.split("@")[1], city: "Austin", state: "TX", country: "US", ...over,
});
const fresh = () => ({ allowance: 5, taken: 0, seen: new Set<string>(), selections: null as Map<string, Set<string>> | null });

Deno.test("plan: companies are taken whole; one that would overflow waits for the next run", () => {
  const r = planPage([
    { signal: sig("a"), people: [person("1@a.com"), person("2@a.com")], apollo: "not_needed" },
    { signal: sig("b"), people: [person("1@b.com"), person("2@b.com")], apollo: "not_needed" },
    { signal: sig("c"), people: [person("1@c.com"), person("2@c.com")], apollo: "not_needed" },
  ], fresh());
  assertEquals(r.take.map((t) => t.signal.id), ["a", "b"]);
  assertEquals(r.full, true);
  assertEquals(r.unused, []); // c is not recorded: it comes back next run
});

Deno.test("plan: the first company is sliced when it alone exceeds the allowance", () => {
  const s = { ...fresh(), allowance: 1 };
  const r = planPage([{ signal: sig("a"), people: [person("1@a.com"), person("2@a.com")], apollo: "not_needed" }], s);
  assertEquals(r.take[0].people.length, 1);
});

Deno.test("plan: the same person found via two signals is pushed once; the second signal is all_duplicates", () => {
  const r = planPage([
    { signal: sig("a"), people: [person("ann@acme.com", { linkedin_url: "https://linkedin.com/in/ann" })], apollo: "not_needed" },
    { signal: sig("b"), people: [person("ANN@acme.com"), person("x@acme.com", { linkedin_url: "linkedin.com/in/ann/" })], apollo: "not_needed" },
  ], fresh());
  assertEquals(r.take.map((t) => t.signal.id), ["a"]);
  assertEquals(r.unused, [{ signal_id: "b", outcome: "all_duplicates", people_found: 2 }]);
});

Deno.test("plan: nobody found is recorded as no_people — unless the paid step did not get to run", () => {
  const r = planPage([
    { signal: sig("a"), people: [], apollo: "none_found" },
    { signal: sig("b"), people: [], apollo: "budget" },
    { signal: sig("c"), people: [], apollo: "insufficient_credits" },
    { signal: sig("d"), people: [], apollo: "failed" },
  ], fresh());
  assertEquals(r.unused, [{ signal_id: "a", outcome: "no_people", people_found: 0 }]);
});

Deno.test("plan: selections push exactly the picked people; unpicked are never pushed or recorded", () => {
  const a1 = person("1@a.com"), a2 = person("2@a.com");
  const s = { ...fresh(), selections: new Map([["a", new Set([personKey(a2)!])], ["b", new Set(["e:nobody@b.com"])]]) };
  const r = planPage([
    { signal: sig("a"), people: [a1, a2], apollo: "not_needed" },
    { signal: sig("b"), people: [person("1@b.com")], apollo: "not_needed" },
  ], s);
  assertEquals(r.take.map((t) => t.people.map((p) => p.email)), [["2@a.com"]]);
  assertEquals(r.unused, []);
});

Deno.test("personKey: prospect, Apollo, else email", () => {
  assertEquals(personKey({ prospect_id: "p1", email: "a@b.com" }), "p:p1");
  assertEquals(personKey({ apollo_person_id: "a1", email: "a@b.com" }), "a:a1");
  assertEquals(personKey({ email: " A@B.com " }), "e:a@b.com");
  assertEquals(personKey({ email: null }), null);
});

Deno.test("custom fields: every pushed contact carries title, company, LinkedIn, location and the signal", () => {
  const c = toPushContact(person("ann@acme.com", { linkedin_url: "https://linkedin.com/in/ann" }), sig("a"));
  assertEquals(c.title, "CEO");
  assertEquals(c.company_name, "Acme");
  assertEquals(c.linkedin_url, "https://linkedin.com/in/ann");
  assertEquals([c.city, c.state, c.country], ["Austin", "TX", "US"]);
  assertEquals(c.custom_fields, { signal_type: "fda_clearance", signal_title: "Acme a cleared K1", signal_date: "2026-09-27", signal_url: "https://fda.example/a" });
  // High Intent pushes the public type and the client-safe title, never an evidence URL.
  const hi = toPushContact(person("ann@acme.com"), sig("h", { type: "high_intent", title: "High intent: Ann Lee, CEO at Acme", url: null }));
  assertEquals(hi.custom_fields, { signal_type: "high_intent", signal_title: "High intent: Ann Lee, CEO at Acme", signal_date: "2026-09-27", signal_url: "" });
  assert("prospect_id" in c && !("apollo_person_id" in c));
});

// ---- runSignalsSource end to end over stubs -----------------------------------

function stubDb(pages: CandidateSignal[][]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === "signals_audience_candidates") {
        const i = Math.floor(Number(args.p_offset) / 25);
        return Promise.resolve({ data: { signals: pages[i] ?? [] }, error: null });
      }
      if (fn === "signals_mark_audience_used") return Promise.resolve({ data: (args.p_rows as unknown[]).length, error: null });
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
    from() {
      const chain = { update: () => chain, eq: () => Promise.resolve({ error: null }) };
      return chain;
    },
  };
  return { supabase, calls };
}

function deps(free: FreeResolution[]): ResolverDeps {
  return {
    resolveFree: (ids) => Promise.resolve({ signals: free.filter((f) => ids.includes(f.signal_id)), refused: 0 }),
    readCache: () => Promise.resolve(new Map()),
    readLookups: () => Promise.resolve(new Map()),
    apolloSearch: () => Promise.reject(new Error("no Apollo in this test")),
    apolloEnrich: () => Promise.resolve({ people: [], credits_spent: 0, insufficient_credits: false, failed: 0 } as EnrichResult),
    pushedApolloIds: () => Promise.resolve(new Set()),
    knownContacts: () => Promise.resolve({ emails: new Set(), linkedins: new Set() }),
    writeCache: () => Promise.resolve(),
    writeLookup: () => Promise.resolve(),
  };
}

const counters = (): Counters => ({ searched: 0, enriched: 0, credits_spent: 0, pushed: 0, skipped_duplicate: 0, failed: 0 });
const filters = { types: ["fda_clearance"], persona: { job_titles: ["CEO"] }, use_apollo: false };

Deno.test("run: pushes with signal context, records pushed + no_people, marks the team", async () => {
  const { supabase, calls } = stubDb([[sig("a"), sig("b")]]);
  let pushed: Record<string, unknown>[] = [];
  const ctr = counters();
  const r = await runSignalsSource({
    supabase, supabaseUrl: "http://x", agentApiKey: "k", userId: USER,
    audience: { id: "aud", agent_config_id: "cfg", filters }, runId: "run-1", allowance: 10,
    signalIds: null, selections: null, counters: ctr,
    deps: deps([
      { signal_id: "a", company_key: "d:a.com", domain: "a.com", derived_domain: null, people: [person("ann@a.com")] },
      { signal_id: "b", company_key: "d:b.com", domain: "b.com", derived_domain: null, people: [] },
    ]),
    push: (contacts) => {
      pushed = contacts;
      return Promise.resolve({ ok: true as const, body: { pushed: 1, tally: { pushed: 1 }, results: [{ email: "ann@a.com", outcome: "pushed" }] } });
    },
  });
  assertEquals(r.status, "success");
  assertEquals(pushed.length, 1);
  assertEquals((pushed[0].custom_fields as Record<string, string>).signal_type, "fda_clearance");
  assertEquals(ctr.pushed, 1);
  const mark = calls.find((c) => c.fn === "signals_mark_audience_used")!;
  assertEquals(mark.args.p_rows, [
    { signal_id: "b", outcome: "no_people", people_found: 0, people_pushed: 0 },
    { signal_id: "a", outcome: "pushed", people_found: 1, people_pushed: 1 },
  ]);
  const cand = calls.find((c) => c.fn === "signals_audience_candidates")!;
  assertEquals(cand.args.p_user_id, USER);
  assertEquals(cand.args.p_audience_id, "aud");
});

Deno.test("run: a failed push records nothing as pushed, so the signal is retried", async () => {
  const { supabase, calls } = stubDb([[sig("a")]]);
  const r = await runSignalsSource({
    supabase, supabaseUrl: "http://x", agentApiKey: "k", userId: USER,
    audience: { id: "aud", agent_config_id: "cfg", filters }, runId: "run-1", allowance: 10,
    signalIds: null, selections: null, counters: counters(),
    deps: deps([{ signal_id: "a", company_key: "d:a.com", domain: "a.com", derived_domain: null, people: [person("ann@a.com")] }]),
    push: () => Promise.resolve({ ok: true as const, body: { pushed: 0, tally: { failed: 1 }, results: [{ email: "ann@a.com", outcome: "failed" }] } }),
  });
  assertEquals(r.status, "failed");
  assertEquals(calls.some((c) => c.fn === "signals_mark_audience_used"), false);
});

Deno.test("run: nothing new — success with a note, no push", async () => {
  const { supabase } = stubDb([[]]);
  let pushes = 0;
  const r = await runSignalsSource({
    supabase, supabaseUrl: "http://x", agentApiKey: "k", userId: USER,
    audience: { id: "aud", agent_config_id: "cfg", filters }, runId: "run-1", allowance: 10,
    signalIds: null, selections: null, counters: counters(), deps: deps([]),
    push: () => { pushes++; return Promise.resolve({ ok: true as const, body: {} }); },
  });
  assertEquals(r.status, "success");
  assertEquals(pushes, 0);
  assert(r.note?.includes("no matching signals"));
});

Deno.test("run: invalid filters fail before any database call", async () => {
  const { supabase, calls } = stubDb([]);
  const r = await runSignalsSource({
    supabase, supabaseUrl: "http://x", agentApiKey: "k", userId: USER,
    audience: { id: "aud", agent_config_id: "cfg", filters: { types: ["fda_clearance"] } }, runId: "run-1", allowance: 10,
    signalIds: null, selections: null, counters: counters(), deps: deps([]),
    push: () => Promise.resolve({ ok: true as const, body: {} }),
  });
  assertEquals(r.httpStatus, 400);
  assertEquals(calls.length, 0);
});

Deno.test("run: selections restrict the candidate query to the selected signals", async () => {
  const { supabase, calls } = stubDb([[sig("a")]]);
  const a = person("ann@a.com");
  await runSignalsSource({
    supabase, supabaseUrl: "http://x", agentApiKey: "k", userId: USER,
    audience: { id: "aud", agent_config_id: "cfg", filters }, runId: "run-1", allowance: 10,
    signalIds: null, selections: [{ signal_id: "a", person_key: personKey(a) }, { signal_id: "zzz", person_key: "bogus" }],
    counters: counters(),
    deps: deps([{ signal_id: "a", company_key: "d:a.com", domain: "a.com", derived_domain: null, people: [a] }]),
    push: () => Promise.resolve({ ok: true as const, body: { pushed: 1, results: [{ email: "ann@a.com", outcome: "pushed" }] } }),
  });
  assertEquals(calls[0].args.p_signal_ids, ["a"]);
});
