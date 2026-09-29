// Handler-level fail-closed Capture scope tests for recover-heyreach-leads
// (REAL index.ts, fake PostgREST + fake HeyReach; synthetic data only).
//
// Proves: no enabled campaign / only non-numeric ids / lookup error → the
// function REFUSES (400 with skipped:<reason>), makes NO HeyReach call and NO
// agent_leads write. When campaigns are enabled, exactly the enabled ids are
// sent to GetConversationsV2 as INTEGERS (disabled and other-integration
// rows excluded) and recovery proceeds.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-0000000000f1";
const INT2 = "00000000-0000-4000-8000-0000000000f2";
const USER = "00000000-0000-4000-8000-0000000000b1";
const RECENT = new Date(Date.now() - 3600_000).toISOString();

const integration: Row = { id: INT, created_by: USER, api_key_encrypted: "k", platform: "heyreach" };
const row = (id: string, enabled: boolean, integrationId = INT): Row => ({ id: `sc-${integrationId}-${id}`, integration_id: integrationId, external_campaign_id: id, capture_enabled: enabled });

const heyreach = (_req: Request, url: URL) => {
  if (url.hostname !== "api.heyreach.io") return undefined;
  if (url.pathname.endsWith("/inbox/GetConversationsV2")) {
    return json({
      totalCount: 1,
      items: [{ id: "conv-r1", linkedInAccountId: 111, correspondentProfile: { firstName: "Test", lastName: "Prospect", profileUrl: "https://www.linkedin.com/in/test-prospect-0003" } }],
    });
  }
  if (url.pathname.includes("/inbox/GetChatroom/")) {
    return json({ messages: [{ sender: "CORRESPONDENT", body: "Following up on your note", createdAt: RECENT }] });
  }
  return undefined;
};

async function post(db: FakeSupabase, body: Record<string, unknown>) {
  const { result, rec } = await withFakes(db, heyreach, async () => {
    const res = await handler(new Request("http://local/recover-heyreach-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify({ integrationId: INT, since: "2026-01-01T00:00:00Z", ...body }),
    }));
    return { status: res.status, body: await res.json() };
  });
  const heyreachCalls = rec.providerCalls.filter((c) => c.url.includes("api.heyreach.io"));
  return { ...result, rec, heyreachCalls };
}

const refuseCases: Array<{ name: string; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "no synced rows", rows: [], reason: "none_enabled" },
  { name: "all campaigns capture-disabled", rows: [row("518402", false)], reason: "none_enabled" },
  { name: "enabled only on another integration", rows: [row("518402", true, INT2)], reason: "none_enabled" },
  { name: "only non-numeric enabled ids", rows: [row("not-a-number", true)], reason: "none_enabled" },
  { name: "lookup error", rows: [row("518402", true)], fail: true, reason: "lookup_error" },
];

for (const c of refuseCases) {
  Deno.test({
    name: `recover-heyreach-leads scope: ${c.name} → refuses (${c.reason}), no HeyReach call, no agent_leads write`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: c.rows });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await post(db, { dryRun: false, maxConversations: 5 });
      assertEquals(r.status, 400);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(r.heyreachCalls.length, 0, "no HeyReach request when refusing");
      assertEquals(db.writes("agent_leads").length, 0);
      assertEquals(db.reads("agent_leads").length, 0);
      assert(r.rec.logs.some((l) => l.includes(`refusing: capture scope ${c.reason}`)), "refusal is logged");
    },
  });
}

Deno.test({
  name: "recover-heyreach-leads scope: enabled ids are passed to GetConversationsV2 as integers; recovery writes",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration],
      synced_campaigns: [row("518402", true), row(" 518403 ", true), row("518404", false), row("518405", true, INT2)],
    });
    const r = await post(db, { dryRun: false, maxConversations: 5 });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    const conv = r.heyreachCalls.filter((c) => c.url.endsWith("/inbox/GetConversationsV2"));
    assertEquals(conv.length, 1);
    const ids = (conv[0].body as { filters: { campaignIds: unknown[] } }).filters.campaignIds;
    assertEquals(ids, [518402, 518403]);
    assert(db.writes("agent_leads").length >= 1, "allowed recovery writes agent_leads");
  },
});

Deno.test({
  name: "recover-heyreach-leads scope: dryRun (default) still scopes the HeyReach request and writes nothing",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [row("518402", true)] });
    const r = await post(db, {});
    assertEquals(r.status, 200);
    const conv = r.heyreachCalls.find((c) => c.url.endsWith("/inbox/GetConversationsV2"));
    assertEquals((conv!.body as { filters: { campaignIds: unknown[] } }).filters.campaignIds, [518402]);
    assertEquals(db.writes("agent_leads").length, 0);
  },
});
