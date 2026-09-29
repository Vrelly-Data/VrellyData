import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleClassifyReply } from "./index.ts";

type LoggedCall = {
  url: string;
  method: string;
  bodyText: string | null;
  headers: Record<string, string>;
};

function makeFetchStub(scenario: {
  supabaseUrl: string;
  leadSource: "heyreach" | "smartlead" | "reply_io" | null;
  agentMode?: "auto" | "copilot";
  classificationIntent?: string;
  generationAutoSend?: boolean;
  call1Fail?: boolean;
}) {
  const logs: LoggedCall[] = [];
  const SUPA = new URL(scenario.supabaseUrl);
  const supaOrigin = `${SUPA.protocol}//${SUPA.host}`;

  globalThis.fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
    const headersIn = (init?.headers || (typeof input !== "string" && !(input instanceof URL) ? input.headers : {})) as HeadersInit;
    const headers: Record<string, string> = {};
    (headersIn instanceof Headers ? Array.from(headersIn.entries()) : Object.entries(headersIn || {})).forEach(([k, v]) => {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v);
    });
    const bodyText = init?.body ? (typeof init.body === "string" ? init.body : (init.body as any)) : null;
    logs.push({ url, method, bodyText, headers });

    // Anthropic stub: two calls, classify then generate
    if (url.startsWith("https://api.anthropic.com/v1/messages")) {
      const body = JSON.parse(bodyText || "{}");
      const sys = body.system as string;
      const isCall1 = sys?.includes("Your job is to read an inbound prospect reply and classify it");
      const isCall2 = sys?.includes("Generate the reply accordingly");
      if (isCall1 && scenario.call1Fail) {
        return new Response("upstream error", { status: 500 });
      }
      const content = isCall1
        ? JSON.stringify({
            intent: scenario.classificationIntent ?? "interested",
            intent_confidence: 0.92,
            is_objection: false,
            prospect_read: { seniority: "ic", buying_role: "end_user", matched_persona: null, suggested_angle: "" },
          })
        : JSON.stringify({
            suggested_response: "Thanks for the note — here’s a clear next step.",
            reasoning: "Best next step",
            should_auto_send: scenario.generationAutoSend ?? true,
            next_pipeline_stage: "in_progress",
          });
      // Return Deno-style Anthropic message response
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: content }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Supabase REST stubs
    if (url.startsWith(`${supaOrigin}/rest/v1/`)) {
      const path = url.replace(`${supaOrigin}/rest/v1/`, "");
      // agent_configs: return mode
      if (path.startsWith("agent_configs")) {
        const mode = scenario.agentMode ?? "auto";
        return new Response(JSON.stringify([{ agent_knowledge: "", mode }]), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      // agent_leads early 'opted_out' check
      if (path.startsWith("agent_leads") && path.includes("select=disposition_tag")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      // agent_leads context fetch (with 'source')
      if (path.startsWith("agent_leads") && path.includes("select=") && path.includes("source")) {
        const row = {
          full_name: "Pat Prospect",
          job_title: "IC",
          company: "Acme",
          linkedin_url: "https://www.linkedin.com/in/pat",
          email: "pat@example.com",
          last_campaign_name: null,
          campaign_external_id: null,
          disposition_tag: null,
          reply_thread: [],
          source: scenario.leadSource,
        };
        return new Response(JSON.stringify([row]), { status: 200, headers: { "content-type": "application/json" } });
      }
      // Generic OK for all inserts/updates/upserts (agent_leads, agent_activity, draft_audit, inference_events, people)
      if (["POST", "PATCH"].includes(method)) {
        return new Response(JSON.stringify([]), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Edge function send call (heyreach / smartlead / reply)
    if (url.includes("/functions/v1/")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Fallback
    return new Response("ok", { status: 200 });
  };

  return { logs };
}

function decodeBody(text: string | null): any {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function findLog(logs: LoggedCall[], matcher: (l: LoggedCall) => boolean): LoggedCall[] {
  return logs.filter(matcher);
}

function hasPostTo(logs: LoggedCall[], table: string): boolean {
  return findLog(logs, (l) => l.method === "POST" && l.url.includes(`/rest/v1/${table}`)).length > 0;
}

function findAgentLeadsPatch(logs: LoggedCall[]): LoggedCall[] {
  return findLog(logs, (l) => l.method === "PATCH" && l.url.includes("/rest/v1/agent_leads"));
}

function hasSendHeyreach(logs: LoggedCall[]): boolean {
  return findLog(logs, (l) => l.url.includes("/functions/v1/send-heyreach-message")).length > 0;
}

function sendCalls(logs: LoggedCall[]): LoggedCall[] {
  return findLog(logs, (l) => l.url.includes("/functions/v1/"));
}

// Every agent_leads PATCH body (not just the first) must be free of draft fields.
function assertNoDraftInAnyLeadPatch(logs: LoggedCall[]) {
  const patches = findAgentLeadsPatch(logs);
  assert(patches.length >= 1, "expected the classification PATCH to agent_leads");
  for (const p of patches) {
    const b = decodeBody(p.bodyText) ?? {};
    assert(!("draft_response" in b) || b.draft_response === null, `draft_response leaked: ${p.bodyText}`);
    assert(b.inbox_status !== "draft_ready", `draft_ready leaked: ${p.bodyText}`);
  }
}

function assertDraftInLeadPatch(logs: LoggedCall[]) {
  const withDraft = findAgentLeadsPatch(logs).map((p) => decodeBody(p.bodyText) ?? {}).filter((b) =>
    typeof b.draft_response === "string" && b.draft_response.length > 0 && b.inbox_status === "draft_ready"
  );
  assertEquals(withDraft.length, 1, "expected exactly one PATCH with draft_response + inbox_status=draft_ready");
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "AGENT_API_KEY", "ANTHROPIC_API_KEY", "HEYREACH_DRAFTING_ENABLED"];
const REAL_FETCH = globalThis.fetch;

async function callHandler(body: any, env: Record<string, string>) {
  const saved = new Map(ENV_KEYS.map((k) => [k, Deno.env.get(k)]));
  Object.entries(env).forEach(([k, v]) => Deno.env.set(k, v));
  const req = new Request("http://local/functions/v1/classify-reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key": env.AGENT_API_KEY,
    },
    body: JSON.stringify(body),
  });
  try {
    const res = await handleClassifyReply(req);
    // Let fire-and-forget auto-send work (email path awaits a DB read first) land in the stub log.
    await new Promise((r) => setTimeout(r, 25));
    return res;
  } finally {
    globalThis.fetch = REAL_FETCH;
    for (const [k, v] of saved) (v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v));
  }
}

Deno.test("LinkedIn lead suppressed: classify written, no draft fields, no draft audit, no send", async () => {
  const supabaseUrl = "http://supabase.test";
  const { logs } = makeFetchStub({
    supabaseUrl,
    leadSource: "heyreach",
    agentMode: "auto",
    classificationIntent: "interested",
    generationAutoSend: true,
  });
  const env = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_ANON_KEY: "anon",
    AGENT_API_KEY: "key",
    ANTHROPIC_API_KEY: "anthropic",
    HEYREACH_DRAFTING_ENABLED: "", // OFF
  };
  const body = {
    reply_text: "Hi there",
    thread_history: [],
    agent_context: { offer_description: "", desired_action: "", outcome_delivered: "", target_icp: "", sender_name: "A", sender_title: "", sender_linkedin: "", sender_bio: "", company_name: "C", company_url: "", communication_style: "", avoid_phrases: [], sample_message: "", calendar_link: "", pricing_summary: "", case_studies: "", disqualification_criteria: "", objection_handling_notes: "" },
    channel: "linkedin",
    user_id: "u1",
    lead_id: "lead1",
  };
  const res = await callHandler(body, env);
  assertEquals(res.status, 200);
  // agent_leads PATCH should NOT include draft_response or draft_ready
  const patches = findAgentLeadsPatch(logs);
  assert(patches.length >= 1);
  const patchBody = decodeBody(patches[0].bodyText);
  assertEquals(patchBody.draft_response, undefined);
  assertEquals(patchBody.inbox_status, undefined);
  // No draft_audit insert, no draft_created activity
  assert(!hasPostTo(logs, "draft_audit"));
  const activityPosts = findLog(logs, (l) => l.method === "POST" && l.url.includes("/rest/v1/agent_activity"));
  assertEquals(activityPosts.length, 0);
  // No LinkedIn send call even in auto mode
  assert(!hasSendHeyreach(logs));
  assertNoDraftInAnyLeadPatch(logs);
  assertEquals(sendCalls(logs).length, 0, "no send function may be invoked");
});

Deno.test("Email lead with source heyreach suppressed: classify written only", async () => {
  const supabaseUrl = "http://supabase.test";
  const { logs } = makeFetchStub({
    supabaseUrl,
    leadSource: "heyreach",
    agentMode: "auto",
    classificationIntent: "interested",
    generationAutoSend: true,
  });
  const env = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_ANON_KEY: "anon",
    AGENT_API_KEY: "key",
    ANTHROPIC_API_KEY: "anthropic",
    HEYREACH_DRAFTING_ENABLED: "", // OFF
  };
  const body = {
    reply_text: "Email reply",
    thread_history: [],
    agent_context: { offer_description: "", desired_action: "", outcome_delivered: "", target_icp: "", sender_name: "A", sender_title: "", sender_linkedin: "", sender_bio: "", company_name: "C", company_url: "", communication_style: "", avoid_phrases: [], sample_message: "", calendar_link: "", pricing_summary: "", case_studies: "", disqualification_criteria: "", objection_handling_notes: "" },
    channel: "email",
    user_id: "u1",
    lead_id: "lead2",
  };
  const res = await callHandler(body, env);
  assertEquals(res.status, 200);
  const patches = findAgentLeadsPatch(logs);
  assert(patches.length >= 1);
  const patchBody = decodeBody(patches[0].bodyText);
  assertEquals(patchBody.draft_response, undefined);
  assertEquals(patchBody.inbox_status, undefined);
  assert(!hasPostTo(logs, "draft_audit"));
  const activityPosts = findLog(logs, (l) => l.method === "POST" && l.url.includes("/rest/v1/agent_activity"));
  assertEquals(activityPosts.length, 0);
  assertNoDraftInAnyLeadPatch(logs);
  assertEquals(sendCalls(logs).length, 0, "no send function may be invoked");
});

Deno.test("Email/Smartlead lead drafts as before (draft_response, draft_ready, draft_audit) with kill switch OFF", async () => {
  const supabaseUrl = "http://supabase.test";
  const { logs } = makeFetchStub({
    supabaseUrl,
    leadSource: "smartlead",
    agentMode: "copilot", // avoid triggering auto-send path
    classificationIntent: "interested",
    generationAutoSend: true,
  });
  const env = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_ANON_KEY: "anon",
    AGENT_API_KEY: "key",
    ANTHROPIC_API_KEY: "anthropic",
    HEYREACH_DRAFTING_ENABLED: "", // OFF
  };
  const body = {
    reply_text: "Email reply",
    thread_history: [],
    agent_context: { offer_description: "", desired_action: "", outcome_delivered: "", target_icp: "", sender_name: "A", sender_title: "", sender_linkedin: "", sender_bio: "", company_name: "C", company_url: "", communication_style: "", avoid_phrases: [], sample_message: "", calendar_link: "", pricing_summary: "", case_studies: "", disqualification_criteria: "", objection_handling_notes: "" },
    channel: "email",
    user_id: "u1",
    lead_id: "lead3",
  };
  const res = await callHandler(body, env);
  assertEquals(res.status, 200);
  const patches = findAgentLeadsPatch(logs);
  assert(patches.length >= 1);
  // Evidence of drafting enabled: draft_audit written and agent_activity draft_created logged
  assert(hasPostTo(logs, "draft_audit"), "expected a draft_audit insert when flag ON");
  const activityPostsOn = findLog(logs, (l) => l.method === "POST" && l.url.includes("/rest/v1/agent_activity"));
  assert(activityPostsOn.length >= 1, "expected agent_activity draft_created when flag ON");
  assert(hasPostTo(logs, "draft_audit"));
  const activityPosts = findLog(logs, (l) => l.method === "POST" && l.url.includes("/rest/v1/agent_activity"));
  assert(activityPosts.length >= 1);
  assertDraftInLeadPatch(logs);
});

Deno.test("LinkedIn lead drafts again when flag ON", async () => {
  const supabaseUrl = "http://supabase.test";
  const { logs } = makeFetchStub({
    supabaseUrl,
    leadSource: "heyreach",
    agentMode: "copilot", // avoid send; we only check draft fields
    classificationIntent: "interested",
    generationAutoSend: true,
  });
  const env = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_ANON_KEY: "anon",
    AGENT_API_KEY: "key",
    ANTHROPIC_API_KEY: "anthropic",
    HEYREACH_DRAFTING_ENABLED: "true", // ON
  };
  const body = {
    reply_text: "Hi there",
    thread_history: [],
    agent_context: { offer_description: "", desired_action: "", outcome_delivered: "", target_icp: "", sender_name: "A", sender_title: "", sender_linkedin: "", sender_bio: "", company_name: "C", company_url: "", communication_style: "", avoid_phrases: [], sample_message: "", calendar_link: "", pricing_summary: "", case_studies: "", disqualification_criteria: "", objection_handling_notes: "" },
    channel: "linkedin",
    user_id: "u1",
    lead_id: "lead4",
  };
  const res = await callHandler(body, env);
  assertEquals(res.status, 200);
  const patchesOn = findAgentLeadsPatch(logs);
  assert(patchesOn.length >= 1);
  assert(hasPostTo(logs, "draft_audit"), "expected a draft_audit insert when flag ON");
  const activityPostsOn2 = findLog(logs, (l) => l.method === "POST" && l.url.includes("/rest/v1/agent_activity"));
  assert(activityPostsOn2.length >= 1, "expected agent_activity draft_created when flag ON");
  assertDraftInLeadPatch(logs);
});

// ---- Added coverage (review of PR #92) ----

const CTX = { offer_description: "", desired_action: "", outcome_delivered: "", target_icp: "", sender_name: "A", sender_title: "", sender_linkedin: "", sender_bio: "", company_name: "C", company_url: "", communication_style: "", avoid_phrases: [], sample_message: "", calendar_link: "", pricing_summary: "", case_studies: "", disqualification_criteria: "", objection_handling_notes: "" };

function envWith(flag: string) {
  return {
    SUPABASE_URL: "http://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_ANON_KEY: "anon",
    AGENT_API_KEY: "key",
    ANTHROPIC_API_KEY: "anthropic",
    HEYREACH_DRAFTING_ENABLED: flag,
  };
}

function assertSuppressed(logs: LoggedCall[]) {
  assertNoDraftInAnyLeadPatch(logs);
  assert(!hasPostTo(logs, "draft_audit"), "no draft_audit insert when suppressed");
  assert(!hasPostTo(logs, "agent_activity"), "no agent_activity draft_created insert when suppressed");
  assertEquals(sendCalls(logs).length, 0, "no send function may be invoked when suppressed");
}

Deno.test("LinkedIn lead with non-HeyReach source (channel-only path) suppressed in auto mode", async () => {
  // Reply.io LinkedIn threads land as channel='linkedin', source='reply_io'.
  for (const leadSource of ["reply_io", null] as const) {
    const { logs } = makeFetchStub({ supabaseUrl: "http://supabase.test", leadSource, agentMode: "auto", classificationIntent: "interested", generationAutoSend: true });
    const res = await callHandler({ reply_text: "Hi there", thread_history: [], agent_context: CTX, channel: "linkedin", user_id: "u1", lead_id: "lead5" }, envWith(""));
    assertEquals(res.status, 200);
    assertSuppressed(logs);
  }
});

Deno.test("Suppressed lead: Call 1 failure path writes no draft_audit / draft_created", async () => {
  for (const [channel, leadSource] of [["linkedin", null], ["email", "heyreach"]] as const) {
    const { logs } = makeFetchStub({ supabaseUrl: "http://supabase.test", leadSource, agentMode: "auto", call1Fail: true });
    const res = await callHandler({ reply_text: "Hi there", thread_history: [], agent_context: CTX, channel, user_id: "u1", lead_id: "lead6" }, envWith(""));
    assertEquals(res.status, 200);
    assert(!hasPostTo(logs, "draft_audit"), "no draft_audit insert when suppressed (call1 fail)");
    assert(!hasPostTo(logs, "agent_activity"), "no agent_activity draft_created when suppressed (call1 fail)");
    assertEquals(sendCalls(logs).length, 0);
  }
});

Deno.test("Email/Smartlead Call 1 failure path still logs draft_audit + draft_created (unchanged)", async () => {
  const { logs } = makeFetchStub({ supabaseUrl: "http://supabase.test", leadSource: "smartlead", agentMode: "auto", call1Fail: true });
  const res = await callHandler({ reply_text: "Email reply", thread_history: [], agent_context: CTX, channel: "email", user_id: "u1", lead_id: "lead7" }, envWith(""));
  assertEquals(res.status, 200);
  assert(hasPostTo(logs, "draft_audit"));
  assert(hasPostTo(logs, "agent_activity"));
});

Deno.test("Email/Smartlead auto mode still drafts and auto-sends via send-smartlead-email with kill switch OFF", async () => {
  const { logs } = makeFetchStub({ supabaseUrl: "http://supabase.test", leadSource: "smartlead", agentMode: "auto", classificationIntent: "interested", generationAutoSend: true });
  const res = await callHandler({ reply_text: "Email reply", thread_history: [], agent_context: CTX, channel: "email", user_id: "u1", lead_id: "lead8" }, envWith(""));
  assertEquals(res.status, 200);
  assertDraftInLeadPatch(logs);
  assert(hasPostTo(logs, "draft_audit"));
  assert(hasPostTo(logs, "agent_activity"));
  const sends = sendCalls(logs);
  assertEquals(sends.length, 1);
  assert(sends[0].url.endsWith("/functions/v1/send-smartlead-email"), sends[0].url);
});

Deno.test("Flag ON: LinkedIn auto mode drafts and auto-sends via send-heyreach-message again", async () => {
  const { logs } = makeFetchStub({ supabaseUrl: "http://supabase.test", leadSource: "heyreach", agentMode: "auto", classificationIntent: "interested", generationAutoSend: true });
  const res = await callHandler({ reply_text: "Hi there", thread_history: [], agent_context: CTX, channel: "linkedin", user_id: "u1", lead_id: "lead9" }, envWith("true"));
  assertEquals(res.status, 200);
  assertDraftInLeadPatch(logs);
  assert(hasPostTo(logs, "draft_audit"));
  assert(hasPostTo(logs, "agent_activity"));
  const sends = sendCalls(logs);
  assertEquals(sends.length, 1);
  assert(sends[0].url.endsWith("/functions/v1/send-heyreach-message"), sends[0].url);
});
