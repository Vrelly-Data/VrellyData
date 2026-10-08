// Index-side checks for poll-heyreach-inbox: drives the REAL index.ts handler
// (Deno.serve is stubbed to capture it) against a fake PostgREST + fake HeyReach
// via a global fetch stub, and spies on every agent_leads write.
//
// Proves: a GetChatroom failure (non-2xx or network error) and an agent_leads
// write error each throw out of processItem, so the walker counts a failure and
// the baseline does NOT advance, and a GetChatroom failure happens before any
// agent_leads write. A positive control proves the spy does see writes.
//
// Head-scan cases (H4): with a walk in progress deep in the list, the handler
// re-processes page 1 first. A head-scan GetChatroom or agent_leads failure is
// counted on perIntegration[].headScan, writes nothing for that item, and leaves
// the persisted walk state exactly as it was. No /functions/v1/ call is made.
//
// Drafting gate (DR-idx): classify-reply is called (fire-and-forget, channel
// 'linkedin') only for a fresh (<24h) surfaced reply of a capture-enabled
// campaign AND only when HEYREACH_DRAFTING_ENABLED is exactly 'true'. Flag
// unset/other values, stale replies and capture-scope skips never call it.
//
// Also: Capture Scope keying (S-idx), the fail-closed Capture Scope skip
// (S-idx fail-closed: lookup error, timeout, no rows, none enabled → no
// HeyReach call, no lead write, no state write), per-item DB timeouts with a
// hanging fake DB (D-idx), and walk vs head-scan counters (N-idx).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_PAGER_OPTIONS } from "./paging.ts";

const SUPA = "http://supabase.test";
const AGENT_KEY = "test-agent-key";
const INTEGRATION_ID = "00000000-0000-0000-0000-0000000000a1";
const USER_ID = "00000000-0000-0000-0000-0000000000b1";
const BASELINE = "2026-09-20T00:00:00.000Z";
const CONVO_TS = "2026-09-20T06:00:00.000Z"; // newer than baseline-1h → must be processed
// synced_campaigns holds one capture-enabled campaign by default; state written
// by this version records that scope. (There is no unfiltered mode: with no
// enabled campaign the integration is skipped, fail closed.)
const DEFAULT_CAMPAIGNS = [{ external_campaign_id: "518402", capture_enabled: true }];
const SCOPED = { campaignIds: [518402] };

Deno.env.set("SUPABASE_URL", SUPA);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
Deno.env.set("AGENT_API_KEY", AGENT_KEY);

type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: Handler) => {
  handler = h;
  return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: "x", port: 0, transport: "tcp" } };
};
// Variable specifier on purpose: `deno test` in this repo picks up the Vite
// tsconfig (lib "node") and would try to type-check supabase-js against
// @types/node. index.ts itself is covered by `deno check`.
const indexModule = "./index.ts";
await import(indexModule);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = realServe;
assert(handler, "index.ts did not register a Deno.serve handler");

type Scenario = {
  chatroom: "500" | "throw" | "ok";
  existingLead: boolean;
  leadWriteError?: boolean;
  // Persisted poll state to start from (default: baseline known, no walk in progress).
  state?: Record<string, unknown>;
  // When set, GetConversationsV2 at any offset other than 0 returns HTTP 500.
  walkPagesFail?: boolean;
  convoTs?: string;
  // createdAt of the GetChatroom message (default CONVO_TS, which is stale).
  chatroomTs?: string;
  // synced_campaigns rows (default DEFAULT_CAMPAIGNS); "error" makes the lookup
  // fail (HTTP 500). The fake honours integration_id / capture_enabled filters.
  campaigns?: { external_campaign_id: string; capture_enabled: boolean; integration_id?: string }[] | "error";
  // A PostgREST call that never answers (it only rejects if its request is
  // aborted, like real fetch): the agent_leads lookup GET or write, or the
  // synced_campaigns scope lookup.
  hang?: "lookup" | "write" | "scope";
};

type Recorded = {
  leadWrites: string[];
  states: Record<string, unknown>[];
  chatroomCalls: number;
  order: string[];
  convOffsets: number[];
  convCampaignIds: unknown[];
  functionCalls: string[];
  // deno-lint-ignore no-explicit-any
  functionBodies: any[];
  functionAgentKeyOk: boolean[];
  scopeQueries: string[];
  logs: string[];
  activityWrites: number;
  // record_capture_scope_skips payloads (Capture Scope skip rows).
  // deno-lint-ignore no-explicit-any
  skipRpcRows: any[];
  // synced_campaigns PATCH bodies (the probe's rotation cursor).
  // deno-lint-ignore no-explicit-any
  campaignPatches: any[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installFetch(sc: Scenario, rec: Recorded) {
  const lead = {
    id: "lead-1",
    linkedin_url: "https://www.linkedin.com/in/test-prospect",
    disposition_tag: null,
    last_surfaced_reply_at: "2026-09-01T00:00:00.000Z",
    last_reply_at: "2026-09-01T00:00:00.000Z",
    last_reply_text: "older stored text",
    inbox_status: "mirrored",
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const wantsObject = (req.headers.get("Accept") ?? "").includes("vnd.pgrst.object");

    if (url.origin === SUPA && url.pathname.startsWith("/functions/v1/")) {
      rec.functionCalls.push(url.pathname);
      rec.functionAgentKeyOk.push(req.headers.get("x-agent-key") === AGENT_KEY);
      rec.functionBodies.push(JSON.parse(await req.text()));
      return json({ ok: true });
    }
    if (url.origin === SUPA && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.replace("/rest/v1/", "");
      if (table === "rpc/record_capture_scope_skips") {
        const b = JSON.parse(await req.text());
        rec.skipRpcRows.push(...(b?.p_rows ?? []));
        return json(Array.isArray(b?.p_rows) ? b.p_rows.length : 0);
      }
      if (table === "synced_campaigns" && method === "PATCH") {
        rec.campaignPatches.push({ query: url.search, body: JSON.parse(await req.text()) });
        return new Response(null, { status: 204 });
      }
      if (table === "synced_campaigns") rec.scopeQueries.push(url.search);
      const hangs = (table === "agent_leads" && ((sc.hang === "lookup" && method === "GET") || (sc.hang === "write" && method !== "GET"))) ||
        (table === "synced_campaigns" && sc.hang === "scope");
      if (hangs) {
        if (method !== "GET") { rec.leadWrites.push(method); rec.order.push(`lead_${method}`); }
        return new Promise<Response>((_, reject) => {
          req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      const rows = (r: unknown[]) => wantsObject ? (r.length ? json(r[0]) : json({ code: "PGRST116", message: "no rows" }, 406)) : json(r);
      if (table === "outbound_integrations" && method === "GET") {
        return rows([{ id: INTEGRATION_ID, created_by: USER_ID, api_key_encrypted: "dummy", heyreach_poll_state: sc.state ?? { version: 1, baselineStartedAt: BASELINE, walk: null, scope: SCOPED } }]);
      }
      if (table === "outbound_integrations" && method === "PATCH") {
        const body = JSON.parse(await req.text());
        rec.states.push(structuredClone(body.heyreach_poll_state));
        return new Response(null, { status: 204 });
      }
      if (table === "agent_configs") return rows([{ id: "cfg-1", user_id: USER_ID, is_active: true }]);
      if (table === "synced_campaigns") {
        if (sc.campaigns === "error") return json({ code: "XX000", message: "simulated scope lookup error", details: null, hint: null }, 500);
        const intEq = url.searchParams.get("integration_id");
        const capEq = url.searchParams.get("capture_enabled");
        const all = (sc.campaigns ?? DEFAULT_CAMPAIGNS).map((c, i) => ({ id: `sc-${i}`, integration_id: INTEGRATION_ID, ...c }));
        return rows(all.filter((c) =>
          (!intEq || intEq === `eq.${c.integration_id}`) && (!capEq || capEq === `eq.${c.capture_enabled}`)
        ));
      }
      if (table === "agent_activity") { rec.activityWrites++; return rows([]); }
      if (table === "agent_leads" && method === "GET") return rows(sc.existingLead ? [lead] : []);
      if (table === "agent_leads") {
        rec.leadWrites.push(method);
        rec.order.push(`lead_${method}`);
        if (sc.leadWriteError) return json({ code: "XX000", message: "simulated db error", details: null, hint: null }, 500);
        return rows([{ ...lead, id: sc.existingLead ? lead.id : "lead-new" }]);
      }
      return rows([]);
    }
    if (url.hostname === "api.heyreach.io") {
      if (url.pathname.endsWith("/inbox/GetConversationsV2")) {
        const reqBody = JSON.parse(await req.text());
        const offset = Number(reqBody?.offset ?? 0);
        rec.convOffsets.push(offset);
        rec.convCampaignIds.push(reqBody?.filters?.campaignIds);
        if (sc.walkPagesFail && offset !== 0) return json({ error: "walk page unavailable" }, 500);
        return json({
          totalCount: 1,
          items: [{
            id: "conv-1",
            linkedInAccountId: 111,
            lastMessageAt: sc.convoTs ?? CONVO_TS,
            lastMessageText: "a brand new inbound reply",
            lastMessageSender: "CORRESPONDENT",
            correspondentProfile: { firstName: "Test", lastName: "Prospect", profileUrl: "https://www.linkedin.com/in/test-prospect" },
          }],
        });
      }
      if (url.pathname.includes("/inbox/GetChatroom/")) {
        rec.chatroomCalls++;
        rec.order.push("chatroom");
        if (sc.chatroom === "throw") throw new TypeError("network down");
        if (sc.chatroom === "500") return json({ error: "boom" }, 500);
        return json({ messages: [{ sender: "CORRESPONDENT", body: "a brand new inbound reply", createdAt: sc.chatroomTs ?? CONVO_TS }] });
      }
    }
    throw new Error(`unexpected fetch in test: ${method} ${req.url}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

async function run(sc: Scenario, reqBody: Record<string, unknown> = {}) {
  const rec: Recorded = { leadWrites: [], states: [], chatroomCalls: 0, order: [], convOffsets: [], convCampaignIds: [], functionCalls: [], functionBodies: [], functionAgentKeyOk: [], scopeQueries: [], logs: [], activityWrites: 0, skipRpcRows: [], campaignPatches: [] };
  const restore = installFetch(sc, rec);
  const realLog = console.log;
  console.log = (...args: unknown[]) => { rec.logs.push(args.map(String).join(" ")); };
  try {
    const res = await handler!(new Request("http://local/poll-heyreach-inbox", {
      method: "POST",
      headers: { "x-agent-key": AGENT_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    }));
    const body = await res.json();
    return { status: res.status, body, rec, finalState: rec.states[rec.states.length - 1] as { baselineStartedAt: string | null; walk: unknown; scope?: unknown; lastTick?: { headScan?: unknown; fetchError?: string } } };
  } finally {
    console.log = realLog;
    restore();
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

for (const chatroom of ["500", "throw"] as const) {
  for (const existingLead of [true, false]) {
    Deno.test({
      name: `(9) index: GetChatroom ${chatroom} (${existingLead ? "existing" : "new"} lead) → 0 agent_leads writes, failure counted, baseline unchanged`,
      ...opts,
      async fn() {
        const r = await run({ chatroom, existingLead });
        assertEquals(r.status, 200);
        assertEquals(r.rec.chatroomCalls, 1);
        assertEquals(r.rec.leadWrites, []);
        assertEquals(r.body.perIntegration[0].failures, 1);
        assertEquals(r.body.perIntegration[0].conversationsProcessed, 1);
        assertEquals(r.finalState.baselineStartedAt, BASELINE);
      },
    });
  }
}

Deno.test({
  name: "(9c) index positive control: GetChatroom 200 → agent_leads write observed after chatroom, 0 failures, baseline advances",
  ...opts,
  async fn() {
    const r = await run({ chatroom: "ok", existingLead: true });
    assertEquals(r.status, 200);
    assertEquals(r.rec.leadWrites, ["PATCH"]);
    assertEquals(r.rec.order, ["chatroom", "lead_PATCH"]);
    assertEquals(r.body.perIntegration[0].failures, 0);
    assert(r.finalState.baselineStartedAt !== BASELINE, "baseline should advance on a clean completed walk");
  },
});

for (const existingLead of [true, false]) {
  Deno.test({
    name: `(9d) index: agent_leads ${existingLead ? "UPDATE" : "INSERT"} error → failure counted, baseline unchanged`,
    ...opts,
    async fn() {
      const r = await run({ chatroom: "ok", existingLead, leadWriteError: true });
      assertEquals(r.status, 200);
      assertEquals(r.rec.leadWrites.length, 1);
      assertEquals(r.body.perIntegration[0].failures, 1);
      assertEquals(r.finalState.baselineStartedAt, BASELINE);
    },
  });
}

// ---- Head scan through the real handler (H4) --------------------------------
// Walk in progress deep in the list (cursor at 900); page 1 holds conv-1. Walk
// pages (offset != 0) fail so the head scan is the only item work this tick.
const DEEP_WALK = {
  startedAt: "2026-09-19T00:00:00.000Z",
  cutoff: "2026-09-19T23:00:00.000Z",
  offset: 900,
  lastTs: "2026-09-18T00:00:00.000Z",
  lastId: "conv-deep-899",
  failures: 0,
};
const deepState = () => ({ version: 1, baselineStartedAt: BASELINE, walk: structuredClone(DEEP_WALK), scope: SCOPED });

for (const chatroom of ["500", "throw"] as const) {
  Deno.test({
    name: `(H4) index head scan: GetChatroom ${chatroom} → 0 agent_leads writes, head-scan failure counted, walk state unchanged, 0 function calls`,
    ...opts,
    async fn() {
      const r = await run({ chatroom, existingLead: true, state: deepState(), walkPagesFail: true });
      assertEquals(r.status, 200);
      assertEquals(r.rec.convOffsets[0], 0, "head scan fetches page 1 first");
      assert(r.rec.convOffsets.slice(1).every((o) => o > 0), "walk resumes deep, not at page 1");
      assertEquals(r.rec.chatroomCalls, 1);
      assertEquals(r.rec.leadWrites, []);
      assertEquals(r.rec.functionCalls, []);
      const pi = r.body.perIntegration[0];
      assertEquals(pi.headScan.items, 1);
      assertEquals(pi.headScan.failures, 1);
      assertEquals(pi.headScan.stopReason, "complete");
      assertEquals(pi.failures, 0, "walk-level failures untouched");
      assertEquals(pi.stopReason, "fetch_error");
      assertEquals(r.body.headScan.failures, 1);
      assertEquals(r.finalState.walk, DEEP_WALK);
      assertEquals(r.finalState.baselineStartedAt, BASELINE);
      assertEquals(r.finalState.lastTick?.headScan, pi.headScan);
    },
  });
}

Deno.test({
  name: "(H4) index head scan: agent_leads write error → head-scan failure counted, walk state unchanged",
  ...opts,
  async fn() {
    const r = await run({ chatroom: "ok", existingLead: true, leadWriteError: true, state: deepState(), walkPagesFail: true });
    assertEquals(r.status, 200);
    assertEquals(r.rec.leadWrites.length, 1);
    assertEquals(r.body.perIntegration[0].headScan.failures, 1);
    assertEquals(r.body.perIntegration[0].failures, 0);
    assertEquals(r.finalState.walk, DEEP_WALK);
    assertEquals(r.finalState.baselineStartedAt, BASELINE);
    assertEquals(r.rec.functionCalls, []);
  },
});

Deno.test({
  name: "(H4c) index head scan positive control: GetChatroom 200 → write after chatroom, 0 head-scan failures, walk state unchanged, 0 function calls (stale reply)",
  ...opts,
  async fn() {
    const r = await run({ chatroom: "ok", existingLead: true, state: deepState(), walkPagesFail: true });
    assertEquals(r.status, 200);
    assertEquals(r.rec.order, ["chatroom", "lead_PATCH"]);
    const hs = r.body.perIntegration[0].headScan;
    assertEquals([hs.items, hs.failures, hs.stopReason], [1, 0, "complete"]);
    assertEquals(r.body.headScan.items, 1);
    assertEquals(r.finalState.walk, DEEP_WALK);
    // The reply surfaced but is stale (>24h): no classify, even with the flag
    // unset there is no "drafting off" line because staleness decides first.
    assert(r.rec.logs.some((l) => l.includes("gate: stale=true") && l.includes("willClassify=false")), r.rec.logs.join("\n"));
    assert(!r.rec.logs.some((l) => l.includes("(HeyReach drafting off)")));
    assertEquals(r.rec.functionCalls, []);
  },
});

// ---- Capture Scope keying through the real handler (S-idx) ------------------
// Conversation older than the stored baseline - 1h: with the stored scope it is
// caught_up and skipped; when a campaign is enabled (scope changed) the baseline
// is reset and it is walked.
const OLD_TS = "2026-09-10T00:00:00.000Z";

Deno.test({
  name: "(S-idx) index: capture scope changed (campaign enabled) → baseline and walk reset, older conversation walked, new scope stored, change logged",
  ...opts,
  async fn() {
    const r = await run({
      chatroom: "ok",
      existingLead: true,
      convoTs: OLD_TS,
      campaigns: [{ external_campaign_id: "518402", capture_enabled: true }, { external_campaign_id: "508828", capture_enabled: true }],
      state: { version: 1, baselineStartedAt: BASELINE, walk: null, scope: { campaignIds: [508828] } },
    });
    assertEquals(r.status, 200);
    assertEquals(r.rec.convCampaignIds[0], [518402, 508828]);
    assertEquals(r.rec.chatroomCalls, 1, "the older conversation is processed after the reset");
    assertEquals(r.rec.leadWrites, ["PATCH"]);
    assertEquals(r.finalState.scope, { campaignIds: [508828, 518402] });
    assert(r.finalState.baselineStartedAt !== BASELINE, "a fresh walk completed and set a new baseline");
    assert(r.rec.logs.some((l) => l.includes("capture scope changed") && l.includes("campaigns[508828] -> campaigns[508828,518402]")), r.rec.logs.join("\n"));
  },
});

Deno.test({
  name: "(S-idx control) index: same capture scope (different row order) → no reset, older conversation caught_up without processing",
  ...opts,
  async fn() {
    const r = await run({
      chatroom: "ok",
      existingLead: true,
      convoTs: OLD_TS,
      campaigns: [{ external_campaign_id: "518402", capture_enabled: true }, { external_campaign_id: "508828", capture_enabled: true }, { external_campaign_id: "1", capture_enabled: false }],
      state: { version: 1, baselineStartedAt: BASELINE, walk: null, scope: { unfiltered: false, campaignIds: [508828, 518402] } },
    });
    assertEquals(r.body.perIntegration[0].stopReason, "caught_up");
    assertEquals(r.rec.chatroomCalls, 0);
    assertEquals(r.rec.leadWrites, []);
    // Scope as stored by the previous version (explicit unfiltered:false) is kept as is.
    assertEquals(r.finalState.scope, { unfiltered: false, campaignIds: [508828, 518402] });
    assert(!r.rec.logs.some((l) => l.includes("capture scope changed")));
  },
});

// ---- Fail-closed Capture Scope skip (S-idx fail-closed) ---------------------
// Any scope outcome other than "at least one enabled integer campaign id" skips
// CAPTURE for the integration this tick: no capture GetConversationsV2 (no
// walk, no head scan), no GetChatroom, no agent_leads write, no poll-state
// write, and the reason is logged and returned in skipped.captureScope. The
// deep walk state proves the head scan would otherwise have run.
//
// The only HeyReach calls allowed are the Capture Scope PROBE's: offset 0,
// exactly one campaign id, and that id is a capture-OFF campaign of this
// integration (it never reads an enabled campaign, never polls unfiltered).
// None on lookup_error.
function assertSkippedClosed(r: Awaited<ReturnType<typeof run>>, reason: string, captureOffIds: number[] = []) {
  assertEquals(r.status, 200);
  for (const ids of r.rec.convCampaignIds) {
    assert(Array.isArray(ids) && ids.length === 1 && captureOffIds.includes(ids[0] as number),
      `only probe calls (one capture-off campaign id): ${JSON.stringify(r.rec.convCampaignIds)}`);
  }
  assert(r.rec.convOffsets.every((o) => o === 0), "probe reads page 1 only");
  if (reason === "lookup_error") assertEquals(r.rec.convOffsets, [], "no HeyReach call on lookup_error");
  assertEquals(r.rec.chatroomCalls, 0);
  assertEquals(r.rec.leadWrites, []);
  assertEquals(r.rec.activityWrites, 0);
  assertEquals(r.rec.states, [], "no poll-state write");
  assertEquals(r.rec.functionCalls, []);
  assertEquals(r.body.perIntegration, []);
  assertEquals(r.body.skipped.captureScope, [{ integrationId: INTEGRATION_ID, reason }]);
  assert(
    r.rec.logs.some((l) => l.includes(`skip integration ${INTEGRATION_ID}`) && l.includes(`capture scope ${reason}`)),
    r.rec.logs.join("\n"),
  );
  assert(r.rec.logs.some((l) => l.includes("intSkipCaptureScope=1")), "summary line counts the skip");
}

for (const [label, campaigns, reason] of [
  ["scope lookup error", "error", "lookup_error"],
  ["no synced rows", [], "none_enabled"],
  ["every campaign capture-disabled", [{ external_campaign_id: "518402", capture_enabled: false }, { external_campaign_id: "508828", capture_enabled: false }], "none_enabled"],
  ["enabled rows with no integer id", [{ external_campaign_id: "abc", capture_enabled: true }, { external_campaign_id: "0", capture_enabled: true }], "none_enabled"],
  ["enabled rows only under another integration", [{ external_campaign_id: "518402", capture_enabled: true, integration_id: "00000000-0000-0000-0000-0000000000ff" }], "none_enabled"],
] as const) {
  Deno.test({
    name: `(S-idx fail-closed) index: ${label} → integration skipped (${reason}): no HeyReach call, no lead write, no state write, reason logged and returned`,
    ...opts,
    async fn() {
      const r = await run({
        chatroom: "ok",
        existingLead: true,
        campaigns: campaigns as Scenario["campaigns"],
        state: { ...deepState(), scope: { campaignIds: [508828] } },
      });
      const off = (campaigns === "error" ? [] : (campaigns as unknown as { external_campaign_id: string; capture_enabled: boolean; integration_id?: string }[]))
        .filter((c) => !c.capture_enabled && !c.integration_id).map((c) => Number(c.external_campaign_id));
      assertSkippedClosed(r, reason, off);
      const scopeQs = r.rec.scopeQueries.filter((qs) => new URLSearchParams(qs).get("capture_enabled") === "eq.true");
      assertEquals(scopeQs.length, 1);
      const q = new URLSearchParams(scopeQs[0]);
      assertEquals(q.get("integration_id"), `eq.${INTEGRATION_ID}`, "scope keyed by integration_id");
      assertEquals(q.get("capture_enabled"), "eq.true");
    },
  });
}

Deno.test({
  name: "(S-idx fail-closed) index: scope lookup hangs → aborted at DB_TIMEOUT_MS, integration skipped (lookup_error), nothing polled or written",
  ...opts,
  async fn() {
    const t0 = Date.now();
    let guard: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      run({ chatroom: "ok", existingLead: true, hang: "scope", state: deepState() }),
      new Promise<never>((_, reject) => { guard = setTimeout(() => reject(new Error("scope lookup not bounded")), 9_000); }),
    ]).finally(() => clearTimeout(guard));
    assertSkippedClosed(r, "lookup_error");
    assert(Date.now() - t0 < 8_000, "bounded by DB_TIMEOUT_MS (5s)");
  },
});

Deno.test({
  name: "(S-idx legacy) index: stored { unfiltered: true } scope + enabled campaigns → reset once, scoped request, older conversation walked, scope stored; next tick keeps it",
  ...opts,
  async fn() {
    const campaigns = [{ external_campaign_id: "518402", capture_enabled: true }, { external_campaign_id: "508828", capture_enabled: false }];
    const r = await run({
      chatroom: "ok",
      existingLead: true,
      convoTs: OLD_TS,
      campaigns,
      state: { version: 1, baselineStartedAt: BASELINE, walk: structuredClone(DEEP_WALK), scope: { unfiltered: true, campaignIds: [] } },
    });
    assertEquals(r.status, 200);
    // Capture calls carry only the enabled campaign; the only other call is the
    // probe of the capture-off one (508828).
    const captureCalls = r.rec.convCampaignIds.filter((c) => JSON.stringify(c) !== "[508828]");
    assert(captureCalls.length > 0 && captureCalls.every((c) => JSON.stringify(c) === "[518402]"), JSON.stringify(r.rec.convCampaignIds));
    assertEquals(r.rec.convOffsets[0], 0, "walk restarts from the top after the reset");
    assertEquals(r.rec.chatroomCalls, 1, "the older conversation is processed after the reset");
    assertEquals(r.finalState.scope, { campaignIds: [518402] });
    assert(r.rec.logs.some((l) => l.includes("capture scope changed") && l.includes("unfiltered (legacy) -> campaigns[518402]")), r.rec.logs.join("\n"));
    assertEquals(r.body.skipped.captureScope, []);

    // Second tick from the state the first one stored: same scope, no reset.
    const r2 = await run({ chatroom: "ok", existingLead: true, convoTs: OLD_TS, campaigns, state: structuredClone(r.finalState) as Record<string, unknown> });
    assert(!r2.rec.logs.some((l) => l.includes("capture scope changed")));
    assertEquals(r2.body.perIntegration[0].stopReason, "caught_up");
    assertEquals(r2.rec.chatroomCalls, 0);
    assertEquals(r2.finalState.scope, { campaignIds: [518402] });
  },
});

// ---- Per-item DB timeout with a hanging fake DB (D-idx) ---------------------
// The per-item deadline is DEFAULT_PAGER_OPTIONS.itemFetchTimeoutMs (8s in
// production); shortened here so the test is fast. index.ts reads the same object.
async function withItemTimeout<T>(ms: number, f: () => Promise<T>): Promise<T> {
  const prev = DEFAULT_PAGER_OPTIONS.itemFetchTimeoutMs;
  DEFAULT_PAGER_OPTIONS.itemFetchTimeoutMs = ms;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      f(),
      new Promise<never>((_, reject) => { guard = setTimeout(() => reject(new Error("handler hung: DB call not bounded")), 5_000); }),
    ]);
  } finally {
    clearTimeout(guard);
    DEFAULT_PAGER_OPTIONS.itemFetchTimeoutMs = prev;
  }
}

Deno.test({
  name: "(D-idx write) index: agent_leads UPDATE hangs → aborted at the item deadline, failure counted, nothing more written, baseline unchanged",
  ...opts,
  async fn() {
    const t0 = Date.now();
    const r = await withItemTimeout(300, () => run({ chatroom: "ok", existingLead: true, hang: "write" }));
    assertEquals(r.status, 200);
    assertEquals(r.rec.order, ["chatroom", "lead_PATCH"]);
    assertEquals(r.rec.activityWrites, 0);
    assertEquals(r.body.perIntegration[0].failures, 1);
    assertEquals(r.finalState.baselineStartedAt, BASELINE);
    assert(Date.now() - t0 < 4_000, "bounded by the item deadline");
  },
});

Deno.test({
  name: "(D-idx lookup) index: lead lookup hangs (helper ignores abort) → item fails at the deadline, no chatroom call, 0 writes, baseline unchanged",
  ...opts,
  async fn() {
    const r = await withItemTimeout(300, () => run({ chatroom: "ok", existingLead: false, hang: "lookup" }));
    assertEquals(r.status, 200);
    assertEquals(r.rec.chatroomCalls, 0);
    assertEquals(r.rec.leadWrites, []);
    assertEquals(r.rec.activityWrites, 0);
    assertEquals(r.body.perIntegration[0].failures, 1);
    assertEquals(r.finalState.baselineStartedAt, BASELINE);
  },
});

// ---- Walk vs head-scan counters (N-idx) --------------------------------------
Deno.test({
  name: "(N-idx) index: page-1 work done by the head scan is reported under headScan.counts, not added to top-level polled/seen",
  ...opts,
  async fn() {
    // Walk resumes deep and its page also holds conv-1 (the fake returns it at every offset).
    const r = await run({ chatroom: "ok", existingLead: true, state: deepState() });
    assertEquals(r.status, 200);
    assertEquals(r.rec.chatroomCalls, 2, "processed once by the head scan and once by the walk");
    assertEquals([r.body.seen, r.body.polled], [1, 1], "walk only");
    assertEquals(r.body.headScan.counts.seen, 1);
    assertEquals(r.body.headScan.counts.polled, 1);
    assertEquals(r.body.headScan.items, 1);
    assert(r.rec.logs.some((l) => l.includes("Done. polled=1") && l.includes("| headScan seen=1 polled=1")), r.rec.logs.join("\n"));
  },
});

// ---- Drafting gate through the real handler (DR-idx) ------------------------
// Fresh = the newest prospect message (GetChatroom createdAt) is minutes old.
const FLAG = "HEYREACH_DRAFTING_ENABLED";
async function withDraftingFlag<T>(value: string | undefined, f: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get(FLAG);
  if (value === undefined) Deno.env.delete(FLAG);
  else Deno.env.set(FLAG, value);
  try {
    return await f();
  } finally {
    if (prev === undefined) Deno.env.delete(FLAG);
    else Deno.env.set(FLAG, prev);
  }
}
const freshTs = () => new Date(Date.now() - 5 * 60_000).toISOString();
const freshScenario = (extra: Partial<Scenario> = {}): Scenario => {
  const ts = freshTs();
  return { chatroom: "ok", existingLead: true, convoTs: ts, chatroomTs: ts, ...extra };
};

Deno.test({
  name: "(DR-idx off) index: flag unset + fresh surfaced reply (enabled campaign) → lead written, NO classify-reply call, reason logged",
  ...opts,
  async fn() {
    const r = await withDraftingFlag(undefined, () => run(freshScenario()));
    assertEquals(r.status, 200);
    assertEquals(r.rec.leadWrites, ["PATCH"], "reply still captured and surfaced");
    assertEquals(r.rec.functionCalls, []);
    assert(r.rec.logs.some((l) => l.includes("gate: stale=false") && l.includes("willClassify=true") && l.includes("drafting=off")), r.rec.logs.join("\n"));
    assert(
      r.rec.logs.some((l) => l.includes("fresh surfaced reply for lead lead-1 not classified") && l.includes("HEYREACH_DRAFTING_ENABLED is not 'true'")),
      r.rec.logs.join("\n"),
    );
  },
});

for (const value of ["", "TRUE", "True", "1", "yes", " true", "false"]) {
  Deno.test({
    name: `(DR-idx off) index: flag=${JSON.stringify(value)} is OFF → no classify-reply call`,
    ...opts,
    async fn() {
      const r = await withDraftingFlag(value, () => run(freshScenario()));
      assertEquals(r.rec.leadWrites, ["PATCH"]);
      assertEquals(r.rec.functionCalls, []);
      assert(r.rec.logs.some((l) => l.includes("(HeyReach drafting off)")));
    },
  });
}

for (const existingLead of [true, false]) {
  Deno.test({
    name: `(DR-idx on) index: flag 'true' + fresh surfaced reply (${existingLead ? "existing" : "new"} lead, enabled campaign) → exactly one classify-reply call with channel linkedin`,
    ...opts,
    async fn() {
      const r = await withDraftingFlag("true", () => run(freshScenario({ existingLead })));
      assertEquals(r.status, 200);
      assertEquals(r.rec.leadWrites, [existingLead ? "PATCH" : "POST"]);
      assertEquals(r.rec.convCampaignIds[0], [518402], "request scoped to the enabled campaign");
      assertEquals(r.rec.functionCalls, ["/functions/v1/classify-reply"]);
      assertEquals(r.rec.functionAgentKeyOk, [true], "service auth header set");
      const b = r.rec.functionBodies[0];
      assertEquals(b.channel, "linkedin");
      assertEquals(b.lead_id, existingLead ? "lead-1" : "lead-new");
      assertEquals(b.user_id, USER_ID);
      assertEquals(b.reply_text, "a brand new inbound reply");
      assertEquals(b.thread_history.length, 1);
      assertEquals(b.thread_history[0].role, "prospect");
      assertEquals(typeof b.agent_context, "object");
      // fireClassifyReply's exact body shape (shared with the Reply.io paths).
      assertEquals(Object.keys(b).sort(), ["agent_context", "channel", "lead_id", "reply_text", "thread_history", "user_id"]);
      assert(!r.rec.logs.some((l) => l.includes("(HeyReach drafting off)")));
    },
  });
}

Deno.test({
  name: "(DR-idx on) index: flag 'true' + stale (>=24h) surfaced reply → no classify-reply call",
  ...opts,
  async fn() {
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    const r = await withDraftingFlag("true", () => run({ chatroom: "ok", existingLead: true, convoTs: old, chatroomTs: old }));
    assertEquals(r.status, 200);
    assertEquals(r.rec.leadWrites, ["PATCH"], "stale reply is still surfaced/recorded");
    assertEquals(r.rec.functionCalls, []);
    assert(r.rec.logs.some((l) => l.includes("gate: stale=true") && l.includes("willClassify=false") && l.includes("drafting=on")), r.rec.logs.join("\n"));
  },
});

for (const [label, campaigns, reason] of [
  ["every campaign capture-disabled", [{ external_campaign_id: "518402", capture_enabled: false }], "none_enabled"],
  ["no synced rows", [], "none_enabled"],
  ["scope lookup error", "error", "lookup_error"],
  ["enabled row only under another integration", [{ external_campaign_id: "518402", capture_enabled: true, integration_id: "00000000-0000-0000-0000-0000000000ff" }], "none_enabled"],
] as const) {
  Deno.test({
    name: `(DR-idx on) index: flag 'true' + fresh reply but capture scope skipped (${label}) → no HeyReach call, no lead write, no classify-reply call`,
    ...opts,
    async fn() {
      const r = await withDraftingFlag("true", () => run(freshScenario({ campaigns: campaigns as Scenario["campaigns"] })));
      const off = (campaigns === "error" ? [] : (campaigns as unknown as { external_campaign_id: string; capture_enabled: boolean; integration_id?: string }[]))
        .filter((c) => !c.capture_enabled && !c.integration_id).map((c) => Number(c.external_campaign_id));
      assertSkippedClosed(r, reason, off);
      assertEquals(r.rec.functionBodies, []);
    },
  });
}

Deno.test({
  name: "(DR-idx toggle) index: flag read per request — 'true' classifies, then unset on the same handler instance stops it (instant off)",
  ...opts,
  async fn() {
    const on = await withDraftingFlag("true", () => run(freshScenario()));
    assertEquals(on.rec.functionCalls, ["/functions/v1/classify-reply"]);
    const off = await withDraftingFlag(undefined, () => run(freshScenario()));
    assertEquals(off.rec.functionCalls, []);
    assert(off.rec.logs.some((l) => l.includes("(HeyReach drafting off)")));
  },
});


// ---- Capture Scope probe + recapture (CS-idx) -------------------------------

Deno.test({
  name: "(CS-idx probe) nothing enabled + fresh reply on a capture-off campaign → one probe call for it, skip row recorded, cursor advanced, nothing captured",
  ...opts,
  async fn() {
    const fresh = new Date(Date.now() - 60 * 60_000).toISOString();
    const r = await run({
      chatroom: "ok",
      existingLead: false,
      convoTs: fresh,
      campaigns: [{ external_campaign_id: "518402", capture_enabled: false }],
    });
    assertSkippedClosed(r, "none_enabled", [518402]);
    assertEquals(r.rec.convCampaignIds, [[518402]], "exactly one probe call");
    assertEquals(r.rec.skipRpcRows.length, 1);
    const row = r.rec.skipRpcRows[0];
    assertEquals(row.integration_id, INTEGRATION_ID);
    assertEquals(row.platform, "heyreach");
    assertEquals(row.campaign_external_id, "518402");
    assertEquals(row.contact_key, "linkedin.com/in/test-prospect");
    assertEquals(row.reason, "capture_disabled");
    assertEquals(row.source, "heyreach-probe");
    assertEquals(r.rec.campaignPatches.length, 1, "rotation cursor written");
    assert(typeof r.rec.campaignPatches[0].body.capture_skip_probe_at === "string");
    assertEquals(r.body.skipped.captureScopeProbe, { campaigns: 1, skipsRecorded: 1 });
  },
});

Deno.test({
  name: "(CS-idx probe) reply older than 14 days on a capture-off campaign → probed but no skip row",
  ...opts,
  async fn() {
    const old = new Date(Date.now() - 20 * 86400_000).toISOString();
    const r = await run({
      chatroom: "ok",
      existingLead: false,
      convoTs: old,
      campaigns: [{ external_campaign_id: "518402", capture_enabled: false }],
    });
    assertEquals(r.rec.convCampaignIds, [[518402]]);
    assertEquals(r.rec.skipRpcRows, []);
  },
});

Deno.test({
  name: "(CS-idx recapture) mode recapture → only the requested enabled campaign, conversation captured, NO poll-state write, no probe",
  ...opts,
  async fn() {
    const fresh = new Date(Date.now() - 2 * 86400_000).toISOString();
    const r = await run(
      {
        chatroom: "ok",
        existingLead: true,
        convoTs: fresh,
        chatroomTs: fresh,
        campaigns: [{ external_campaign_id: "518402", capture_enabled: true }, { external_campaign_id: "508828", capture_enabled: false }],
      },
      { mode: "recapture", integrationId: INTEGRATION_ID, campaignIds: ["518402", "508828"], lookbackDays: 14 },
    );
    assertEquals(r.status, 200);
    assert(r.rec.convCampaignIds.length > 0 && r.rec.convCampaignIds.every((c) => JSON.stringify(c) === "[518402]"),
      `recapture never reads the capture-off campaign and runs no probe: ${JSON.stringify(r.rec.convCampaignIds)}`);
    assertEquals(r.rec.chatroomCalls, 1, "conversation processed by the normal per-item capture");
    assertEquals(r.rec.leadWrites, ["PATCH"]);
    assertEquals(r.rec.states, [], "recapture writes no walk/baseline state");
    assertEquals(r.rec.skipRpcRows, []);
  },
});

Deno.test({
  name: "(CS-idx recapture) requested campaign not enabled → nothing read, nothing written",
  ...opts,
  async fn() {
    const r = await run(
      { chatroom: "ok", existingLead: true, campaigns: [{ external_campaign_id: "518402", capture_enabled: false }] },
      { mode: "recapture", integrationId: INTEGRATION_ID, campaignIds: ["518402"] },
    );
    assertEquals(r.status, 200);
    assertEquals(r.rec.convCampaignIds, [], "no capture call and no probe in recapture mode");
    assertEquals(r.rec.leadWrites, []);
    assertEquals(r.rec.states, []);
  },
});
