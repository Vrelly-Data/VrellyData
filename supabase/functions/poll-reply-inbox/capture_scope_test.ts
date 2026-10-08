// Handler-level fail-closed Capture scope tests for poll-reply-inbox (REAL
// index.ts, fake PostgREST + fake Reply.io v3; synthetic data only).
//
// Proves: an integration with no enabled sequence, or whose scope lookup
// errors, captures NOTHING for the run (no agent_leads write, reason in the
// response); otherwise only threads whose sequence is capture-enabled are
// captured, and threads with no sequence id are not captured (fail closed).
//
// Warehouse (main parity): main had no capture gate on Reply.io, so every
// polled reply recorded its 'replied' inference_events row. Threads outside
// capture scope are still read and recorded warehouse-only (no agent_leads,
// no activity, no classify-reply).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-000000000101";
const INT2 = "00000000-0000-4000-8000-000000000102";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const USER2 = "00000000-0000-4000-8000-0000000000b2";
const RECENT = new Date(Date.now() - 600_000).toISOString();

const integ = (id: string, user: string, key: string): Row => ({ id, created_by: user, team_id: TEAM, api_key_encrypted: key, is_active: true, platform: "reply.io" });
const row = (id: string, enabled: boolean, integrationId = INT): Row => ({ id: `sc-${integrationId}-${id}`, integration_id: integrationId, team_id: TEAM, external_campaign_id: id, capture_enabled: enabled });

// Threads: 701 enabled seq (number id), 702 enabled seq (string id), 703
// disabled seq, 704 unknown seq, 705 no sequence at all.
const THREADS = [
  { id: 701, channel: "email", lastActivityDate: RECENT, contact: { id: 1, fullName: "Test One", email: "t1@example.test" }, sequence: { id: 13579, name: "S1" } },
  { id: 702, channel: "linkedIn", lastActivityDate: RECENT, contact: { id: 2, fullName: "Test Two", email: "t2@example.test" }, sequence: { id: "24680", name: "S2" } },
  { id: 703, channel: "email", lastActivityDate: RECENT, contact: { id: 3, fullName: "Test Three", email: "t3@example.test" }, sequence: { id: 11111, name: "S3" } },
  { id: 704, channel: "email", lastActivityDate: RECENT, contact: { id: 4, fullName: "Test Four", email: "t4@example.test" }, sequence: { id: 99999, name: "S4" } },
  { id: 705, channel: "email", lastActivityDate: RECENT, contact: { id: 5, fullName: "Test Five", email: "t5@example.test" }, sequence: null },
];

const replyApi = (_req: Request, url: URL) => {
  if (url.hostname !== "api.reply.io") return undefined;
  const m = url.pathname.match(/\/inbox\/threads\/(\d+)\/messages$/);
  if (m) {
    return json({ items: [{ date: RECENT, body: `Reply on thread ${m[1]}`, fromName: "Prospect", isOutbound: false, channel: "email" }], hasMore: false });
  }
  if (url.pathname.endsWith("/inbox/threads")) return json({ items: THREADS, hasMore: false });
  return undefined;
};

async function run(db: FakeSupabase) {
  const { result, rec } = await withFakes(db, replyApi, async () => {
    const res = await handler(new Request("http://local/poll-reply-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: "{}",
    }));
    return { status: res.status, body: await res.json() };
  });
  const threadListCalls = rec.providerCalls.filter((c) => new URL(c.url).pathname.endsWith("/inbox/threads"));
  const messageCalls = rec.providerCalls
    .map((c) => new URL(c.url).pathname.match(/\/inbox\/threads\/(\d+)\/messages$/)?.[1])
    .filter(Boolean) as string[];
  return { ...result, rec, threadListCalls, messageCalls };
}

const skipCases: Array<{ name: string; rows: Row[]; fail?: boolean; reason: string }> = [
  { name: "no synced rows", rows: [], reason: "none_enabled" },
  { name: "all sequences capture-disabled", rows: [row("13579", false), row("24680", false)], reason: "none_enabled" },
  { name: "enabled only on another integration", rows: [row("13579", true, INT2)], reason: "none_enabled" },
  { name: "lookup error", rows: [row("13579", true)], fail: true, reason: "lookup_error" },
];

for (const c of skipCases) {
  Deno.test({
    name: `poll-reply-inbox scope: ${c.name} → integration not captured (${c.reason}), no agent_leads write, every reply recorded warehouse-only`,
    ...testOpts,
    async fn() {
      const db = new FakeSupabase({ outbound_integrations: [integ(INT, USER, "k1")], agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }], synced_campaigns: c.rows });
      if (c.fail) db.fail["synced_campaigns:GET"] = "error";
      const r = await run(db);
      assertEquals(r.status, 200);
      assertEquals(db.writes("agent_leads").length, 0);
      assertEquals(db.writes("agent_activity").length, 0);
      assert(!r.rec.functionCalls.some((f) => f.path.endsWith("/classify-reply")), "no classify-reply");
      assertEquals(r.body.processed, 0);
      assertEquals(r.body.captureScope.skippedIntegrations, [{ integrationId: INT, reason: c.reason }]);
      assert(r.rec.logs.some((l) => l.includes(`skip integration ${INT} — capture scope ${c.reason}`)), "skip is logged");
      // Warehouse: all five recent replies recorded, tagged with the scope reason.
      assertEquals(r.threadListCalls.length, 1);
      assertEquals(r.body.captureScope.warehouseOnlyThreads, 5);
      assertEquals(r.body.captureScope.warehouseOnlyRecorded, 5);
      const inf = db.writes("inference_events").map((w) => w.body as Row);
      assertEquals(inf.map((e) => String(e.source_row_id).split(":")[0]).sort(), ["701", "702", "703", "704", "705"]);
      assert(inf.every((e) => e.source === "poll_reply_inbox" && e.event_type === "replied" && e.agent_config_id === "cfg-1"));
      assert(inf.every((e) => (e.metadata as Row).capture_skipped === c.reason));
    },
  });
}

Deno.test({
  name: "poll-reply-inbox scope: only capture-enabled sequence threads are processed; no-sequence threads dropped",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [row("13579", true), row("24680", true), row("11111", false)],
    });
    const r = await run(db);
    assertEquals(r.status, 200);
    assertEquals(r.body.processed, 2);
    const inserted = db.writes("agent_leads").filter((w) => w.method === "POST").map((w) => String((w.body as Row).external_id));
    assertEquals(inserted.sort(), ["701", "702"], "only enabled-sequence threads are captured");
    assertEquals(db.writes("agent_leads").length, 2, "no agent_leads write for out-of-scope threads");
    assertEquals(db.writes("agent_activity").length, 2);
    assertEquals(r.body.captureScope.threadsDroppedNoSequence, 1);
    assertEquals(r.body.captureScope.threadsDroppedNotEnabled, 2);
    assertEquals(r.body.captureScope.skippedIntegrations, []);
    // Warehouse: every reply recorded; the three out-of-scope ones tagged.
    assertEquals(r.body.captureScope.warehouseOnlyThreads, 3);
    assertEquals(r.body.captureScope.warehouseOnlyRecorded, 3);
    const inf = db.writes("inference_events").map((w) => w.body as Row);
    const byThread = new Map(inf.map((e) => [String(e.source_row_id).split(":")[0], (e.metadata as Row).capture_skipped]));
    assertEquals([...byThread.keys()].sort(), ["701", "702", "703", "704", "705"]);
    assertEquals(byThread.get("701"), undefined);
    assertEquals(byThread.get("702"), undefined);
    assertEquals(byThread.get("703"), "not_in_capture_scope");
    assertEquals(byThread.get("705"), "not_in_capture_scope");
  },
});

Deno.test({
  name: "poll-reply-inbox scope: skip is per integration (one skipped, the other still processed)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1"), integ(INT2, USER2, "k2")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }, { id: "cfg-2", user_id: USER2, is_active: true }],
      synced_campaigns: [row("13579", false, INT), row("13579", true, INT2)],
    });
    const r = await run(db);
    assertEquals(r.body.captureScope.skippedIntegrations, [{ integrationId: INT, reason: "none_enabled" }]);
    assertEquals(r.body.processed, 1);
    const inserted = db.writes("agent_leads").filter((w) => w.method === "POST").map((w) => (w.body as Row).user_id);
    assertEquals(inserted, [USER2], "only the in-scope integration captures");
    // INT's replies are warehouse-only (5), INT2's out-of-scope ones too (4).
    assertEquals(r.body.captureScope.warehouseOnlyThreads, 9);
  },
});

// ---- Capture Scope: no silent drops + recapture ----------------------------

const skipRowsOf = (db: FakeSupabase) =>
  db.calls.filter((x) => x.table === "rpc:record_capture_scope_skips").flatMap((x) => (x.body as { p_rows: Row[] }).p_rows);

Deno.test({
  name: "poll-reply-inbox skips: genuinely new replies on capture-off / unsynced sequences recorded (capture_disabled / no_synced_row); none for no-sequence or captured threads",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [{ ...row("13579", true), name: "S1" }, { ...row("24680", true), name: "S2" }, { ...row("11111", false), name: "Synced S3" }],
    });
    const r = await run(db);
    assertEquals(r.status, 200);
    const rows = skipRowsOf(db);
    const bySeq = new Map(rows.map((x) => [String(x.campaign_external_id), x]));
    assertEquals([...bySeq.keys()].sort(), ["11111", "99999"], "703 (off) and 704 (unsynced) only");
    assertEquals(bySeq.get("11111")!.reason, "capture_disabled");
    assertEquals(bySeq.get("11111")!.campaign_name, "Synced S3", "synced name preferred");
    assertEquals(bySeq.get("11111")!.contact_key, "t3@example.test");
    assertEquals(bySeq.get("11111")!.platform, "reply.io");
    assertEquals(bySeq.get("11111")!.integration_id, INT);
    assertEquals(bySeq.get("11111")!.team_id, TEAM);
    assertEquals(bySeq.get("99999")!.reason, "no_synced_row");
    assertEquals(bySeq.get("99999")!.campaign_name, "S4", "falls back to the thread's sequence name");
    assert(rows.every((x) => x.source === "poll-reply-inbox"));
    assertEquals(r.body.captureScope.skipsRecorded, 2, "reported in the run summary");
  },
});

Deno.test({
  name: "poll-reply-inbox skips: nothing enabled (none_enabled) still records every attributable reply; lookup_error records none",
  ...testOpts,
  async fn() {
    const off = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [row("13579", false), row("24680", false)],
    });
    await run(off);
    const seqs = skipRowsOf(off).map((x) => `${x.campaign_external_id}:${x.reason}`).sort();
    assertEquals(seqs, ["11111:no_synced_row", "13579:capture_disabled", "24680:capture_disabled", "99999:no_synced_row"]);

    const broken = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [row("13579", true)],
    });
    broken.fail["synced_campaigns:GET"] = "error";
    await run(broken);
    assertEquals(skipRowsOf(broken), [], "cannot tell a sequence is off when the lookup failed");
  },
});

async function runRecapture(db: FakeSupabase, body: Record<string, unknown>) {
  const { result, rec } = await withFakes(db, replyApi, async () => {
    const res = await handler(new Request("http://local/poll-reply-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  const messageCalls = rec.providerCalls
    .map((c) => new URL(c.url).pathname.match(/\/inbox\/threads\/(\d+)\/messages$/)?.[1])
    .filter(Boolean) as string[];
  return { ...result, rec, messageCalls };
}

Deno.test({
  name: "poll-reply-inbox recapture: one integration, only the requested still-enabled sequence; captured with classify path; nothing else read or recorded",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1"), integ(INT2, USER2, "k2")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }, { id: "cfg-2", user_id: USER2, is_active: true }],
      synced_campaigns: [row("13579", true), row("24680", true), row("11111", false), row("13579", true, INT2)],
    });
    // 11111 is requested but OFF: recapture must never widen capture.
    const r = await runRecapture(db, { mode: "recapture", integrationId: INT, campaignIds: ["13579", "11111"], lookbackDays: 14 });
    assertEquals(r.status, 200);
    assertEquals(r.body.recapture, { integrationId: INT, sequences: 2, lookbackDays: 14 });
    assertEquals(r.messageCalls, ["701"], "only the requested enabled sequence's thread is read");
    const inserted = db.writes("agent_leads").filter((w) => w.method === "POST").map((w) => w.body as Row);
    assertEquals(inserted.map((x) => String(x.external_id)), ["701"]);
    assertEquals(inserted[0].user_id, USER, "only the requested integration");
    assertEquals(skipRowsOf(db), [], "recapture records no skips");
    assertEquals(db.writes("inference_events").length, 1, "no warehouse writes for other threads");
  },
});

Deno.test({
  name: "poll-reply-inbox recapture: a thread whose reply is 10 days old is captured (24h window widened to the lookback)",
  ...testOpts,
  async fn() {
    const tenDays = new Date(Date.now() - 10 * 86400_000).toISOString();
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [row("13579", true)],
    });
    const oldApi = (_req: Request, url: URL) => {
      if (url.hostname !== "api.reply.io") return undefined;
      if (/\/inbox\/threads\/\d+\/messages$/.test(url.pathname)) {
        return json({ items: [{ date: tenDays, body: "Late reply", fromName: "Prospect", isOutbound: false, channel: "email" }], hasMore: false });
      }
      if (url.pathname.endsWith("/inbox/threads")) return json({ items: [{ ...THREADS[0], lastActivityDate: tenDays }], hasMore: false });
      return undefined;
    };
    const normal = await withFakes(db, oldApi, async () => {
      const res = await handler(new Request("http://local/poll-reply-inbox", { method: "POST", headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY }, body: "{}" }));
      return await res.json();
    });
    assertEquals(db.writes("agent_leads").length, 0, "a normal run ignores a 10-day-old thread (24h window)");
    assert(normal.result.processed === 0);
    const { result } = await withFakes(db, oldApi, async () => {
      const res = await handler(new Request("http://local/poll-reply-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
        body: JSON.stringify({ mode: "recapture", integrationId: INT, campaignIds: ["13579"], lookbackDays: 14 }),
      }));
      return await res.json();
    });
    assertEquals(result.processed, 1);
    const inserted = db.writes("agent_leads").filter((w) => w.method === "POST").map((w) => w.body as Row);
    assertEquals(inserted.length, 1);
    assertEquals(inserted[0].inbox_status, "pending", "surfaces like a fresh reply so it gets a draft");
  },
});

Deno.test({
  name: "poll-reply-inbox recapture: ignored without the agent key (a user JWT runs a normal poll)",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({
      outbound_integrations: [integ(INT, USER, "k1")],
      agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true }],
      synced_campaigns: [row("13579", true)],
    });
    const { result } = await withFakes(db, replyApi, async () => {
      const res = await handler(new Request("http://local/poll-reply-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": "wrong" },
        body: JSON.stringify({ mode: "recapture", integrationId: INT, campaignIds: ["13579"] }),
      }));
      return { status: res.status, body: await res.json() };
    });
    assertEquals(result.status, 401);
  },
});
