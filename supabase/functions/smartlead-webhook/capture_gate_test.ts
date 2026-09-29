// Handler-level fail-closed Capture gate tests for smartlead-webhook (REAL
// index.ts against a fake PostgREST; synthetic data only).
//
// Proves: missing campaign_id / missing synced row / capture disabled / lookup
// error each return 200 { success:true, skipped:<reason> } with ZERO
// agent_leads access; an enabled campaign (numeric or string campaign_id)
// writes agent_leads.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

Deno.env.set("SMARTLEAD_WEBHOOK_SECRET", "url-secret-test");
Deno.env.delete("SMARTLEAD_BODY_SECRET");
const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-0000000000d1";
const INT2 = "00000000-0000-4000-8000-0000000000d2";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const TOKEN = "routing-token-test-0001";
const CAMPAIGN = 2468101;

const integration: Row = { id: INT, name: "Test Smartlead", team_id: TEAM, created_by: USER, api_key_encrypted: null, platform: "smartlead", is_active: true, webhook_secret: TOKEN };
const campaignRow = (enabled: boolean, integrationId = INT): Row => ({
  id: `sc-${integrationId}`, integration_id: integrationId, team_id: TEAM, external_campaign_id: String(CAMPAIGN), capture_enabled: enabled, name: "Synced Campaign", source: "smartlead",
});

function payload(campaignId: unknown): Record<string, unknown> {
  return {
    event_type: "EMAIL_REPLY",
    ...(campaignId === undefined ? {} : { campaign_id: campaignId }),
    campaign_name: "Payload Campaign",
    sl_lead_email: "prospect-0001@example.test",
    sl_email_lead_id: 777,
    to_email: "prospect-0001@example.test",
    from_email: "sender@example.test",
    reply_message: { message_id: "<msg-test-1@example.test>", text: "Yes, let's talk next week.", html: "<p>Yes, let's talk next week.</p>", time: new Date().toISOString() },
  };
}

// Smartlead API calls (enrichment/thread) are not under test: answer empty.
const smartlead = (_req: Request, url: URL) => url.hostname === "server.smartlead.ai" ? json([]) : undefined;

async function post(db: FakeSupabase, body: unknown) {
  const { result, rec } = await withFakes(db, smartlead, async () => {
    const res = await handler(new Request(`http://local/smartlead-webhook?secret=url-secret-test&t=${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

const skipCases: Array<{ name: string; campaignId: unknown; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "missing campaign_id", campaignId: undefined, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "null campaign_id", campaignId: null, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "missing synced row", campaignId: CAMPAIGN, rows: [], reason: "no_synced_row" },
  { name: "row for another integration only", campaignId: CAMPAIGN, rows: [campaignRow(true, INT2)], reason: "no_synced_row" },
  { name: "capture disabled", campaignId: CAMPAIGN, rows: [campaignRow(false)], reason: "capture_disabled" },
  { name: "lookup error", campaignId: CAMPAIGN, rows: [campaignRow(true)], fail: true, reason: "lookup_error" },
];

for (const c of skipCases) {
  Deno.test({
    name: `smartlead-webhook gate: ${c.name} → 200 skipped=${c.reason}, no agent_leads write`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: c.rows });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await post(db, payload(c.campaignId));
      assertEquals(r.status, 200);
      assertEquals(r.body.success, true);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(db.writes("agent_leads").length, 0);
      assertEquals(db.reads("agent_leads").length, 0, "gate runs before any agent_leads access");
      assert(r.rec.logs.some((l) => l.includes(`skip (${c.reason})`)), "skip is logged");
    },
  });
}

for (const id of [CAMPAIGN, String(CAMPAIGN)]) {
  Deno.test({
    name: `smartlead-webhook gate: allowed (${typeof id} campaign_id) → agent_leads written`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaignRow(true)] });
      const r = await post(db, payload(id));
      assertEquals(r.status, 200);
      assertEquals(r.body.skipped, undefined, JSON.stringify(r.body));
      assert(db.writes("agent_leads").length >= 1, "allowed event writes agent_leads");
    },
  });
}
