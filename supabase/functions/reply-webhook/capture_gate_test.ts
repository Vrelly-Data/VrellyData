// Handler-level fail-closed Capture gate tests for reply-webhook, covering BOTH
// agent_leads writers in the handler (REAL index.ts, fake PostgREST + fake
// Reply.io API; synthetic data only):
//   - LEGACY path: email_replied for a known synced_contact with a reply body.
//   - INBOX-ROUTING path: any reply event with an active agent config.
// For every skip reason: HTTP 200 { success:true, skipped:<reason> }, ZERO
// agent_leads writes, and the skip is logged. Allowed events write. Numeric
// and string sequence ids gate identically. Stats / webhook_events /
// synced_contacts updates still happen on a skip (not capture), and the gate
// lookup runs at most once per event.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-0000000000e1";
const INT2 = "00000000-0000-4000-8000-0000000000e2";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const REPLY_TEAM = "424200";
const SEQ = 13579;
const CONTACT_ID = 9001;
const EMAIL = "prospect-0002@example.test";

const integration: Row = { id: INT, team_id: TEAM, api_key_encrypted: "k", is_active: true, webhook_secret: null, created_by: USER, reply_team_id: REPLY_TEAM, platform: "reply.io" };
const campaignRow = (enabled: boolean, integrationId = INT): Row => ({
  id: `sc-${integrationId}`, integration_id: integrationId, team_id: TEAM, external_campaign_id: String(SEQ), capture_enabled: enabled, name: "Synced Sequence", stats: {}, source: "reply_io",
});
const syncedContact: Row = { id: "sc-contact-1", email: EMAIL, team_id: TEAM, engagement_data: {}, first_name: "Test", last_name: "Prospect", external_contact_id: String(CONTACT_ID) };
const agentConfig: Row = { id: "cfg-1", user_id: USER, is_active: true };

function payload(kind: "email" | "linkedin", seq: unknown): Record<string, unknown> {
  return {
    event: { type: kind === "email" ? "EmailReplied" : "LinkedinMessageReplied", TeamId: REPLY_TEAM },
    contact_fields: { email: EMAIL, first_name: "Test", last_name: "Prospect", id: CONTACT_ID },
    ...(seq === undefined ? {} : { sequence_fields: { id: seq } }),
    reply_text: "Happy to chat, send times.",
    emailTextBody: "Happy to chat, send times.",
  };
}

const replyApi = (_req: Request, url: URL) => {
  if (url.hostname !== "api.reply.io") return undefined;
  if (url.pathname.endsWith("/inbox/threads")) {
    return json({ items: [{ id: 555001, channel: "linkedIn", contact: { id: CONTACT_ID, email: EMAIL }, sequence: { id: SEQ } }] });
  }
  return json({ items: [] });
};

async function post(db: FakeSupabase, body: unknown) {
  const { result, rec } = await withFakes(db, replyApi, async () => {
    const res = await handler(new Request("http://local/reply-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

type Case = { name: string; seq: unknown; rows: Row[]; fail?: boolean; reason: string };
const skipCases: Case[] = [
  { name: "missing sequence id", seq: undefined, rows: [campaignRow(true)], reason: "no_campaign_id" },
  { name: "missing synced row", seq: SEQ, rows: [], reason: "no_synced_row" },
  { name: "row for another integration only", seq: SEQ, rows: [campaignRow(true, INT2)], reason: "no_synced_row" },
  { name: "capture disabled", seq: SEQ, rows: [campaignRow(false)], reason: "capture_disabled" },
  { name: "lookup error", seq: SEQ, rows: [campaignRow(true)], fail: true, reason: "lookup_error" },
];

// LEGACY path in isolation: no agent config, so inbox-routing cannot write.
for (const c of skipCases) {
  Deno.test({
    name: `reply-webhook LEGACY gate: ${c.name} → 200 skipped=${c.reason}, no agent_leads write`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: c.rows, synced_contacts: [syncedContact] });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await post(db, payload("email", c.seq));
      assertEquals(r.status, 200);
      assertEquals(r.body.success, true);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(db.writes("agent_leads").length, 0, "legacy writer must not write on skip");
      assert(r.rec.logs.some((l) => l.includes(`legacy path skip (${c.reason})`) || (c.reason === "no_campaign_id" && l.includes(`skip (${c.reason})`))), "skip is logged");
      assertEquals(db.writes("webhook_events").length, 1, "raw event still logged");
    },
  });
}

// INBOX-ROUTING path in isolation: LinkedIn reply (legacy path is email-only)
// with an active agent config, so only inbox-routing could write.
for (const c of skipCases) {
  Deno.test({
    name: `reply-webhook INBOX-ROUTING gate: ${c.name} → 200 skipped=${c.reason}, no agent_leads write`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: c.rows, synced_contacts: [syncedContact], agent_configs: [agentConfig] });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await post(db, payload("linkedin", c.seq));
      assertEquals(r.status, 200);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(db.writes("agent_leads").length, 0, "inbox-routing writer must not write on skip");
      assertEquals(db.reads("agent_configs").length, 0, "gate runs before the agent-config lookup");
      assert(r.rec.logs.some((l) => l.includes(`[inbox-routing] skip (${c.reason})`)), "skip is logged");
    },
  });
}

Deno.test({
  name: "reply-webhook: both paths on one event → one gate lookup, zero agent_leads writes, stats + synced_contacts still updated",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaignRow(false)], synced_contacts: [syncedContact], agent_configs: [agentConfig] });
    const r = await post(db, payload("email", SEQ));
    assertEquals(r.body.skipped, "capture_disabled");
    assertEquals(db.writes("agent_leads").length, 0);
    const gateLookups = db.reads("synced_campaigns").filter((c) => c.params.get("select")?.includes("capture_enabled"));
    assertEquals(gateLookups.length, 1, "gate evaluated once and shared by both paths");
    assert(db.writes("synced_campaigns").length >= 1, "campaign stats still updated");
    assert(db.writes("synced_contacts").length >= 1, "synced_contacts engagement still updated");
    // sync-reply-contacts is still fired; its own agent_leads writes are gated there.
    assert(r.rec.functionCalls.some((f) => f.path.endsWith("/sync-reply-contacts")));
  },
});

for (const seq of [SEQ, String(SEQ)]) {
  Deno.test({
    name: `reply-webhook LEGACY gate: allowed (${typeof seq} sequence id) → agent_leads written`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaignRow(true)], synced_contacts: [syncedContact] });
      const r = await post(db, payload("email", seq));
      assertEquals(r.status, 200);
      assertEquals(r.body.skipped, undefined, JSON.stringify(r.body));
      assert(db.writes("agent_leads").length >= 1, "legacy writer writes when allowed");
    },
  });
  Deno.test({
    name: `reply-webhook INBOX-ROUTING gate: allowed (${typeof seq} sequence id) → agent_leads written`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [campaignRow(true)], synced_contacts: [syncedContact], agent_configs: [agentConfig] });
      const r = await post(db, payload("linkedin", seq));
      assertEquals(r.status, 200);
      assertEquals(r.body.skipped, undefined, JSON.stringify(r.body));
      assert(db.writes("agent_leads").length >= 1, "inbox-routing writes when allowed");
    },
  });
}
