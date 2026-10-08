// fetch-capture-scope serves Reply.io (REAL index.ts against a fake PostgREST;
// synthetic data only).
//
// Proves: a 'reply.io' integration gets its sequences from synced_campaigns
// with capture_enabled mapped through, volume from the synced stats (unknown
// stays null), no senders, and ZERO outbound calls (no Reply.io API). Other
// integrations' rows never leak in. An unknown platform still gets a 400 that
// now lists reply.io as supported.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, loadHandler, noProviders, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";
import { isReplyIoPlatform, replyioCaptureScopeAdapter } from "../_shared/capture-scope-replyio.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-000000000201";
const INT2 = "00000000-0000-4000-8000-000000000202";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";

const integ = (id: string, platform: string): Row => ({ id, team_id: TEAM, platform, api_key_encrypted: "k", created_by: USER, is_active: true });
const seq = (id: string, enabled: boolean, extra: Row = {}, integrationId = INT): Row => ({
  id: `sc-${integrationId}-${id}`, integration_id: integrationId, team_id: TEAM, source: "reply_io",
  external_campaign_id: id, name: `Sequence ${id}`, status: "active", raw_status: "Active", capture_enabled: enabled,
  stats: { sent: 120, replies: 7 }, ...extra,
});

async function call(db: FakeSupabase, body: unknown) {
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
  name: "fetch-capture-scope: reply.io integration lists its sequences from synced_campaigns (DB only)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, "reply.io"), integ(INT2, "reply.io")],
      synced_campaigns: [
        seq("111", true),
        seq("222", false, { stats: {}, name: "  " }),
        seq("333", false, {}, INT2),
      ],
    });
    const r = await call(db, { integrationId: INT });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(r.body.platform, "reply.io");
    const byId = new Map((r.body.campaigns as Row[]).map((c) => [c.externalId, c]));
    assertEquals([...byId.keys()].sort(), ["111", "222"], "only this integration's rows");
    assertEquals(byId.get("111")!.captureEnabled, true);
    assertEquals(byId.get("111")!.volume, { sent: 120, replies: 7 });
    assertEquals(byId.get("111")!.senders, []);
    assertEquals(byId.get("222")!.captureEnabled, false);
    assertEquals(byId.get("222")!.volume, { sent: null, replies: null }, "unknown volume stays null");
    assertEquals(byId.get("222")!.name, "Untitled sequence 222");
    assertEquals(r.body.counts, { total: 2, captureEnabled: 1, captureDisabled: 1, skippedReplies: 0 });
    assertEquals(r.body.sendersAvailable, false);
    assertEquals(r.body.sendersDeferred, false);
    assertEquals(r.rec.providerCalls.length, 0, "no Reply.io API call");
    assertEquals(db.writes("synced_campaigns").length, 0, "read-only");
  },
});

Deno.test({
  name: "fetch-capture-scope: reply.io senders mode → no per-campaign sender listing",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integ(INT, "reply.io")], synced_campaigns: [seq("111", true)] });
    const r = await call(db, { integrationId: INT, mode: "senders", externalIds: ["111"] });
    assertEquals(r.status, 200);
    assertEquals(r.body.senders, {});
    assertEquals(r.rec.providerCalls.length, 0);
  },
});

Deno.test({
  name: "fetch-capture-scope: unsupported platform → 400 listing smartlead, heyreach and reply.io",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integ(INT, "lemlist")], synced_campaigns: [] });
    const r = await call(db, { integrationId: INT });
    assertEquals(r.status, 400);
    assertEquals([...(r.body.supported as string[])].sort(), ["heyreach", "reply.io", "smartlead"]);
  },
});

Deno.test("capture-scope-replyio: platform match is case/space-insensitive and exact", () => {
  assert(isReplyIoPlatform("reply.io"));
  assert(isReplyIoPlatform(" Reply.io "));
  assert(!isReplyIoPlatform("reply_io"));
  assert(!isReplyIoPlatform("smartlead"));
  assert(!isReplyIoPlatform(null));
});

Deno.test("capture-scope-replyio: lookup error propagates (no silent empty list)", async () => {
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }),
  };
  let threw = false;
  try {
    await replyioCaptureScopeAdapter.listCampaigns(db, { id: INT, team_id: TEAM, platform: "reply.io", api_key_encrypted: null });
  } catch (e) {
    threw = true;
    assert(String((e as Error).message).includes("boom"));
  }
  assert(threw);
});
