// Handler-level HeyReach drafting gate tests for heyreach-webhook: the REAL
// index.ts handler runs against a fake PostgREST (see
// _shared/testing/fake_platform.ts). Synthetic data only.
//
// classify-reply (POST /functions/v1/classify-reply, channel 'linkedin') is
// called only when ALL of these hold:
//   - the Capture Scope gate allowed the event (capture-enabled synced row);
//   - the reply surfaced and is fresh (<24h) (decision.willClassify);
//   - an active agent_config exists;
//   - HEYREACH_DRAFTING_ENABLED is exactly "true" (read per request).
// Every other combination makes zero /functions/v1/ calls. No send function is
// ever called from this handler.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeSupabase, json, loadHandler, testOpts, withFakes, type ProviderFn, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const INT = "00000000-0000-4000-8000-0000000000a1";
const TEAM = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const CAMPAIGN = 518402;
const PROFILE = "https://www.linkedin.com/in/test-prospect-0001";
const FLAG = "HEYREACH_DRAFTING_ENABLED";

const integration = (): Row => ({ id: INT, team_id: TEAM, is_active: true, created_by: USER, api_key_encrypted: "k", webhook_secret: null, platform: "heyreach" });
const campaignRow = (enabled: boolean): Row => ({
  id: `sc-${CAMPAIGN}`, integration_id: INT, team_id: TEAM, external_campaign_id: String(CAMPAIGN), capture_enabled: enabled, name: "Synced Campaign Name", source: "heyreach",
});
const AGENT_CONFIG: Row = {
  id: "00000000-0000-4000-8000-0000000000e1", user_id: USER, is_active: true, mode: "copilot",
  offer_description: "Synthetic offer", desired_action: "book a call", outcome_delivered: "x", target_icp: "y",
  sender_name: "Sender", sender_title: "Title", sender_bio: "Bio", company_name: "Example Co", company_url: "https://example.com",
  communication_style: "brief",
  // sender_linkedin, avoid_phrases, sample_message, calendar_link, pricing_summary, case_studies,
  // disqualification_criteria, objection_handling_notes: unset → defaulted in the body.
};

function payload(opts: { ts?: string; campaign?: unknown } = {}): Record<string, unknown> {
  return {
    ...(opts.campaign === undefined ? { campaign: { id: CAMPAIGN, name: "C" } } : opts.campaign === null ? {} : { campaign: opts.campaign }),
    conversation_id: "conv-test-1",
    lead: { first_name: "Test", last_name: "Prospect", profile_url: PROFILE },
    sender: { linkedInAccount: { id: 111 } },
    recent_messages: [
      { message: "Earlier outbound", creation_time: new Date(Date.now() - 3 * 86_400_000).toISOString(), is_reply: false },
      { message: "Sounds good, tell me more", creation_time: opts.ts ?? new Date(Date.now() - 5 * 60_000).toISOString(), is_reply: true },
    ],
  };
}

// GetChatroom returns 401, as it does on dev with the dummy API key.
const chatroom401: ProviderFn = (_req, url) =>
  url.hostname === "api.heyreach.io" && url.pathname.includes("/inbox/GetChatroom/") ? json({ message: "Invalid API key" }, 401) : undefined;

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

async function post(db: FakeSupabase, body: unknown, provider: ProviderFn = chatroom401) {
  const { result, rec } = await withFakes(db, provider, async () => {
    const res = await handler(new Request(`http://local/heyreach-webhook/${INT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec, leadWrites: db.writes("agent_leads") };
}

function baseDb(extra: Record<string, Row[]> = {}, enabled = true): FakeSupabase {
  return new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [campaignRow(enabled)], agent_configs: [AGENT_CONFIG], ...extra });
}

function assertNoSend(r: Awaited<ReturnType<typeof post>>) {
  assert(!r.rec.functionCalls.some((c) => /send-/.test(c.path)), "no send-* function call");
}

Deno.test({
  name: "heyreach-webhook drafting: flag unset + fresh reply + enabled campaign → lead captured, NO classify-reply call, reason logged",
  ...testOpts,
  async fn() {
    const db = baseDb();
    const r = await withDraftingFlag(undefined, () => post(db, payload()));
    assertEquals(r.status, 200);
    assertEquals(r.body, { success: true });
    assertEquals(r.leadWrites.length, 1, "lead inserted");
    assertEquals((r.leadWrites[0].body as Row).inbox_status, "pending");
    assertEquals(r.rec.functionCalls, []);
    assert(r.rec.logs.some((l) => l.includes("willClassify=true") && l.includes("drafting=off")), r.rec.logs.join("\n"));
    assert(r.rec.logs.some((l) => l.includes("not classified") && l.includes("HEYREACH_DRAFTING_ENABLED is not 'true'")), r.rec.logs.join("\n"));
    assertEquals(r.rec.providerCalls.filter((c) => c.url.includes("/inbox/GetChatroom/")).length, 1);
    assertEquals(db.writes("inference_events").length, 1, "warehouse 'replied' event still recorded");
  },
});

for (const value of ["", "TRUE", "1", " true", "false"]) {
  Deno.test({
    name: `heyreach-webhook drafting: flag=${JSON.stringify(value)} is OFF → no classify-reply call`,
    ...testOpts,
    async fn() {
      const r = await withDraftingFlag(value, () => post(baseDb(), payload()));
      assertEquals(r.status, 200);
      assertEquals(r.leadWrites.length, 1);
      assertEquals(r.rec.functionCalls, []);
    },
  });
}

Deno.test({
  name: "heyreach-webhook drafting: flag 'true' + fresh reply + enabled campaign → exactly one classify-reply call, channel linkedin, restored body shape",
  ...testOpts,
  async fn() {
    const db = baseDb();
    const r = await withDraftingFlag("true", () => post(db, payload()));
    assertEquals(r.status, 200);
    assertEquals(r.body, { success: true });
    assertEquals(r.leadWrites.length, 1);
    const savedId = (db.tables.agent_leads[0] as Row).id;
    assertEquals(r.rec.functionCalls.length, 1);
    const call = r.rec.functionCalls[0];
    assertEquals(call.path, "/functions/v1/classify-reply");
    const b = call.body as Row;
    assertEquals(b.channel, "linkedin");
    assertEquals(b.lead_id, savedId);
    assertEquals(b.user_id, USER);
    assertEquals(b.reply_text, "Sounds good, tell me more");
    // GetChatroom 401 → the partial payload thread is used.
    assertEquals((b.thread_history as Row[]).map((e) => e.role), ["sender", "prospect"]);
    const ctx = b.agent_context as Row;
    assertEquals(ctx.offer_description, "Synthetic offer");
    assertEquals(ctx.sender_name, "Sender");
    assertEquals(ctx.avoid_phrases, []);
    assertEquals(ctx.calendar_link, "");
    assertEquals(ctx.objection_handling_notes, "");
    assertEquals(Object.keys(ctx).sort(), [
      "avoid_phrases", "calendar_link", "case_studies", "communication_style", "company_name", "company_url",
      "desired_action", "disqualification_criteria", "objection_handling_notes", "offer_description", "outcome_delivered",
      "pricing_summary", "sample_message", "sender_bio", "sender_linkedin", "sender_name", "sender_title", "target_icp",
    ], "all 18 agent_context fields of the pre-kill-switch body");
    assertEquals(Object.keys(b).sort(), ["agent_context", "channel", "lead_id", "reply_text", "thread_history", "user_id"]);
    assertNoSend(r);
    assertEquals(db.writes("inference_events").length, 1, "warehouse event still recorded");
    assert(!r.rec.logs.some((l) => l.includes("(HeyReach drafting off)")));
  },
});

Deno.test({
  name: "heyreach-webhook drafting: flag 'true' + GetChatroom 200 → classify-reply gets the merged canonical thread",
  ...testOpts,
  async fn() {
    const earlier = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const provider: ProviderFn = (_req, url) =>
      url.pathname.includes("/inbox/GetChatroom/")
        ? json({ messages: [{ sender: "ME", body: "Canonical first outbound", createdAt: earlier }] })
        : undefined;
    const r = await withDraftingFlag("true", () => post(baseDb(), payload(), provider));
    assertEquals(r.rec.functionCalls.length, 1);
    const thread = (r.rec.functionCalls[0].body as Row).thread_history as Row[];
    // Canonical first, partial entries appended, sorted chronologically.
    assertEquals(thread.map((e) => e.content), ["Earlier outbound", "Canonical first outbound", "Sounds good, tell me more"]);
  },
});

Deno.test({
  name: "heyreach-webhook drafting: flag 'true' + stale (>=24h) reply → surfaced, NO classify-reply call, stale logged",
  ...testOpts,
  async fn() {
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    const r = await withDraftingFlag("true", () => post(baseDb(), payload({ ts: old })));
    assertEquals(r.status, 200);
    assertEquals(r.leadWrites.length, 1);
    assertEquals(r.rec.functionCalls, []);
    assert(r.rec.logs.some((l) => l.includes("stale prospect message (>24h)")), r.rec.logs.join("\n"));
  },
});

Deno.test({
  name: "heyreach-webhook drafting: flag 'true' + re-delivery of an already-surfaced reply (not surfaced) → NO classify-reply call",
  ...testOpts,
  async fn() {
    const ts = new Date(Date.now() - 5 * 60_000).toISOString();
    const db = baseDb({
      agent_leads: [{ id: "lead-1", user_id: USER, linkedin_url: PROFILE, disposition_tag: null, last_surfaced_reply_at: ts, inbox_status: "draft_ready" }],
    });
    const r = await withDraftingFlag("true", () => post(db, payload({ ts })));
    assertEquals(r.status, 200);
    assertEquals(r.rec.functionCalls, []);
    assert(r.rec.logs.some((l) => l.includes("reply recorded without surfacing")), r.rec.logs.join("\n"));
  },
});

Deno.test({
  name: "heyreach-webhook drafting: flag 'true' + no active agent_config → NO classify-reply call",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [campaignRow(true)] });
    const r = await withDraftingFlag("true", () => post(db, payload()));
    assertEquals(r.status, 200);
    assertEquals(r.leadWrites.length, 1);
    assertEquals(r.rec.functionCalls, []);
  },
});

const skipCases: Array<{ name: string; db: () => FakeSupabase; campaign?: unknown; reason: string }> = [
  { name: "capture disabled", db: () => baseDb({}, false), reason: "capture_disabled" },
  { name: "no synced row", db: () => new FakeSupabase({ outbound_integrations: [integration()], synced_campaigns: [], agent_configs: [AGENT_CONFIG] }), reason: "no_synced_row" },
  { name: "no campaign id", db: () => baseDb(), campaign: null, reason: "no_campaign_id" },
  {
    name: "lookup error",
    db: () => {
      const d = baseDb();
      d.fail["synced_campaigns:GET"] = "error";
      return d;
    },
    reason: "lookup_error",
  },
];
for (const c of skipCases) {
  Deno.test({
    name: `heyreach-webhook drafting: flag 'true' + fresh reply but capture skipped (${c.reason}) → no agent_leads write, NO classify-reply call`,
    ...testOpts,
    async fn() {
      const r = await withDraftingFlag("true", () => post(c.db(), payload(c.campaign === undefined ? {} : { campaign: c.campaign })));
      assertEquals(r.status, 200);
      assertEquals(r.body.skipped, c.reason);
      assertEquals(r.leadWrites.length, 0);
      assertEquals(r.rec.functionCalls, [], "skipped replies never reach classify-reply");
      assertEquals(r.rec.providerCalls, [], "no GetChatroom on a skip");
    },
  });
}

Deno.test({
  name: "heyreach-webhook drafting: flag read per request — 'true' classifies, then unset on the same handler instance stops it (instant off)",
  ...testOpts,
  async fn() {
    const on = await withDraftingFlag("true", () => post(baseDb(), payload()));
    assertEquals(on.rec.functionCalls.map((c) => c.path), ["/functions/v1/classify-reply"]);
    const off = await withDraftingFlag(undefined, () => post(baseDb(), payload()));
    assertEquals(off.rec.functionCalls, []);
  },
});
