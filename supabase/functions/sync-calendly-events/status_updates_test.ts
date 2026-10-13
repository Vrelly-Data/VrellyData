import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-00000000ca11";
const TEAM = "00000000-0000-4000-8000-0000000000c1";

function calendlyProvider(_req: Request, url: URL) {
  if (url.hostname !== "api.calendly.com") return undefined;
  if (url.pathname === "/users/me") {
    return json({ resource: { uri: "https://api.calendly.com/users/abc" } });
  }
  if (url.pathname === "/scheduled_events") {
    return json({ collection: [], pagination: { next_page: null } });
  }
  // invitees for any event — not reached in our tests
  if (/^\/scheduled_events\/[^/]+\/invitees$/.test(url.pathname)) {
    return json({ collection: [] });
  }
  return json({});
}

Deno.test({
  name: "sync-calendly-events: pending → synced with last_synced_at on success (multi-cron path)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [{
        id: INT, team_id: TEAM, platform: "calendly", api_key_encrypted: "t",
        is_active: true, sync_status: "pending", sync_error: "old error", last_synced_at: null,
      } satisfies Row],
    });
    const { result } = await withFakes(db, calendlyProvider, async () => {
      const res = await handler(new Request("http://local/sync-calendly-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
        body: "{}", // internal multi path
      }));
      return { status: res.status, body: await res.json() };
    });
    assertEquals(result.status, 200);
    const updates = db.writes("outbound_integrations").filter((w) => w.method === "PATCH");
    assert(updates.length >= 1, "integration status should be updated at least once");
    const last = updates[updates.length - 1].body as Row;
    assertEquals(last.sync_status, "synced");
    assertEquals(last.sync_error, null);
    assert(typeof (last.last_synced_at as string) === "string");
  },
});

Deno.test({
  name: "sync-calendly-events: pending → error with message on failure (single-id path)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [{
        id: INT, team_id: TEAM, platform: "calendly", api_key_encrypted: "t",
        is_active: true, sync_status: "pending", sync_error: null, last_synced_at: null,
      } satisfies Row],
    });
    const { result } = await withFakes(db, (_req, url) => {
      if (url.hostname !== "api.calendly.com") return undefined;
      if (url.pathname === "/users/me") return json({ resource: { uri: "https://api.calendly.com/users/abc" } });
      if (url.pathname === "/scheduled_events") return json({ message: "boom" }, 500);
      return json({});
    }, async () => {
      const res = await handler(new Request("http://local/sync-calendly-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
        body: JSON.stringify({ integrationId: INT }),
      }));
      return { status: res.status, body: await res.json() };
    });
    assertEquals(result.status, 500);
    const updates = db.writes("outbound_integrations").filter((w) => w.method === "PATCH");
    assert(updates.length >= 1, "integration error status should be recorded");
    const last = updates[updates.length - 1].body as Row;
    assertEquals(last.sync_status, "error");
    assert(typeof (last.sync_error as string) === "string" && (last.sync_error as string).length > 0);
  },
});

