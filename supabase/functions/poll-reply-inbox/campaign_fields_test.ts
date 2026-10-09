// poll-reply-inbox: lead UPDATES carry the thread's campaign (REAL index.ts,
// fake PostgREST + fake Reply.io v3; synthetic data only).
//
// Bug: an existing lead updated by the poller kept a null/stale
// last_campaign_name and campaign_external_id even though thread.sequence
// names the campaign. The update now writes both from thread.sequence — and a
// thread with no sequence never blanks a stored value.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-000000000101";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const RECENT = new Date(Date.now() - 600_000).toISOString();
const OLDER = new Date(Date.now() - 3_600_000).toISOString();

const THREADS = [
  { id: 351000001, channel: "linkedIn", lastActivityDate: RECENT, contact: { id: 1, fullName: "Test One", email: "t1@example.test" }, sequence: { id: 13579, name: "Q4 Lenders" } },
];
const replyApi = (_req: Request, url: URL) => {
  if (url.hostname !== "api.reply.io") return undefined;
  if (/\/inbox\/threads\/\d+\/messages$/.test(url.pathname)) {
    return json({ items: [{ date: RECENT, body: "Sounds good, tell me more", fromName: "Test One", isOutbound: false, channel: "linkedIn" }], hasMore: false });
  }
  if (url.pathname.endsWith("/inbox/threads")) return json({ items: THREADS, hasMore: false });
  return undefined;
};

Deno.test({
  name: "poll-reply-inbox: updating an existing lead writes campaign_external_id + last_campaign_name from thread.sequence",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [{ id: INT, created_by: USER, team_id: TEAM, api_key_encrypted: "k1", is_active: true, platform: "reply.io", auto_capture_new_campaigns: false }],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [{ id: "sc-1", integration_id: INT, team_id: TEAM, external_campaign_id: "13579", capture_enabled: true }],
      agent_leads: [{
        id: "lead-1", user_id: USER, external_id: "351000001", email: "t1@example.test", linkedin_url: null,
        source: "reply_io", channel: "linkedin", inbox_status: "sent", last_reply_at: OLDER, last_surfaced_reply_at: OLDER,
        last_campaign_name: null, campaign_external_id: null, disposition_tag: null,
      }],
    });
    await withFakes(db, replyApi, async () => {
      const res = await handler(new Request("http://local/poll-reply-inbox", {
        method: "POST", headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY }, body: "{}",
      }));
      assertEquals(res.status, 200);
    });
    const patches = db.writes("agent_leads").filter((w) => w.method === "PATCH").map((w) => w.body as Row);
    assertEquals(patches.length, 1, "the existing lead was updated, not duplicated");
    assertEquals(patches[0].campaign_external_id, "13579");
    assertEquals(patches[0].last_campaign_name, "Q4 Lenders");
    const lead = (db.tables.agent_leads as Row[])[0];
    assertEquals([lead.campaign_external_id, lead.last_campaign_name], ["13579", "Q4 Lenders"]);
  },
});
