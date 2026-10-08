// auto-sync-integrations v2: fan-out tests (REAL index.ts, fake platform).
// Proves every active integration of every platform gets its own sync
// invocation (none waits on another), inactive ones are skipped, HeyReach is
// included, and the 6-hourly scope fans out contacts per Reply.io integration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);
const T = "00000000-0000-4000-8000-0000000000c1";
const integ = (id: string, platform: string, active = true): Row => ({ id, platform, team_id: T, is_active: active });
const ints = [
  integ("r1", "reply.io"), integ("r2", "reply.io"), integ("r3", "reply.io", false),
  integ("s1", "smartlead"), integ("h1", "heyreach"), integ("p1", "phoneburner"),
];

async function call(db: FakeSupabase, body: unknown, key = AGENT_KEY) {
  const { result, rec } = await withFakes(db, () => undefined, async () => {
    const res = await handler(new Request("http://local/auto-sync-integrations", {
      method: "POST", headers: { "Content-Type": "application/json", "x-agent-key": key }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

Deno.test({
  name: "auto-sync campaigns: one sync per active Reply.io + Smartlead integration and one HeyReach sync, all dispatched, 202",
  ...testOpts,
  async fn() {
    const r = await call(new FakeSupabase({ outbound_integrations: ints }), { scope: "campaigns" });
    assertEquals(r.status, 202);
    const calls = r.rec.functionCalls.map((c) => `${c.path.replace("/functions/v1/", "")}:${(c.body as Row)?.integrationId ?? "all"}`).sort();
    assertEquals(calls, ["sync-heyreach-campaigns:all", "sync-reply-campaigns:r1", "sync-reply-campaigns:r2", "sync-smartlead-campaigns:s1"]);
    const sl = r.rec.functionCalls.find((c) => c.path.endsWith("sync-smartlead-campaigns"))!;
    assertEquals((sl.body as Row).skipAnalytics, true);
    assertEquals(r.body.dispatched.length, 4);
  },
});

Deno.test({
  name: "auto-sync full: contacts fanned out per active Reply.io integration (no campaign re-sync)",
  ...testOpts,
  async fn() {
    const r = await call(new FakeSupabase({ outbound_integrations: ints }), { scope: "full" });
    assertEquals(r.status, 202);
    assertEquals(r.rec.functionCalls.map((c) => [c.path, (c.body as Row).scope, (c.body as Row).integrationId]).sort(),
      [["/functions/v1/auto-sync-integrations", "contacts", "r1"], ["/functions/v1/auto-sync-integrations", "contacts", "r2"]]);
  },
});

Deno.test({
  name: "auto-sync contacts: one integration, every campaign synced via sync-reply-contacts",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: ints,
      synced_campaigns: [{ id: "c1", integration_id: "r1", external_campaign_id: "1" }, { id: "c2", integration_id: "r1", external_campaign_id: "2" }, { id: "c3", integration_id: "r2", external_campaign_id: "3" }],
    });
    const r = await call(db, { scope: "contacts", integrationId: "r1" });
    assertEquals(r.status, 200);
    assertEquals(r.rec.functionCalls.map((c) => (c.body as Row).campaignId).sort(), ["c1", "c2"]);
    assertEquals(r.body.synced, 2);
    assert(r.rec.functionCalls.every((c) => c.path === "/functions/v1/sync-reply-contacts"));
  },
});

Deno.test({
  name: "auto-sync: wrong agent key → 401, nothing dispatched",
  ...testOpts,
  async fn() {
    const r = await call(new FakeSupabase({ outbound_integrations: ints }), { scope: "campaigns" }, "nope");
    assertEquals(r.status, 401);
    assertEquals(r.rec.functionCalls, []);
  },
});
