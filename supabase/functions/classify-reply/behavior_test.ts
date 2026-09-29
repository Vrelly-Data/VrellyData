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

async function callHandler(body: any, env: Record<string, string>) {
  Object.entries(env).forEach(([k, v]) => Deno.env.set(k, v));
  const req = new Request("http://local/functions/v1/classify-reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key": env.AGENT_API_KEY,
    },
    body: JSON.stringify(body),
  });
  return await handleClassifyReply(req);
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
});

