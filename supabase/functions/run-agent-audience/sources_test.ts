// run-agent-audience (REAL index.ts, fake PostgREST + fake Reply.io + fake
// sibling functions; synthetic data only).
//
// Vrelly source: the live campaign preflight still runs FIRST; then one
// vrelly_audience_search call (limit = the run's allowance) replaces
// search + enrich; no Apollo function is called; credits_spent = 0; contacts
// carry prospect_id, title, company and location to add-contacts-to-sequence.
//
// Apollo guardrails: the monthly credit cap on the shared key enriches only up
// to the cap and ends the run 'partial' / 'monthly_cap'; an Apollo
// insufficient-credits answer ends it 'partial' / 'apollo_insufficient_credits';
// both are mirrored to agent_audiences.last_run_reason.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

Deno.env.set("APOLLO_API_KEY", "shared-test-key");
const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const USER = "00000000-0000-4000-8000-0000000000u1";
const AUD = "aud-1";
const CFG = "cfg-1";
const CAMP = "camp-1";

function db(audience: Row, extra: Record<string, Row[]> = {}) {
  return new FakeSupabase({
    agent_audiences: [{
      id: AUD, user_id: USER, agent_config_id: CFG, name: "A", max_per_run: 25, max_total: null, total_pushed: 0,
      default_platform: "reply.io", default_synced_campaign_id: CAMP, last_run_status: null, last_run_at: null,
      consecutive_failures: 0, ...audience,
    }],
    agent_configs: [{ id: CFG, user_id: USER, apollo_monthly_credit_cap: 200 }],
    synced_campaigns: [{ id: CAMP, external_campaign_id: "777", name: "Seq", source: "reply_io", integration_id: "int-1" }],
    outbound_integrations: [{ id: "int-1", api_key_encrypted: "rk", is_active: true, platform: "reply.io", created_by: USER }],
    agent_audience_runs: [],
    agent_audience_pushes: [],
    ...extra,
  });
}

// Reply.io sequence preflight: sendable unless told otherwise.
const replyOk = (sendable = true) => (_req: Request, url: URL) => {
  if (url.hostname === "api.reply.io" && url.pathname === "/v3/sequences/777") {
    return json({ status: "Active", emailAccounts: sendable ? [{ id: 1 }] : [], linkedInAccounts: [], steps: [{ id: 1 }] });
  }
  return undefined;
};

async function run(d: FakeSupabase, fns: (path: string, body: Row) => Response | undefined, provider = replyOk(), body: Row = {}) {
  const { result, rec } = await withFakes(d, provider, async () => {
    const res = await handler(new Request("http://local/run-agent-audience", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify({ audience_id: AUD, user_id: USER, trigger: "cron", ...body }),
    }));
    return { status: res.status, body: await res.json() };
  }, (path, b) => fns(path, b as Row));
  return { ...result, rec };
}

const pushedAll = (_path: string, b: Row) => {
  const contacts = (b.contacts as Row[]) ?? [];
  return json({ success: true, pushed: contacts.length, tally: { pushed: contacts.length }, results: [] });
};

const VRELLY_FILTERS = { job_titles: ["CEO"], industries: ["Financial Services"], person_countries: ["United States"] };
const person = (i: number): Row => ({
  prospect_id: `0000000${i}-0000-4000-8000-000000000000`, first_name: `F${i}`, last_name: `L${i}`,
  email: `p${i}@x.test`, title: "CEO", company_name: `Co${i}`, company_domain: `co${i}.test`,
  linkedin_url: `https://linkedin.com/in/p${i}`, city: "Austin", state: "TX", country: "US",
});

Deno.test({
  name: "vrelly: preflight first, one search sized to the allowance, push with full contact fields, no Apollo, 0 credits",
  ...testOpts,
  async fn() {
    const d = db({ source: "vrelly", filters_version: 2, filters: VRELLY_FILTERS, max_per_run: 3 });
    let rpcArgs: Row | null = null;
    d.rpc.vrelly_audience_search = (b: unknown) => {
      rpcArgs = b as Row;
      return { people: [person(1), person(2), person(3)], total: null, total_capped: false };
    };
    const r = await run(d, (path, b) => (path.endsWith("/add-contacts-to-sequence") ? pushedAll(path, b) : undefined));

    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(r.body.status, "success");
    assertEquals(r.body.searched, 3);
    assertEquals(r.body.pushed, 3);
    assertEquals(r.body.credits_spent, 0);
    assertEquals(r.body.enriched, 0);

    // Preflight hit Reply.io BEFORE the search ran.
    const preflightAt = r.rec.providerCalls.findIndex((c) => c.url.includes("/v3/sequences/777"));
    assert(preflightAt >= 0, "preflight called");
    const callOrder = d.calls.map((c) => c.table);
    assert(callOrder.includes("rpc:vrelly_audience_search"));

    // The search: this user, compiled filters, limit = allowance, no count.
    const args = rpcArgs as unknown as Row;
    assertEquals(args.p_user_id, USER);
    assertEquals(args.p_limit, 3);
    assertEquals(args.p_count, false);
    assertEquals((args.p_query as Row).title_patterns, ["%CEO%"]);
    assertEquals((args.p_query as Row).person_countries, ["united states", "us", "usa", "united states of america", "u.s.", "u.s.a."]);

    // No Apollo function was touched.
    assertEquals(r.rec.functionCalls.map((c) => c.path), ["/functions/v1/add-contacts-to-sequence"]);
    const sent = (r.rec.functionCalls[0].body as Row).contacts as Row[];
    assertEquals(sent[0], {
      prospect_id: person(1).prospect_id, email: "p1@x.test", first_name: "F1", last_name: "L1",
      linkedin_url: "https://linkedin.com/in/p1", title: "CEO", company_name: "Co1", company_domain: "co1.test",
      city: "Austin", state: "TX", country: "US",
    });

    const runRow = (d.tables.agent_audience_runs as Row[])[0];
    assertEquals(runRow.status, "success");
    assertEquals(runRow.credits_spent, 0);
  },
});

Deno.test({
  name: "vrelly: a campaign that cannot send stops the run before any search",
  ...testOpts,
  async fn() {
    const d = db({ source: "vrelly", filters_version: 2, filters: VRELLY_FILTERS });
    d.rpc.vrelly_audience_search = () => { throw new Error("must not be called"); };
    const r = await run(d, () => undefined, replyOk(false));
    assertEquals(r.status, 409);
    assertEquals(d.calls.filter((c) => c.table === "rpc:vrelly_audience_search").length, 0);
    assertEquals(r.rec.functionCalls.length, 0);
    assertEquals((d.tables.agent_audience_runs as Row[])[0].status, "failed");
  },
});

Deno.test({
  name: "vrelly: nobody new left → success with nothing pushed; Apollo-shaped filters on a vrelly audience → failed, not 'match everyone'",
  ...testOpts,
  async fn() {
    const d = db({ source: "vrelly", filters_version: 2, filters: VRELLY_FILTERS });
    d.rpc.vrelly_audience_search = () => ({ people: [], total: null });
    const r = await run(d, () => undefined);
    assertEquals(r.body.pushed, 0);
    assertEquals((d.tables.agent_audience_runs as Row[])[0].status, "success");

    const bad = db({ source: "vrelly", filters_version: 2, filters: { person_titles: ["CEO"] } });
    const rb = await run(bad, () => undefined);
    assertEquals(rb.status, 400);
    assertEquals(bad.calls.filter((c) => c.table === "rpc:vrelly_audience_search").length, 0);
  },
});

Deno.test({
  name: "vrelly manual push: ticked prospect ids are passed through; non-uuid ids are refused",
  ...testOpts,
  async fn() {
    const d = db({ source: "vrelly", filters_version: 2, filters: VRELLY_FILTERS });
    let ids: unknown = null;
    d.rpc.vrelly_audience_search = (b: unknown) => {
      ids = (b as Row).p_prospect_ids;
      return { people: [person(1)] };
    };
    const want = [String(person(1).prospect_id), String(person(2).prospect_id)];
    const r = await run(d, pushedAll, replyOk(), { trigger: "manual", person_ids: want });
    assertEquals(ids, want);
    assertEquals(r.body.searched, 1);
    assertEquals(r.body.skipped_duplicate, 1, "the ticked person the search no longer returns");

    const d2 = db({ source: "vrelly", filters_version: 2, filters: VRELLY_FILTERS });
    const r2 = await run(d2, pushedAll, replyOk(), { person_ids: ["apollo-abc"] });
    assertEquals(r2.status, 400);
  },
});

// ---------------------------------------------------------------------------
// Apollo guardrails
// ---------------------------------------------------------------------------
const APOLLO_FILTERS = { person_titles: ["CEO"] };
const searchIds = (n: number) => json({ people: Array.from({ length: n }, (_, i) => ({ apollo_person_id: `ap${i}` })) });
const enrichAll = (b: Row) => {
  const ids = b.person_ids as string[];
  return json({
    success: true, credits_spent: ids.length, failed_chunks: [],
    people: ids.map((id) => ({ apollo_person_id: id, email: `${id}@x.test`, first_name: "A", last_name: "B" })),
  });
};
const monthRun = (credits: number, key: string | null = "shared"): Row => ({
  id: `old-${credits}-${key}`, audience_id: "other", user_id: USER, status: "success",
  started_at: new Date().toISOString(), credits_spent: credits, apollo_key_source: key,
});

Deno.test({
  name: "apollo monthly cap: 195 of 200 used → enrich only 5 of 25, run partial/monthly_cap, card shows the reason",
  ...testOpts,
  async fn() {
    const d = db({ source: "apollo", filters_version: 1, filters: APOLLO_FILTERS }, {
      agent_audience_runs: [monthRun(150), monthRun(45, null), monthRun(500, "client")],
    });
    const enrichSizes: number[] = [];
    const r = await run(d, (path, b) => {
      if (path.endsWith("/apollo-search")) return searchIds(25);
      if (path.endsWith("/apollo-enrich")) { enrichSizes.push((b.person_ids as string[]).length); return enrichAll(b); }
      if (path.endsWith("/add-contacts-to-sequence")) return pushedAll(path, b);
    });
    assertEquals(enrichSizes, [5], "client-key credits are not counted; null (pre-migration) runs are");
    assertEquals(r.body.status, "partial");
    assertEquals(r.body.reason, "monthly_cap");
    assertEquals(r.body.credits_spent, 5);
    assertEquals(r.body.pushed, 5);
    const thisRun = (d.tables.agent_audience_runs as Row[]).find((x) => x.audience_id === AUD)!;
    assertEquals(thisRun.status, "partial");
    assertEquals(thisRun.reason, "monthly_cap");
    assertEquals(thisRun.apollo_key_source, "shared");
    const aud = (d.tables.agent_audiences as Row[])[0];
    assertEquals(aud.last_run_status, "partial");
    assertEquals(aud.last_run_reason, "monthly_cap");
    assertEquals(aud.consecutive_failures, 0);
  },
});

Deno.test({
  name: "apollo monthly cap already reached → no enrich call at all, partial/monthly_cap",
  ...testOpts,
  async fn() {
    const d = db({ source: "apollo", filters_version: 1, filters: APOLLO_FILTERS }, { agent_audience_runs: [monthRun(200)] });
    const r = await run(d, (path) => (path.endsWith("/apollo-search") ? searchIds(10) : undefined));
    assertEquals(r.rec.functionCalls.map((c) => c.path), ["/functions/v1/apollo-search"]);
    assertEquals(r.body.status, "partial");
    assertEquals(r.body.reason, "monthly_cap");
    assertEquals(r.body.pushed, 0);
  },
});

Deno.test({
  name: "apollo monthly cap does not apply to a client's own Apollo key",
  ...testOpts,
  async fn() {
    const d = db({ source: "apollo", filters_version: 1, filters: APOLLO_FILTERS }, {
      agent_audience_runs: [monthRun(200)],
    });
    (d.tables.outbound_integrations as Row[]).push({ id: "int-ap", platform: "apollo", created_by: USER, is_active: true, api_key_encrypted: "own" });
    const r = await run(d, (path, b) => {
      if (path.endsWith("/apollo-search")) return searchIds(12);
      if (path.endsWith("/apollo-enrich")) return enrichAll(b);
      if (path.endsWith("/add-contacts-to-sequence")) return pushedAll(path, b);
    });
    assertEquals(r.body.status, "success");
    assertEquals(r.body.credits_spent, 12);
    assertEquals((d.tables.agent_audience_runs as Row[]).find((x) => x.audience_id === AUD)!.apollo_key_source, "client");
  },
});

Deno.test({
  name: "apollo 422 insufficient credits → stop enriching, push what was enriched, partial/apollo_insufficient_credits",
  ...testOpts,
  async fn() {
    const d = db({ source: "apollo", filters_version: 1, filters: APOLLO_FILTERS });
    let calls = 0;
    const r = await run(d, (path, b) => {
      if (path.endsWith("/apollo-search")) return searchIds(25);
      if (path.endsWith("/apollo-enrich")) {
        calls++;
        if (calls === 1) return enrichAll(b);
        return json({
          success: true, credits_spent: 0, people: [], insufficient_credits: true,
          failed_chunks: [{ ids: b.person_ids, status: 422 }], not_attempted: [],
        });
      }
      if (path.endsWith("/add-contacts-to-sequence")) return pushedAll(path, b);
    });
    assertEquals(calls, 2, "no third enrich after Apollo said it is out of credits");
    assertEquals(r.body.status, "partial");
    assertEquals(r.body.reason, "apollo_insufficient_credits");
    assertEquals(r.body.pushed, 10);
    assertEquals((d.tables.agent_audiences as Row[])[0].last_run_reason, "apollo_insufficient_credits");
  },
});
