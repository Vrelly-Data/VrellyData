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
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPA = "http://supabase.test";
const AGENT_KEY = "test-agent-key";
const INTEGRATION_ID = "00000000-0000-0000-0000-0000000000a1";
const USER_ID = "00000000-0000-0000-0000-0000000000b1";
const BASELINE = "2026-09-20T00:00:00.000Z";
const CONVO_TS = "2026-09-20T06:00:00.000Z"; // newer than baseline-1h → must be processed

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
};

type Recorded = {
  leadWrites: string[];
  states: Record<string, unknown>[];
  chatroomCalls: number;
  order: string[];
  convOffsets: number[];
  functionCalls: string[];
  logs: string[];
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
      return json({ ok: true });
    }
    if (url.origin === SUPA && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.replace("/rest/v1/", "");
      const rows = (r: unknown[]) => wantsObject ? (r.length ? json(r[0]) : json({ code: "PGRST116", message: "no rows" }, 406)) : json(r);
      if (table === "outbound_integrations" && method === "GET") {
        return rows([{ id: INTEGRATION_ID, created_by: USER_ID, api_key_encrypted: "dummy", heyreach_poll_state: sc.state ?? { version: 1, baselineStartedAt: BASELINE, walk: null } }]);
      }
      if (table === "outbound_integrations" && method === "PATCH") {
        const body = JSON.parse(await req.text());
        rec.states.push(structuredClone(body.heyreach_poll_state));
        return new Response(null, { status: 204 });
      }
      if (table === "agent_configs") return rows([{ id: "cfg-1", user_id: USER_ID, is_active: true }]);
      if (table === "synced_campaigns") return rows([]);
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
        const offset = Number(JSON.parse(await req.text())?.offset ?? 0);
        rec.convOffsets.push(offset);
        if (sc.walkPagesFail && offset !== 0) return json({ error: "walk page unavailable" }, 500);
        return json({
          totalCount: 1,
          items: [{
            id: "conv-1",
            linkedInAccountId: 111,
            lastMessageAt: CONVO_TS,
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
        return json({ messages: [{ sender: "CORRESPONDENT", body: "a brand new inbound reply", createdAt: CONVO_TS }] });
      }
    }
    throw new Error(`unexpected fetch in test: ${method} ${req.url}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

async function run(sc: Scenario) {
  const rec: Recorded = { leadWrites: [], states: [], chatroomCalls: 0, order: [], convOffsets: [], functionCalls: [], logs: [] };
  const restore = installFetch(sc, rec);
  const realLog = console.log;
  console.log = (...args: unknown[]) => { rec.logs.push(args.map(String).join(" ")); };
  try {
    const res = await handler!(new Request("http://local/poll-heyreach-inbox", {
      method: "POST",
      headers: { "x-agent-key": AGENT_KEY, "Content-Type": "application/json" },
      body: "{}",
    }));
    const body = await res.json();
    return { status: res.status, body, rec, finalState: rec.states[rec.states.length - 1] as { baselineStartedAt: string | null; walk: unknown; lastTick?: { headScan?: unknown } } };
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
const deepState = () => ({ version: 1, baselineStartedAt: BASELINE, walk: structuredClone(DEEP_WALK) });

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
  name: "(H4c) index head scan positive control: GetChatroom 200 → write after chatroom, 0 head-scan failures, walk state unchanged, 0 function calls (kill switch)",
  ...opts,
  async fn() {
    const r = await run({ chatroom: "ok", existingLead: true, state: deepState(), walkPagesFail: true });
    assertEquals(r.status, 200);
    assertEquals(r.rec.order, ["chatroom", "lead_PATCH"]);
    const hs = r.body.perIntegration[0].headScan;
    assertEquals([hs.items, hs.failures, hs.stopReason], [1, 0, "complete"]);
    assertEquals(r.body.headScan.items, 1);
    assertEquals(r.finalState.walk, DEEP_WALK);
    // The surfaced reply reached the kill-switch branch, and nothing was invoked.
    assert(r.rec.logs.some((l) => l.includes("HeyReach drafting disabled (kill switch)")), "kill-switch branch not reached");
    assertEquals(r.rec.functionCalls, []);
  },
});
