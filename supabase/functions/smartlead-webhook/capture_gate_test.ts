// Handler-level fail-closed Capture gate tests for smartlead-webhook (REAL
// index.ts against a fake PostgREST; synthetic data only).
//
// Proves: missing campaign_id / missing synced row / capture disabled / lookup
// error each return 200 { success:true, skipped:<reason> } with ZERO
// agent_leads writes; an enabled campaign (numeric or string campaign_id)
// writes agent_leads.
//
// Warehouse (main parity): main failed OPEN on no_campaign_id / no_synced_row /
// lookup_error, so those skips still record the 'replied' inference_events row
// (no agent_leads write, no classify-reply, no message-history call).
// capture_disabled was full silence on main and stays silent: no agent_leads
// access and no inference event.
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

const AGENT_CONFIG: Row = { id: "00000000-0000-4000-8000-0000000000e1", user_id: USER, is_active: true };

const warehouseOnlyCases: Array<{ name: string; campaignId: unknown; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "missing campaign_id", campaignId: undefined, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "null campaign_id", campaignId: null, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "missing synced row", campaignId: CAMPAIGN, rows: [], reason: "no_synced_row" },
  { name: "row for another integration only", campaignId: CAMPAIGN, rows: [campaignRow(true, INT2)], reason: "no_synced_row" },
  { name: "lookup error", campaignId: CAMPAIGN, rows: [campaignRow(true)], fail: true, reason: "lookup_error" },
];

for (const c of warehouseOnlyCases) {
  Deno.test({
    name: `smartlead-webhook gate: ${c.name} → 200 skipped=${c.reason}, no agent_leads write, inference_events still recorded`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: c.rows, agent_configs: [AGENT_CONFIG] });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      // Unknown campaign + discovery unavailable (row creation fails) → fail closed as no_synced_row.
      if (c.reason === "no_synced_row") db.fail["synced_campaigns:WRITE"] = "error";
      const r = await post(db, payload(c.campaignId));
      assertEquals(r.status, 200);
      assertEquals(r.body.success, true);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(r.body.warehouseRecorded, true);
      // No silent drops: a known-but-off (or not yet synced) campaign records a skip row.
      const skipRows = db.calls.filter((x) => x.table === "rpc:record_capture_scope_skips").flatMap((x) => (x.body as { p_rows: Row[] }).p_rows);
      if (c.reason === "no_synced_row" || c.reason === "capture_disabled") {
        assertEquals(skipRows.length, 1, "skip row recorded");
        assertEquals(skipRows[0].reason, c.reason);
        assertEquals(skipRows[0].platform, "smartlead");
        assertEquals(skipRows[0].campaign_external_id, String(CAMPAIGN));
        assertEquals(skipRows[0].contact_key, "prospect-0001@example.test");
      } else {
        assertEquals(skipRows, [], "no skip row when the campaign is unknown or the lookup failed");
      }
      assertEquals(db.writes("agent_leads").length, 0);
      assert(r.rec.logs.some((l) => l.includes(`skip (${c.reason})`)), "skip is logged");
      const inf = db.writes("inference_events");
      assertEquals(inf.length, 1, "skipped reply still records its inference event");
      const ev = inf[0].body as Row;
      assertEquals(ev.event_type, "replied");
      assertEquals(ev.source, "smartlead_webhook");
      assertEquals(ev.source_row_id, "<msg-test-1@example.test>");
      assertEquals(ev.agent_config_id, AGENT_CONFIG.id);
      assertEquals((ev.metadata as Row).capture_skipped, c.reason);
      // No classify-reply on the skip path.
      assertEquals(r.rec.functionCalls.length, 0);
    },
  });
}

Deno.test({
  name: "smartlead-webhook gate: warehouse-only skip with no active agent config → no inference event (main's condition)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [] });
    // Unknown campaign + discovery unavailable (row creation fails) → fail closed as no_synced_row.
    db.fail["synced_campaigns:WRITE"] = "error";
    const r = await post(db, payload(CAMPAIGN));
    assertEquals(r.body.skipped, "no_synced_row");
    assertEquals(r.body.warehouseRecorded, false);
    assertEquals(db.writes("agent_leads").length, 0);
    assertEquals(db.writes("inference_events").length, 0);
  },
});

Deno.test({
  name: "smartlead-webhook gate: capture disabled → 200 skipped=capture_disabled, full silence (no agent_leads access, no inference event)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaignRow(false)], agent_configs: [AGENT_CONFIG] });
    const r = await post(db, payload(CAMPAIGN));
    assertEquals(r.status, 200);
    assertEquals(r.body.success, true);
    // Silent towards the inbox, but not a silent drop: recorded for Capture Scope.
    const skipRows = db.calls.filter((x) => x.table === "rpc:record_capture_scope_skips").flatMap((x) => (x.body as { p_rows: Row[] }).p_rows);
    assertEquals(skipRows.length, 1);
    assertEquals(skipRows[0].reason, "capture_disabled");
    assertEquals(skipRows[0].campaign_external_id, String(CAMPAIGN));
    assertEquals(skipRows[0].contact_key, "prospect-0001@example.test");
    assertEquals(skipRows[0].source, "smartlead-webhook");
    assertEquals(r.body.skipped, "capture_disabled");
    assertEquals(db.writes("agent_leads").length, 0);
    assertEquals(db.reads("agent_leads").length, 0, "gate runs before any agent_leads access");
    assertEquals(db.writes("inference_events").length, 0, "capture_disabled stays silent, as on main");
    assertEquals(db.writes("people").length, 0);
    assert(r.rec.logs.some((l) => l.includes("skip (capture_disabled)")), "skip is logged");
  },
});

Deno.test({
  name: "smartlead-webhook gate: allowed campaign still records exactly one inference event (captured path unchanged)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaignRow(true)], agent_configs: [AGENT_CONFIG] });
    const r = await post(db, payload(CAMPAIGN));
    assertEquals(r.body.skipped, undefined, JSON.stringify(r.body));
    assert(db.writes("agent_leads").length >= 1);
    const inf = db.writes("inference_events");
    assertEquals(inf.length, 1);
    assertEquals(((inf[0].body as Row).metadata as Row).capture_skipped, undefined);
  },
});

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

// ---- Unknown campaign follows auto_capture_new_campaigns (discovery) -------

Deno.test({
  name: "smartlead-webhook discovery: unknown campaign + auto ON → campaign row created capture-on, reply captured, no skip",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [], agent_configs: [AGENT_CONFIG] });
    const r = await post(db, payload(CAMPAIGN));
    assertEquals(r.status, 200);
    assertEquals(r.body.skipped, undefined, JSON.stringify(r.body));
    assert(db.writes("agent_leads").length >= 1, "captured");
    const created = (db.tables.synced_campaigns as Row[]).filter((x) => String(x.external_campaign_id) === String(CAMPAIGN));
    assertEquals(created.length, 1, "exactly one campaign row created");
    assertEquals(created[0].capture_enabled, true);
    assertEquals(created[0].source, "smartlead");
    assertEquals(db.calls.filter((x) => x.table === "rpc:record_capture_scope_skips").length, 0);
  },
});

Deno.test({
  name: "smartlead-webhook discovery: unknown campaign + auto OFF → campaign row created capture-off, reply skipped (capture_disabled) and recorded",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [{ ...integration, auto_capture_new_campaigns: false }], synced_campaigns: [], agent_configs: [AGENT_CONFIG] });
    const r = await post(db, payload(CAMPAIGN));
    assertEquals(r.status, 200);
    assertEquals(r.body.skipped, "capture_disabled");
    assertEquals(db.writes("agent_leads").filter((w) => w.method !== "GET").length, 0, "not captured");
    const created = (db.tables.synced_campaigns as Row[]).filter((x) => String(x.external_campaign_id) === String(CAMPAIGN));
    assertEquals(created.length, 1);
    assertEquals(created[0].capture_enabled, false);
    const skipRows = db.calls.filter((x) => x.table === "rpc:record_capture_scope_skips").flatMap((x) => (x.body as { p_rows: Row[] }).p_rows);
    assertEquals(skipRows.length, 1);
    assertEquals(skipRows[0].reason, "capture_disabled");
    assertEquals(skipRows[0].contact_key, "prospect-0001@example.test");
  },
});
