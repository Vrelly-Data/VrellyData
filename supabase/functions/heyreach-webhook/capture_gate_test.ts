// Handler-level fail-closed Capture gate tests for heyreach-webhook: the REAL
// index.ts handler runs against a fake PostgREST (see
// _shared/testing/fake_platform.ts). Synthetic data only.
//
// Proves: missing campaign id / missing synced row / capture disabled / lookup
// error each return 200 { success:true, skipped:<reason> } with ZERO
// agent_leads writes; an enabled campaign writes. The nested campaign.id
// (a JSON number in real payloads) is what gates, and it also drives
// multi-integration disambiguation. last_campaign_name is never null-clobbered.
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

const skipCases: Array<{ name: string; campaign: unknown; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "missing campaign id", campaign: undefined, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "campaign object without id", campaign: { name: "x" }, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "missing synced row", campaign: { id: CAMPAIGN, name: "C" }, rows: [], reason: "no_synced_row" },
  { name: "row for another integration only", campaign: { id: CAMPAIGN, name: "C" }, rows: [campaignRow(true, INT2)], reason: "no_synced_row" },
  { name: "capture disabled", campaign: { id: CAMPAIGN, name: "C" }, rows: [campaignRow(false)], reason: "capture_disabled" },
  { name: "lookup error", campaign: { id: CAMPAIGN, name: "C" }, rows: [campaignRow(true)], fail: true, reason: "lookup_error" },
];

for (const c of skipCases) {
  Deno.test({
    name: `heyreach-webhook gate: ${c.name} → 200 skipped=${c.reason}, no agent_leads write`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: c.rows });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await post(db, payload(c.campaign));
      assertEquals(r.status, 200);
      assertEquals(r.body.success, true);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(r.leadWrites.length, 0, "no agent_leads write on skip");
      assertEquals(db.reads("agent_leads").length, 0, "gate runs before any agent_leads access");
      assert(r.rec.logs.some((l) => l.includes(`skip (${c.reason})`)), "skip is logged");
      // The raw event is still logged to webhook_events (not capture).
      assertEquals(db.writes("webhook_events").length, 1);
    },
  });
}

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
