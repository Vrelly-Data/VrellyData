// Handler-level fail-closed Capture gate tests for heyreach-webhook: the REAL
// index.ts handler runs against a fake PostgREST (see
// _shared/testing/fake_platform.ts). Synthetic data only.
//
// Proves: missing campaign id / missing synced row / capture disabled / lookup
// error each return 200 { success:true, skipped:<reason> } with ZERO
// agent_leads writes; an enabled campaign writes. The nested campaign.id
// (a JSON number in real payloads) is what gates, and it also drives
// multi-integration disambiguation. last_campaign_name is never null-clobbered.
//
// Warehouse (main parity): main failed OPEN on no_campaign_id / no_synced_row /
// lookup_error, so those skips still record the 'replied' inference_events row
// (no agent_leads write, no GetChatroom call). capture_disabled was full
// silence on main and stays silent: no agent_leads access, no inference event.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeSupabase, loadHandler, noProviders, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-0000000000a1";
const INT2 = "00000000-0000-4000-8000-0000000000a2";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const USER2 = "00000000-0000-4000-8000-0000000000b2";
const CAMPAIGN = 518402;

function integration(id = INT, user = USER): Row {
  return { id, team_id: TEAM, is_active: true, created_by: user, api_key_encrypted: "k", webhook_secret: null, platform: "heyreach" };
}
function campaignRow(enabled: boolean, integrationId = INT, id = String(CAMPAIGN)): Row {
  return { id: `sc-${integrationId}-${id}`, integration_id: integrationId, team_id: TEAM, external_campaign_id: id, capture_enabled: enabled, name: "Synced Campaign Name", source: "heyreach" };
}

function payload(campaign: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(campaign === undefined ? {} : { campaign }),
    conversation_id: "conv-test-1",
    lead: { first_name: "Test", last_name: "Prospect", profile_url: "https://www.linkedin.com/in/test-prospect-0001" },
    sender: { linkedInAccount: { id: 111 } },
    recent_messages: [{ message: "Sounds good, tell me more", creation_time: new Date().toISOString(), is_reply: true }],
    ...extra,
  };
}

async function post(db: FakeSupabase, body: unknown, path = `/heyreach-webhook/${INT}`) {
  const { result, rec } = await withFakes(db, noProviders, async () => {
    const res = await handler(new Request(`http://local${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec, leadWrites: db.writes("agent_leads") };
}

const AGENT_CONFIG: Row = { id: "00000000-0000-4000-8000-0000000000e1", user_id: USER, is_active: true };

const warehouseOnlyCases: Array<{ name: string; campaign: unknown; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "missing campaign id", campaign: undefined, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "campaign object without id", campaign: { name: "x" }, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "missing synced row", campaign: { id: CAMPAIGN, name: "C" }, rows: [], reason: "no_synced_row" },
  { name: "row for another integration only", campaign: { id: CAMPAIGN, name: "C" }, rows: [campaignRow(true, INT2)], reason: "no_synced_row" },
  { name: "lookup error", campaign: { id: CAMPAIGN, name: "C" }, rows: [campaignRow(true)], fail: true, reason: "lookup_error" },
];

for (const c of warehouseOnlyCases) {
  Deno.test({
    name: `heyreach-webhook gate: ${c.name} → 200 skipped=${c.reason}, no agent_leads write, inference_events still recorded`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: c.rows, agent_configs: [AGENT_CONFIG] });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await post(db, payload(c.campaign));
      assertEquals(r.status, 200);
      assertEquals(r.body.success, true);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(r.body.warehouseRecorded, true);
      assertEquals(r.body.conversationId, "conv-test-1", "skip response carries the conversation id");
      assertEquals(r.leadWrites.length, 0, "no agent_leads write on skip");
      assert(r.rec.logs.some((l) => l.includes(`skip (${c.reason})`) && l.includes("conversation=conv-test-1")), "skip is logged with the conversation id");
      // The raw event is still logged to webhook_events (not capture).
      assertEquals(db.writes("webhook_events").length, 1);
      // Warehouse: exactly main's 'replied' event, tagged with the skip reason.
      const inf = db.writes("inference_events");
      assertEquals(inf.length, 1, "skipped reply still records its inference event");
      const ev = inf[0].body as Row;
      assertEquals(ev.event_type, "replied");
      assertEquals(ev.source, "heyreach_webhook");
      assertEquals(ev.agent_config_id, AGENT_CONFIG.id);
      assert(String(ev.source_row_id).startsWith("conv-test-1:"), "stable id is conversation:occurred_at");
      assertEquals((ev.metadata as Row).capture_skipped, c.reason);
      // No GetChatroom / provider call and no classify on the skip path.
      assertEquals(r.rec.providerCalls.length, 0);
      assertEquals(r.rec.functionCalls.length, 0);
    },
  });
}

Deno.test({
  name: "heyreach-webhook gate: warehouse-only skip with no active agent config → no inference event (main's condition)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [] });
    const r = await post(db, payload({ id: CAMPAIGN, name: "C" }));
    assertEquals(r.status, 200);
    assertEquals(r.body.skipped, "no_synced_row");
    assertEquals(r.body.warehouseRecorded, false);
    assertEquals(r.leadWrites.length, 0);
    assertEquals(db.writes("inference_events").length, 0);
  },
});

Deno.test({
  name: "heyreach-webhook gate: capture disabled → 200 skipped=capture_disabled, full silence (no agent_leads access, no inference event)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [campaignRow(false)], agent_configs: [AGENT_CONFIG] });
    const r = await post(db, payload({ id: CAMPAIGN, name: "C" }));
    assertEquals(r.status, 200);
    assertEquals(r.body.success, true);
    assertEquals(r.body.skipped, "capture_disabled");
    assertEquals(r.body.conversationId, "conv-test-1");
    assertEquals(r.leadWrites.length, 0, "no agent_leads write on skip");
    assertEquals(db.reads("agent_leads").length, 0, "gate runs before any agent_leads access");
    assertEquals(db.writes("inference_events").length, 0, "capture_disabled stays silent, as on main");
    assertEquals(db.writes("people").length, 0);
    assert(r.rec.logs.some((l) => l.includes("skip (capture_disabled)") && l.includes("conversation=conv-test-1")), "skip is logged");
    assertEquals(db.writes("webhook_events").length, 1);
  },
});

Deno.test({
  name: "heyreach-webhook gate: allowed campaign still records exactly one inference event (captured path unchanged)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [campaignRow(true)], agent_configs: [AGENT_CONFIG] });
    const r = await post(db, payload({ id: CAMPAIGN, name: "C" }));
    assertEquals(r.status, 200);
    assertEquals(r.body.skipped, undefined);
    assert(r.leadWrites.length >= 1);
    const inf = db.writes("inference_events");
    assertEquals(inf.length, 1);
    assertEquals((inf[0].body as Row).campaign_external_id, String(CAMPAIGN));
    assertEquals(((inf[0].body as Row).metadata as Row).capture_skipped, undefined);
  },
});

for (const [label, campaign] of [
  ["nested numeric campaign.id", { id: CAMPAIGN, name: "Payload Name" }],
  ["nested string campaign.id", { id: ` ${CAMPAIGN} `, name: "Payload Name" }],
] as const) {
  Deno.test({
    name: `heyreach-webhook gate: allowed (${label}) → agent_leads written with campaign attribution`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [campaignRow(true)] });
      const r = await post(db, payload(campaign));
      assertEquals(r.status, 200);
      assertEquals(r.body.skipped, undefined);
      assert(r.leadWrites.length >= 1, "allowed event writes agent_leads");
      const row = r.leadWrites[0].body as Row;
      assertEquals(row.campaign_external_id, String(CAMPAIGN));
      assertEquals(row.last_campaign_name, "Payload Name");
    },
  });
}

Deno.test({
  name: "heyreach-webhook gate: flat top-level campaignId fallback is accepted",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [campaignRow(true)] });
    const r = await post(db, payload(undefined, { campaignId: CAMPAIGN }));
    assertEquals(r.body.skipped, undefined);
    assert(r.leadWrites.length >= 1);
  },
});

Deno.test({
  name: "heyreach-webhook: multi-integration disambiguation uses the nested campaign.id",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration(INT, USER), integration(INT2, USER2)],
      synced_campaigns: [campaignRow(true, INT2)],
    });
    const r = await post(db, payload({ id: CAMPAIGN, name: "C" }), "/heyreach-webhook");
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assert(r.leadWrites.length >= 1);
    assertEquals((r.leadWrites[0].body as Row).user_id, USER2);
  },
});

Deno.test({
  name: "heyreach-webhook: existing lead UPDATE never nulls last_campaign_name (falls back to the synced name)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration()],
      synced_campaigns: [campaignRow(true)],
      agent_leads: [{
        id: "lead-1", user_id: USER, linkedin_url: "https://www.linkedin.com/in/test-prospect-0001",
        disposition_tag: null, last_surfaced_reply_at: "2026-01-01T00:00:00.000Z", inbox_status: "mirrored",
        last_campaign_name: "Earlier Name",
      }],
    });
    const r = await post(db, payload({ id: CAMPAIGN }));
    const upd = r.leadWrites.find((w) => w.method === "PATCH");
    assert(upd, "existing lead is updated");
    const body = upd!.body as Row;
    assert(body.last_campaign_name !== null, "last_campaign_name must not be nulled");
    assertEquals(body.last_campaign_name, "Synced Campaign Name");
  },
});
