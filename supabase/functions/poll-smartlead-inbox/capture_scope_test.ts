// Handler-level fail-closed Capture scope tests for poll-smartlead-inbox's
// new-lead sweep (the only part of this function that INSERTS agent_leads).
// REAL index.ts, fake PostgREST + fake Smartlead; synthetic data only.
//
// Proves: the sweep's campaign set is synced_campaigns.capture_enabled keyed by
// INTEGRATION (not team); no enabled campaign or a lookup error skips the sweep
// for that integration (no Smartlead sweep calls, no agent_leads insert,
// reason in the response); with enabled campaigns only those are swept and a
// replied lead is inserted.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type RestCall, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-000000000301";
const INT2 = "00000000-0000-4000-8000-000000000302";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const RECENT = new Date(Date.now() - 3600_000).toISOString();

const integration: Row = { id: INT, created_by: USER, team_id: TEAM, api_key_encrypted: "k", is_active: true, platform: "smartlead" };
const row = (id: string, enabled: boolean, integrationId = INT): Row => ({
  id: `sc-${integrationId}-${id}`, integration_id: integrationId, team_id: TEAM, source: "smartlead", external_campaign_id: id,
  capture_enabled: enabled, name: `Campaign ${id}`, status: "in_progress", capture_recent_reply_sweep_at: null,
  capture_webhook_registered: true, capture_webhook_checked_at: new Date().toISOString(),
});

const smartlead = (_req: Request, url: URL) => {
  if (url.hostname !== "server.smartlead.ai") return undefined;
  const p = url.pathname;
  if (p.endsWith("/analytics-by-date")) return json({ replies: 1 });
  const stats = p.match(/\/campaigns\/(\d+)\/lead-statistics$/);
  if (stats) {
    if (Number(url.searchParams.get("offset") ?? 0) > 0) return json({ data: [] });
    return json({ data: [{ lead_id: `L${stats[1]}`, email: `lead-${stats[1]}@example.test`, reply_time: RECENT }] });
  }
  if (p.endsWith("/message-history")) {
    return json({ history: [
      { type: "SENT", message_id: "m1", stats_id: "s1", time: RECENT, email_body: "<p>Hello</p>", from: "sender@example.test" },
      { type: "REPLY", message_id: "m2", stats_id: "s2", time: RECENT, email_body: "<p>Interested</p>", from: "lead@example.test" },
    ] });
  }
  return json({});
};

async function run(db: FakeSupabase) {
  const { result, rec } = await withFakes(db, smartlead, async () => {
    const res = await handler(new Request("http://local/poll-smartlead-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: "{}",
    }));
    return { status: res.status, body: await res.json() };
  });
  // analytics-by-date is called by the new-lead sweep (3-day window) and by the
  // Capture Scope probe of capture-OFF campaigns (14-day window). Told apart by
  // the window so each assertion is about one of them.
  const analyticsCalls = rec.providerCalls
    .map((c) => new URL(c.url))
    .filter((u) => /\/campaigns\/\d+\/analytics-by-date$/.test(u.pathname))
    .map((u) => ({
      id: u.pathname.match(/\/campaigns\/(\d+)\//)![1],
      days: Math.round((Date.parse(u.searchParams.get("end_date")!) - Date.parse(u.searchParams.get("start_date")!)) / 86400_000),
    }));
  const sweptCampaigns = analyticsCalls.filter((c) => c.days < 10).map((c) => c.id);
  const probedCampaigns = analyticsCalls.filter((c) => c.days >= 10).map((c) => c.id);
  return { ...result, rec, sweptCampaigns, probedCampaigns };
}

const isScopeLookup = (c: RestCall) =>
  c.table === "synced_campaigns" && c.method === "GET" && c.params.get("capture_enabled") === "eq.true" && c.params.has("integration_id");

const skipCases: Array<{ name: string; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "no synced rows", rows: [], reason: "none_enabled" },
  { name: "all campaigns capture-disabled", rows: [row("1001", false)], reason: "none_enabled" },
  { name: "enabled only on another integration of the same team", rows: [row("1001", true, INT2)], reason: "none_enabled" },
  { name: "lookup error", rows: [row("1001", true)], fail: true, reason: "lookup_error" },
];

for (const c of skipCases) {
  Deno.test({
    name: `poll-smartlead-inbox scope: ${c.name} → new-lead sweep skipped (${c.reason}), no agent_leads insert`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: c.rows });
      if (c.fail) db.failIf.push((call) => isScopeLookup(call) ? "error" : undefined);
      const r = await run(db);
      assertEquals(r.status, 200);
      assertEquals(r.sweptCampaigns, [], "no campaign is swept");
      // The probe only ever looks at this integration's capture-OFF campaigns.
      const off = c.rows.filter((x) => x.integration_id === INT && x.capture_enabled === false).map((x) => String(x.external_campaign_id));
      assertEquals(r.probedCampaigns, off);
      assertEquals(db.writes("agent_leads").length, 0);
      assertEquals(r.body.newLeads, 0);
      assertEquals(r.body.captureScope.skippedIntegrations, [{ integrationId: INT, reason: c.reason }]);
      assert(r.rec.logs.some((l) => l.includes(`sweep skipped for integration ${INT} — capture scope ${c.reason}`)), "skip is logged");
    },
  });
}

Deno.test({
  name: "poll-smartlead-inbox scope: only this integration's capture-enabled campaigns are swept; replied lead inserted",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration],
      synced_campaigns: [row("1001", true), row("1002", false), row("1003", true, INT2)],
    });
    const r = await run(db);
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(r.sweptCampaigns, ["1001"]);
    assertEquals(r.probedCampaigns, ["1002"], "probe reads only the capture-off campaign of this integration");
    const inserts = db.writes("agent_leads").filter((w) => w.method === "POST");
    assertEquals(inserts.length, 1);
    assertEquals(String((inserts[0].body as Row).smartlead_campaign_id), "1001");
    assertEquals(r.body.newLeads, 1);
  },
});


Deno.test({
  name: "poll-smartlead-inbox probe: replied lead on a capture-off campaign → skip row recorded, cursor advanced, no agent_leads insert",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration], synced_campaigns: [row("1001", false)] });
    db.rpc.record_capture_scope_skips = 1;
    const r = await run(db);
    assertEquals(r.status, 200);
    assertEquals(r.probedCampaigns, ["1001"]);
    assertEquals(db.writes("agent_leads").length, 0, "probe never captures");
    const rpc = db.calls.filter((c) => c.table === "rpc:record_capture_scope_skips");
    assertEquals(rpc.length, 1);
    const rows = (rpc[0].body as { p_rows: Row[] }).p_rows;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].integration_id, INT);
    assertEquals(rows[0].team_id, TEAM);
    assertEquals(rows[0].platform, "smartlead");
    assertEquals(rows[0].campaign_external_id, "1001");
    assertEquals(rows[0].contact_key, "lead-1001@example.test");
    assertEquals(rows[0].reason, "capture_disabled");
    assertEquals(rows[0].source, "smartlead-probe");
    const cursor = db.writes("synced_campaigns").filter((w) => w.method === "PATCH");
    assertEquals(cursor.length, 1);
    assert(typeof (cursor[0].body as Row).capture_skip_probe_at === "string");
    assertEquals(r.body.skipsRecorded, 1);
  },
});

Deno.test({
  name: "poll-smartlead-inbox recapture: only the requested enabled campaign, 14-day window, no probe, no thread refresh",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integration],
      synced_campaigns: [row("1001", true), row("1002", true), row("1003", false)],
    });
    const { result, rec } = await withFakes(db, smartlead, async () => {
      const res = await handler(new Request("http://local/poll-smartlead-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
        body: JSON.stringify({ mode: "recapture", integrationId: INT, campaignIds: ["1002", "1003"], lookbackDays: 14 }),
      }));
      return { status: res.status, body: await res.json() };
    });
    assertEquals(result.status, 200);
    const statsCalls = rec.providerCalls.map((c) => new URL(c.url)).filter((u) => /lead-statistics$/.test(u.pathname));
    assert(statsCalls.length > 0 && statsCalls.every((u) => u.pathname.includes("/campaigns/1002/")),
      `only campaign 1002 swept: ${statsCalls.map((u) => u.pathname).join(",")}`);
    assert(statsCalls.every((u) => (Date.now() - Date.parse(u.searchParams.get("replied_after")!)) > 13 * 86400_000), "14-day window");
    assert(!rec.providerCalls.some((c) => /analytics-by-date/.test(c.url)), "no probe and no analytics prefilter in recapture");
    const inserts = db.writes("agent_leads").filter((w) => w.method === "POST");
    assertEquals(inserts.length, 1);
    assertEquals(String((inserts[0].body as Row).smartlead_campaign_id), "1002");
    assertEquals(result.body.skipsRecorded, 0);
  },
});
