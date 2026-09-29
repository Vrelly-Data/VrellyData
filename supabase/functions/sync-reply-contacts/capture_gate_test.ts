// Handler-level fail-closed Capture gate tests for sync-reply-contacts (REAL
// index.ts via the service x-agent-key path, fake PostgREST + fake Reply.io v3;
// synthetic data only). reply-webhook fires this function on every legacy
// email reply (even when its own gate skips) and auto-sync runs it on a
// schedule, so both of its agent_leads writers must honour the gate:
//   - the unconditional "replied contacts" upsert, and
//   - the opt-in populateAgentLeads block.
// The contacts/campaign sync itself is not capture and still runs.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type RestCall, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-000000000201";
const INT2 = "00000000-0000-4000-8000-000000000202";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const CAMPAIGN_ROW = "sc-row-1";
const OTHER_ROW = "sc-row-2";

const integration: Row = { id: INT, team_id: TEAM, api_key_encrypted: "k", reply_team_id: "424200", created_by: USER, platform: "reply.io" };
const campaign = (over: Partial<Row> = {}): Row => ({
  id: CAMPAIGN_ROW, integration_id: INT, team_id: TEAM, external_campaign_id: "13579", capture_enabled: true, name: "Seq", stats: {}, ...over,
});
const replied = (id: string, campaignId: string): Row => ({
  id: `contact-${id}`, campaign_id: campaignId, team_id: TEAM, status: "replied", external_contact_id: id,
  first_name: "Test", last_name: id, email: `c${id}@example.test`, engagement_data: { lastReplyText: "Interested", replied: true },
});

const replyApi = (_req: Request, url: URL) => url.hostname === "api.reply.io" ? json({ items: [], hasMore: false }) : undefined;
const isGateLookup = (c: RestCall) => c.table === "synced_campaigns" && c.method === "GET" && (c.params.get("select") ?? "").includes("capture_enabled");

async function run(db: FakeSupabase, extra: Record<string, unknown> = {}) {
  const { result, rec } = await withFakes(db, replyApi, async () => {
    const res = await handler(new Request("http://local/sync-reply-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify({ campaignId: CAMPAIGN_ROW, integrationId: INT, userId: USER, ...extra }),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

const skipCases: Array<{ name: string; campaign: Row; fail?: boolean; reason: string }> = [
  { name: "missing sequence id", campaign: campaign({ external_campaign_id: "" }), reason: "no_campaign_id" },
  { name: "no synced row for this integration", campaign: campaign({ integration_id: INT2 }), reason: "no_synced_row" },
  { name: "capture disabled", campaign: campaign({ capture_enabled: false }), reason: "capture_disabled" },
  { name: "lookup error", campaign: campaign(), fail: true, reason: "lookup_error" },
];

for (const c of skipCases) {
  Deno.test({
    name: `sync-reply-contacts gate: ${c.name} → replied-contacts upsert skipped (${c.reason}), no agent_leads write`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [c.campaign], synced_contacts: [replied("1", CAMPAIGN_ROW)] });
      if (c.fail) db.failIf.push((call) => isGateLookup(call) ? "error" : undefined);
      const r = await run(db);
      assertEquals(r.status, 200, JSON.stringify(r.body));
      assertEquals(r.body.success, true);
      assertEquals(r.body.captureGate, c.reason);
      assertEquals(db.writes("agent_leads").length, 0);
      assert(r.rec.logs.some((l) => l.includes(`agent_leads upsert skipped (capture ${c.reason})`)), "skip is logged");
    },
  });
}

Deno.test({
  name: "sync-reply-contacts gate: allowed → replied contacts upserted into agent_leads",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaign()], synced_contacts: [replied("1", CAMPAIGN_ROW)] });
    const r = await run(db);
    assertEquals(r.status, 200);
    assertEquals(r.body.captureGate, "allowed");
    assertEquals(db.writes("agent_leads").length, 1);
  },
});

Deno.test({
  name: "sync-reply-contacts gate: opt-in populateAgentLeads with nothing enabled → no agent_leads write",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration],
      synced_campaigns: [campaign({ capture_enabled: false })],
      synced_contacts: [replied("1", CAMPAIGN_ROW)],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
    });
    const r = await run(db, { populateAgentLeads: true });
    assertEquals(r.status, 200);
    assertEquals(db.writes("agent_leads").length, 0);
    assert(r.rec.logs.some((l) => l.includes("agent_leads population skipped (capture scope none_enabled)")));
  },
});

Deno.test({
  name: "sync-reply-contacts gate: opt-in populateAgentLeads only writes contacts of capture-enabled campaigns",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration],
      synced_campaigns: [campaign(), campaign({ id: OTHER_ROW, external_campaign_id: "24680", capture_enabled: false })],
      synced_contacts: [replied("1", CAMPAIGN_ROW), replied("2", OTHER_ROW)],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
    });
    const r = await run(db, { populateAgentLeads: true });
    assertEquals(r.status, 200);
    const written = db.writes("agent_leads").flatMap((w) => (Array.isArray(w.body) ? w.body : [w.body]) as Row[]).map((b) => String(b.external_id));
    assert(written.length >= 1);
    assert(!written.includes("2"), "contact of a capture-disabled campaign must not be written");
  },
});
