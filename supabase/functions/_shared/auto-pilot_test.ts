// Auto Pilot: routing table, safety gates, outcome handling.
// Pure functions directly; runAutoPilot against a fake PostgREST with an
// injected fetch (no real sender is ever called).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alreadyReplied,
  answeredAlready,
  buildSendBody,
  decideAutoSend,
  interpretSendResult,
  routeAutoSend,
  runAutoPilot,
  utcDayStart,
  type AutoSendInput,
} from "./auto-pilot.ts";
import { FakeSupabase, testOpts, withFakes, noProviders, setTestEnv, type Row } from "./testing/fake_platform.ts";

// Variable specifier, as in fake_platform.loadHandler: keeps `deno test` from
// type-checking supabase-js against the repo's Vite tsconfig.
const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
// deno-lint-ignore no-explicit-any
const { createClient } = (await import(SUPABASE_JS)) as any;
setTestEnv();

// ---------------------------------------------------------------------------
// 1. Routing table — source × channel
// ---------------------------------------------------------------------------
Deno.test("routing table: source decides, channel must be deliverable by that sender", () => {
  const table: Array<[string | null, string | null, string | null]> = [
    ["reply_io", "email", "send-agent-reply"],
    ["reply_io", "linkedin", "send-agent-reply"], // THE BUG: this used to go to send-heyreach-message
    ["smartlead", "email", "send-smartlead-email"],
    ["smartlead", "linkedin", null],
    ["heyreach", "linkedin", "send-heyreach-message"],
    ["heyreach", "email", null],
    ["phoneburner", "email", null],
    [null, "email", null],
    [null, "linkedin", null],
    ["reply_io", null, null],
    ["REPLY_IO", " LinkedIn ", "send-agent-reply"],
  ];
  for (const [source, channel, want] of table) {
    assertEquals(routeAutoSend(source, channel), want, `${source} × ${channel}`);
  }
});

Deno.test("each sender gets its own request shape, always with auto: true", () => {
  const a = { userId: "u", leadId: "l", message: "hi", intent: "interested" };
  assertEquals(buildSendBody("send-agent-reply", a), { user_id: "u", leadId: "l", draftResponse: "hi", intent: "interested", auto: true });
  assertEquals(buildSendBody("send-smartlead-email", a), { user_id: "u", leadId: "l", message: "hi", auto: true });
  assertEquals(buildSendBody("send-heyreach-message", a), { user_id: "u", lead_id: "l", message: "hi", auto: true });
});

// ---------------------------------------------------------------------------
// 2. Safety gates
// ---------------------------------------------------------------------------
const NOW = Date.parse("2026-10-09T15:00:00Z");
const base: AutoSendInput = {
  intent: "interested", draft: "Thanks — Tuesday works.", source: "reply_io", channel: "linkedin",
  dispositionTag: null, lastReplyAt: "2026-10-09T14:00:00Z",
  replyThread: [
    { role: "sender", timestamp: "2026-10-08T10:00:00Z" },
    { role: "prospect", timestamp: "2026-10-09T14:00:00Z" },
  ],
  sentToday: 0, dailyCap: 25, now: NOW,
};

Deno.test("gates: a clean Reply.io LinkedIn reply is sent via send-agent-reply", () => {
  assertEquals(decideAutoSend(base), { action: "send", target: "send-agent-reply" });
});

Deno.test("gates: only interested / needs_more_info / not_interested / referral are auto-sent", () => {
  for (const intent of ["interested", "needs_more_info", "not_interested", "referral"]) {
    assertEquals(decideAutoSend({ ...base, intent }).action, "send", intent);
  }
  for (const intent of ["unknown", "positive", "", "meeting_booked"]) {
    assertEquals(decideAutoSend({ ...base, intent }), { action: "hold", reason: "intent_not_auto_sendable" }, intent);
  }
});

Deno.test("gates: OOO and bounce are suppressed (marked handled, nothing sent)", () => {
  assertEquals(decideAutoSend({ ...base, intent: "out_of_office" }), { action: "suppress" });
  assertEquals(decideAutoSend({ ...base, intent: "bounce", draft: null }), { action: "suppress" });
});

Deno.test("gates: never opted_out; never without a draft", () => {
  assertEquals(decideAutoSend({ ...base, dispositionTag: "opted_out" }), { action: "hold", reason: "opted_out" });
  assertEquals(decideAutoSend({ ...base, draft: "   " }), { action: "hold", reason: "no_draft" });
  assertEquals(decideAutoSend({ ...base, draft: null }), { action: "hold", reason: "no_draft" });
});

Deno.test("gates: replies older than 24h, or with no reply time, are held", () => {
  assertEquals(decideAutoSend({ ...base, lastReplyAt: "2026-10-08T14:59:00Z" }), { action: "hold", reason: "reply_too_old" });
  assertEquals(decideAutoSend({ ...base, lastReplyAt: "2026-10-08T15:01:00Z" }).action, "send");
  assertEquals(decideAutoSend({ ...base, lastReplyAt: null }), { action: "hold", reason: "reply_time_unknown" });
});

Deno.test("gates: a reply we already answered is held", () => {
  const answered = [...(base.replyThread as Row[]), { role: "sender", timestamp: "2026-10-09T14:30:00Z" }];
  assertEquals(decideAutoSend({ ...base, replyThread: answered }), { action: "hold", reason: "already_replied" });
});

Deno.test("gates: inbox_status 'sent' (Reply.io after a send) is treated exactly like 'replied'", () => {
  for (const inboxStatus of ["sent", "replied", "SENT"]) {
    assertEquals(decideAutoSend({ ...base, inboxStatus }), { action: "hold", reason: "already_replied" }, inboxStatus);
  }
  for (const inboxStatus of ["draft_ready", "pending", null, undefined]) {
    assertEquals(decideAutoSend({ ...base, inboxStatus }), { action: "send", target: "send-agent-reply" }, String(inboxStatus));
  }
});

Deno.test("gates: a send recorded at/after the reply holds even when the thread lost our entry", () => {
  // base.replyThread ends with the prospect — the poller rewrote it without our sender entry.
  assertEquals(decideAutoSend({ ...base, lastSentAt: "2026-10-09T14:05:00Z" }), { action: "hold", reason: "already_replied" });
  assertEquals(decideAutoSend({ ...base, lastSentAt: "2026-10-09T14:00:00Z" }), { action: "hold", reason: "already_replied" });
  // A send before this reply answered an earlier message, not this one.
  assertEquals(decideAutoSend({ ...base, lastSentAt: "2026-10-08T10:00:00Z" }), { action: "send", target: "send-agent-reply" });
  assertEquals(answeredAlready({ replyThread: [], lastSentAt: "bad", lastReplyAt: "2026-10-09T14:00:00Z" }), false);
});

Deno.test("gates: unknown source and undeliverable channel are held", () => {
  assertEquals(decideAutoSend({ ...base, source: null }), { action: "hold", reason: "unknown_source" });
  assertEquals(decideAutoSend({ ...base, source: "smartlead", channel: "linkedin" }), { action: "hold", reason: "channel_not_supported" });
});

Deno.test("gates: the daily cap holds at, not after, the limit; cap 0 sends nothing", () => {
  assertEquals(decideAutoSend({ ...base, sentToday: 24 }).action, "send");
  assertEquals(decideAutoSend({ ...base, sentToday: 25 }), { action: "hold", reason: "daily_cap" });
  assertEquals(decideAutoSend({ ...base, dailyCap: 0 }), { action: "hold", reason: "daily_cap" });
});

Deno.test("alreadyReplied: latest of ours vs latest of theirs; ignores undated entries", () => {
  assertEquals(alreadyReplied([]), false);
  assertEquals(alreadyReplied([{ role: "prospect", timestamp: "2026-10-09T10:00:00Z" }]), false);
  assertEquals(alreadyReplied([{ role: "prospect", timestamp: "2026-10-09T10:00:00Z" }, { role: "sender", timestamp: "2026-10-09T09:00:00Z" }]), false);
  assertEquals(alreadyReplied([{ role: "prospect", timestamp: "2026-10-09T10:00:00Z" }, { role: "sender", timestamp: "2026-10-09T11:00:00Z" }]), true);
  assertEquals(alreadyReplied([{ role: "prospect", timestamp: "2026-10-09T10:00:00Z" }, { role: "sender" }]), false);
  assertEquals(alreadyReplied("not an array"), false);
});

Deno.test("send result: success only on 2xx AND success === true", () => {
  assertEquals(interpretSendResult(200, { success: true }), { ok: true });
  assertEquals(interpretSendResult(200, { success: false, handled: true, code: "contact_opted_out", message: "opted out" }),
    { ok: false, error: "opted out", code: "contact_opted_out" });
  assertEquals(interpretSendResult(502, { error: "Reply.io 404" }), { ok: false, error: "Reply.io 404", code: null });
  assertEquals(interpretSendResult(400, { error: "Lead not found or missing HeyReach conversation" }).ok, false);
  assertEquals(interpretSendResult(0, null), { ok: false, error: "HTTP 0", code: null });
});

// ---------------------------------------------------------------------------
// 3. runAutoPilot end to end (fake DB, injected fetch)
// ---------------------------------------------------------------------------
const USER = "00000000-0000-4000-8000-0000000000a1";
const LEAD = "lead-1";
const recent = new Date(Date.now() - 600_000).toISOString();

function db(lead: Row, activity: Row[] = [], cap = 25) {
  return new FakeSupabase({
    agent_leads: [{
      id: LEAD, user_id: USER, source: "reply_io", channel: "linkedin", disposition_tag: null,
      last_reply_at: recent, reply_thread: [{ role: "prospect", timestamp: recent }], full_name: "Pat",
      inbox_status: "draft_ready", draft_response: "Happy to — Tuesday?", auto_handled: false, ...lead,
    }],
    agent_configs: [{ id: "cfg-1", user_id: USER, is_active: true, auto_send_daily_cap: cap }],
    agent_activity: activity,
  });
}

function sender(status: number, body: unknown, calls: Array<{ url: string; body: Row }>) {
  return (async (input: Request | URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

async function run(d: FakeSupabase, fetchFn: typeof fetch, intent = "interested") {
  const { result } = await withFakes(d, noProviders, () =>
    runAutoPilot({
      supabase: createClient("http://supabase.test", "svc"),
      supabaseUrl: "http://supabase.test", agentKey: "k", userId: USER, leadId: LEAD,
      intent, draft: "Happy to — Tuesday?", fetchFn,
    }));
  return result;
}

Deno.test({
  name: "runAutoPilot: Reply.io LinkedIn lead → send-agent-reply is called (not send-heyreach-message)",
  ...testOpts,
  async fn() {
    const d = db({});
    const calls: Array<{ url: string; body: Row }> = [];
    const out = await run(d, sender(200, { success: true }, calls));
    assertEquals(out, { outcome: "sent", target: "send-agent-reply" });
    assertEquals(calls.length, 1);
    assert(calls[0].url.endsWith("/functions/v1/send-agent-reply"));
    assertEquals(calls[0].body, { user_id: USER, leadId: LEAD, draftResponse: "Happy to — Tuesday?", intent: "interested", auto: true });
    assertEquals((d.tables.agent_activity as Row[]).filter((a) => a.activity_type === "auto_send_failed").length, 0);
  },
});

Deno.test({
  name: "runAutoPilot: a failed send writes auto_send_failed with the sender's error and leaves the lead draft_ready",
  ...testOpts,
  async fn() {
    const d = db({});
    const calls: Array<{ url: string; body: Row }> = [];
    const out = await run(d, sender(400, { error: "This reply has no Reply.io thread linked yet", code: "thread_unresolved" }, calls));
    assertEquals(out.outcome, "failed");
    const failed = (d.tables.agent_activity as Row[]).filter((a) => a.activity_type === "auto_send_failed");
    assertEquals(failed.length, 1);
    assertEquals((failed[0].metadata as Row).error, "This reply has no Reply.io thread linked yet");
    assertEquals((failed[0].metadata as Row).code, "thread_unresolved");
    assertEquals((failed[0].metadata as Row).target, "send-agent-reply");
    const lead = (d.tables.agent_leads as Row[])[0];
    assertEquals([lead.inbox_status, lead.auto_handled, lead.draft_response], ["draft_ready", false, "Happy to — Tuesday?"]);
  },
});

Deno.test({
  name: "runAutoPilot: a sender that throws (network/timeout) is a recorded failure, not a crash",
  ...testOpts,
  async fn() {
    const d = db({});
    const boom = (() => Promise.reject(new Error("timed out"))) as unknown as typeof fetch;
    const out = await run(d, boom);
    assertEquals(out.outcome, "failed");
    const failed = (d.tables.agent_activity as Row[]).filter((a) => a.activity_type === "auto_send_failed");
    assert(String((failed[0].metadata as Row).error).includes("timed out"));
  },
});

Deno.test({
  name: "runAutoPilot: over the daily cap → held as draft_ready, nothing sent, reason recorded",
  ...testOpts,
  async fn() {
    const today = new Date().toISOString();
    const sent = Array.from({ length: 3 }, (_, i) => ({
      id: `a${i}`, user_id: USER, activity_type: "message_sent", metadata: { sent_by: "auto" }, created_at: today,
    }));
    const d = db({}, sent, 3);
    const calls: Array<{ url: string; body: Row }> = [];
    const out = await run(d, sender(200, { success: true }, calls));
    assertEquals(out, { outcome: "held", reason: "daily_cap" });
    assertEquals(calls.length, 0, "no sender called");
    const held = (d.tables.agent_activity as Row[]).find((a) => a.activity_type === "auto_send_held")!;
    assertEquals((held.metadata as Row).reason, "daily_cap");
    assertEquals((held.metadata as Row).daily_cap, 3);
    assertEquals((d.tables.agent_leads as Row[])[0].inbox_status, "draft_ready");
  },
});

Deno.test({
  name: "runAutoPilot: yesterday's auto-sends do not count toward today's cap",
  ...testOpts,
  async fn() {
    const yesterday = new Date(Date.parse(utcDayStart()) - 3_600_000).toISOString();
    const d = db({}, [{ id: "a0", user_id: USER, activity_type: "message_sent", metadata: { sent_by: "auto" }, created_at: yesterday }], 1);
    const calls: Array<{ url: string; body: Row }> = [];
    assertEquals((await run(d, sender(200, { success: true }, calls))).outcome, "sent");
  },
});

Deno.test({
  name: "runAutoPilot: HeyReach → send-heyreach-message; Smartlead → send-smartlead-email; unknown source → held, no call",
  ...testOpts,
  async fn() {
    for (const [source, channel, fn] of [["heyreach", "linkedin", "send-heyreach-message"], ["smartlead", "email", "send-smartlead-email"]] as const) {
      const calls: Array<{ url: string; body: Row }> = [];
      const out = await run(db({ source, channel }), sender(200, { success: true }, calls));
      assertEquals(out, { outcome: "sent", target: fn });
      assert(calls[0].url.endsWith(`/functions/v1/${fn}`));
    }
    const calls: Array<{ url: string; body: Row }> = [];
    const d = db({ source: null });
    assertEquals(await run(d, sender(200, { success: true }, calls)), { outcome: "held", reason: "unknown_source" });
    assertEquals(calls.length, 0);
  },
});

Deno.test({
  name: "runAutoPilot: OOO is suppressed (handled, no send); opted_out and stale replies are held",
  ...testOpts,
  async fn() {
    const calls: Array<{ url: string; body: Row }> = [];
    const d = db({});
    assertEquals(await run(d, sender(200, { success: true }, calls), "out_of_office"), { outcome: "suppressed" });
    const lead = (d.tables.agent_leads as Row[])[0];
    assertEquals([lead.inbox_status, lead.auto_handled], ["replied", true]);
    assertEquals(await run(db({ disposition_tag: "opted_out" }), sender(200, { success: true }, calls)), { outcome: "held", reason: "opted_out" });
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    assertEquals(await run(db({ last_reply_at: old }), sender(200, { success: true }, calls)), { outcome: "held", reason: "reply_too_old" });
    assertEquals(calls.length, 0);
  },
});

Deno.test({
  name: "runAutoPilot: lead already 'sent' (Reply.io) or 'replied' → held already_replied, no sender called",
  ...testOpts,
  async fn() {
    for (const inbox_status of ["sent", "replied"]) {
      const calls: Array<{ url: string; body: Row }> = [];
      const d = db({ inbox_status });
      assertEquals(await run(d, sender(200, { success: true }, calls)), { outcome: "held", reason: "already_replied" }, inbox_status);
      assertEquals(calls.length, 0);
      const held = (d.tables.agent_activity as Row[]).find((a) => a.activity_type === "auto_send_held")!;
      assertEquals((held.metadata as Row).reason, "already_replied");
    }
  },
});

Deno.test({
  name: "runAutoPilot: a message_sent activity after the reply holds, even with a thread that lost our entry",
  ...testOpts,
  async fn() {
    const after = new Date(Date.parse(recent) + 60_000).toISOString();
    const calls: Array<{ url: string; body: Row }> = [];
    const d = db({}, [{ id: "s1", user_id: USER, lead_id: LEAD, activity_type: "message_sent", metadata: { sent_by: "user" }, created_at: after }]);
    assertEquals(await run(d, sender(200, { success: true }, calls)), { outcome: "held", reason: "already_replied" });
    assertEquals(calls.length, 0);
    // An older send on the same lead (answering an earlier message) does not block.
    const before = new Date(Date.parse(recent) - 86_400_000).toISOString();
    const d2 = db({}, [{ id: "s0", user_id: USER, lead_id: LEAD, activity_type: "message_sent", metadata: { sent_by: "user" }, created_at: before }]);
    assertEquals((await run(d2, sender(200, { success: true }, calls))).outcome, "sent");
  },
});
