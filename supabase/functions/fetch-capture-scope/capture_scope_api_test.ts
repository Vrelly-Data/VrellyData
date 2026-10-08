// fetch-capture-scope handler tests (REAL index.ts, fake PostgREST; synthetic
// data only). Internal (x-agent-key) callers; the JWT/team-access path needs a
// real auth server and is verified against dev.
//
// Proves: every gated platform has an adapter (Reply.io included — the bug was
// a 400 for reply.io); the list carries channel, the auto-capture setting and
// per-campaign skipped replies (14 days, not yet recaptured); recapture only
// ever targets campaigns that are capture-enabled NOW, calls the platform's
// poller with the agent key, and marks those skips recaptured.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, loadHandler, noProviders, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const TEAM = "00000000-0000-4000-8000-0000000000c1";
const RIO = "00000000-0000-4000-8000-000000000a01";
const SL = "00000000-0000-4000-8000-000000000a02";
const HR = "00000000-0000-4000-8000-000000000a03";
const PB = "00000000-0000-4000-8000-000000000a04";

const integ = (id: string, platform: string, auto = true): Row => ({
  id, team_id: TEAM, platform, api_key_encrypted: null, created_by: "u1", is_active: true, auto_capture_new_campaigns: auto,
});
const camp = (integrationId: string, id: string, enabled: boolean, extra: Row = {}): Row => ({
  id: `sc-${integrationId}-${id}`, integration_id: integrationId, team_id: TEAM, external_campaign_id: id,
  name: `Campaign ${id}`, status: "ACTIVE", raw_status: "ACTIVE", capture_enabled: enabled, stats: { sent: 10, replies: 2 }, raw_data: {}, ...extra,
});
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const skip = (integrationId: string, campaign: string, contact: string, occurredAt: string, recapturedAt: string | null = null): Row => ({
  id: `sk-${campaign}-${contact}`, integration_id: integrationId, team_id: TEAM, platform: "reply.io",
  campaign_external_id: campaign, contact_key: contact, occurred_at: occurredAt, recaptured_at: recapturedAt,
});

async function call(db: FakeSupabase, body: Record<string, unknown>) {
  const { result, rec } = await withFakes(db, noProviders, async () => {
    const res = await handler(new Request("http://local/fetch-capture-scope", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

Deno.test({
  name: "fetch-capture-scope: Reply.io, Smartlead and HeyReach all list (no 400 for reply.io); an ungated platform still 400s",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(RIO, "reply.io"), integ(SL, "smartlead", false), integ(HR, "heyreach"), integ(PB, "phoneburner")],
      synced_campaigns: [
        camp(RIO, "101", true, { channel: "multichannel" }), camp(RIO, "102", false, { channel: "email" }),
        camp(SL, "201", true), camp(HR, "301", false),
      ],
    });
    const rio = await call(db, { integrationId: RIO });
    assertEquals(rio.status, 200, JSON.stringify(rio.body));
    assertEquals(rio.body.platform, "reply.io");
    assertEquals(rio.body.campaigns.map((c: Row) => `${c.externalId}:${c.captureEnabled}:${c.channel}`), ["101:true:multichannel", "102:false:email"]);
    assertEquals(rio.body.autoCaptureNewCampaigns, true);
    assertEquals(rio.body.sendersAvailable, false, "Reply.io v1: no senders");

    const sl = await call(db, { integrationId: SL });
    assertEquals(sl.status, 200);
    assertEquals(sl.body.campaigns[0].channel, "email");
    assertEquals(sl.body.autoCaptureNewCampaigns, false);

    const hr = await call(db, { integrationId: HR });
    assertEquals(hr.status, 200);
    assertEquals(hr.body.campaigns[0].channel, "linkedin");

    const pb = await call(db, { integrationId: PB });
    assertEquals(pb.status, 400);
    assertEquals([...pb.body.supported].sort(), ["heyreach", "reply.io", "smartlead"]);
  },
});

Deno.test({
  name: "fetch-capture-scope list: skipped replies per campaign = last 14 days, not yet recaptured",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(RIO, "reply.io")],
      synced_campaigns: [camp(RIO, "101", false), camp(RIO, "102", false), camp(RIO, "103", true)],
      capture_scope_skips: [
        skip(RIO, "101", "a@x.test", daysAgo(1)),
        skip(RIO, "101", "b@x.test", daysAgo(3)),
        skip(RIO, "101", "c@x.test", daysAgo(20)),             // older than the window
        skip(RIO, "102", "d@x.test", daysAgo(2), daysAgo(1)),  // already recaptured
        skip(RIO, "103", "e@x.test", daysAgo(2)),              // capture-on (e.g. was unsynced)
      ],
    });
    const r = await call(db, { integrationId: RIO });
    assertEquals(r.status, 200);
    const byId = Object.fromEntries(r.body.campaigns.map((c: Row) => [c.externalId, c.skippedReplies]));
    assertEquals((byId["101"] as Row).count, 2);
    assertEquals(byId["102"], null);
    assertEquals((byId["103"] as Row).count, 1);
    assertEquals(r.body.counts.skippedReplies, 3);
    assertEquals(r.body.skippedRepliesWindowDays, 14);
  },
});

Deno.test({
  name: "fetch-capture-scope recapture: only campaigns enabled NOW; poller called with agent key + 14 days; their skips marked recaptured",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(RIO, "reply.io")],
      synced_campaigns: [camp(RIO, "101", true), camp(RIO, "102", false)],
      capture_scope_skips: [skip(RIO, "101", "a@x.test", daysAgo(1)), skip(RIO, "102", "b@x.test", daysAgo(1))],
    });
    const r = await call(db, { integrationId: RIO, mode: "recapture", externalIds: ["101", "102"] });
    assertEquals(r.status, 202, JSON.stringify(r.body));
    assertEquals(r.body.recapture.campaignIds, ["101"]);
    assertEquals(r.body.skippedNotEnabled, ["102"]);
    assertEquals(r.rec.functionCalls.length, 1);
    assertEquals(r.rec.functionCalls[0].path, "/functions/v1/poll-reply-inbox");
    assertEquals(r.rec.functionCalls[0].body, { mode: "recapture", integrationId: RIO, campaignIds: ["101"], lookbackDays: 14 });
    const skips = db.tables.capture_scope_skips as Row[];
    assert(skips.find((s) => s.campaign_external_id === "101")!.recaptured_at, "enabled campaign's skips marked");
    assertEquals(skips.find((s) => s.campaign_external_id === "102")!.recaptured_at, null, "capture-off campaign's skips untouched");
  },
});

Deno.test({
  name: "fetch-capture-scope recapture: nothing enabled → 400, no poller call",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integ(SL, "smartlead")], synced_campaigns: [camp(SL, "201", false)] });
    const r = await call(db, { integrationId: SL, mode: "recapture", externalIds: ["201"] });
    assertEquals(r.status, 400);
    assertEquals(r.rec.functionCalls, []);
  },
});

Deno.test({
  name: "fetch-capture-scope recapture: each platform calls its own poller",
  ...testOpts,
  async fn() {
    for (const [id, platform, fn] of [[SL, "smartlead", "poll-smartlead-inbox"], [HR, "heyreach", "poll-heyreach-inbox"]] as const) {
      const db = new FakeSupabase({ outbound_integrations: [integ(id, platform)], synced_campaigns: [camp(id, "9", true)] });
      const r = await call(db, { integrationId: id, mode: "recapture", externalIds: ["9"] });
      assertEquals(r.status, 202);
      assertEquals(r.rec.functionCalls.map((c) => c.path), [`/functions/v1/${fn}`]);
    }
  },
});
