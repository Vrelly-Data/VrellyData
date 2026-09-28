// deno run --allow-read --allow-env --allow-net=api.anthropic.com supabase/functions/classify-reply/harness/run-fixtures.ts
//
// Offline harness to compare v67 ("before") vs new ("after") prompt/messages,
// and optionally call Anthropic to generate drafts.
//
// Reads real fixtures + client context from uploads/, but writes reports only.
// DO NOT commit the real fixtures — they stay in uploads/.

import { preprocessEmailReply } from "../../_shared/reply-text.ts";
import {
  deriveSenderSignals,
  normalizeThread,
  pickLatestGenuineProspect,
  buildAnthropicMessages,
  type RawThreadEntry,
} from "../thread-normalize.ts";

type Fixture = {
  fixture_id: string;
  client: string;
  source: string;
  channel: string;
  context_file: string; // e.g. "context/sourceco.json"
  request: {
    reply_text: string;
    thread_history: RawThreadEntry[];
    lead_id: string;
    user_id: string;
    channel: string;
    agent_context?: any; // not provided in real fixtures (use context_file)
  };
  prod_before: {
    draft_response: string | null;
    intent: string;
    model: string;
    temperature: number;
    prompt_version: string;
    audit_metadata?: any;
  };
  annotation?: {
    latest_genuine_prospect_text?: string;
  };
};

type ClientContext = {
  agent_config_prompt_fields: any;
  sender_profiles?: Array<{ sender_name: string }>;
  email_sender_mailboxes?: Array<{ mailbox_email: string; from_name?: string; sender_name?: string }>;
  sales_knowledge_global?: any;
};

const UPLOADS = Deno.env.get("UPLOADS_DIR") ||
  "/home/ubuntu/.cursor/projects/workspace/uploads";
const FIXTURES_DIR = `${UPLOADS}/fixtures`;
const CONTEXT_DIR = `${UPLOADS}/fixtures/context`;
const ARTIFACT_MD = "/opt/cursor/artifacts/classify-reply-report.md";
const ARTIFACT_JSON = "/opt/cursor/artifacts/classify-reply-report.json";

function readJson<T>(path: string): T {
  const txt = Deno.readTextFileSync(path);
  return JSON.parse(txt) as T;
}

function buildBeforeMessages(
  replyText: string,
  thread: RawThreadEntry[],
  channel: string,
) {
  const processed = channel === "email" ? ((): string => {
    const c = preprocessEmailReply(replyText);
    return c && c.length >= 20 ? c : replyText;
  })() : replyText;

  type M = { role: "user" | "assistant"; content: string };
  const trimmed =
    thread.length > 0 &&
      thread[thread.length - 1].role === "prospect" &&
      typeof thread[thread.length - 1].content === "string" &&
      (thread[thread.length - 1].content as string).trim() === processed.trim()
      ? thread.slice(0, -1)
      : thread;
  const mapped: M[] = trimmed
    .map((e) => ({
      role: (e.role === "prospect" ? "user" : "assistant") as "user" | "assistant",
      content: typeof e.content === "string" ? e.content : "",
    }))
    .filter((m) => m.content.trim().length > 0);
  const firstUserIdx = mapped.findIndex((m) => m.role === "user");
  const leadingOutbound = firstUserIdx >= 0 ? mapped.slice(0, firstUserIdx) : mapped.slice(0);
  const userFirst = firstUserIdx >= 0 ? mapped.slice(firstUserIdx) : [];
  const collapsed: M[] = [];
  for (const m of userFirst) {
    const tail = collapsed[collapsed.length - 1];
    if (tail && tail.role === m.role) {
      tail.content = `${tail.content}\n\n${m.content}`;
    } else {
      collapsed.push({ ...m });
    }
  }
  const finalUserContent =
    `[Channel: ${channel}]\n${processed}\n\nAnalyze this reply and respond as instructed.`;
  const finalTail = collapsed[collapsed.length - 1];
  if (finalTail && finalTail.role === "user") {
    finalTail.content = `${finalTail.content}\n\n${finalUserContent}`;
  } else {
    collapsed.push({ role: "user", content: finalUserContent });
  }
  const isFirstTouch = trimmed.length === 0;
  return { messages: collapsed, leadingOutbound, isFirstTouch, processed };
}

function summarizeLeadingOutbound(leading: Array<{ content: string }>, who: string): string {
  if (!leading.length) return "";
  return `\n## Our outreach before their first reply
These ${leading.length} message(s) were sent by ${who} to this prospect BEFORE the reply you are handling. The reply is very often answering the LAST one — read it in that light. Do not re-pitch points already made here.
${leading.map((m, i) => `\n--- Outbound ${i + 1} of ${leading.length} ---\n${m.content}`).join("")}\n`;
}

function extractProspectPaths(text: string): { emails: string[]; urls: string[]; phones: string[] } {
  const safe = String(text ?? "");
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const urlRe = /https?:\/\/[^\s)]+/gi;
  const phoneRe = /(?:\+?\d[\s().-]?){7,}\d/gi;
  const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => s.trim()))).filter(Boolean);
  return {
    emails: uniq((safe.match(emailRe) ?? []) as string[]),
    urls: uniq((safe.match(urlRe) ?? []) as string[]),
    phones: uniq((safe.match(phoneRe) ?? []) as string[]),
  };
}

function buildAfterMessages(
  replyTextProcessed: string,
  thread: RawThreadEntry[],
  channel: string,
  effSenderName: string,
  mailboxEmails: string[],
  mailboxFromNames: string[],
  threadSenderName?: string | null,
) {
  const signals = deriveSenderSignals({
    agentSenderName: effSenderName,
    mailboxEmails,
    mailboxFromNames,
    threadSenderNames: threadSenderName ? [threadSenderName] : [],
  });
  const { normalized } = normalizeThread(thread, { channel, signals });
  const { latest } = pickLatestGenuineProspect(normalized);
  const latestProspectText = latest?.cleanContent?.trim()
    ? latest.cleanContent.trim()
    : replyTextProcessed;
  const { messages, leadingOutbound, isFirstTouch } = buildAnthropicMessages(
    normalized,
    latestProspectText,
    channel,
  );
  return { messages, leadingOutbound, isFirstTouch, latestProspectText };
}

type ReportItem = {
  fixture_id: string;
  client: string;
  channel: string;
  latest_genuine_prospect_message: string;
  prod_draft: string | null;
  v67_prompt_sample: string;
  after_prompt_sample: string;
};

type ModelRequest = {
  model: string;
  temperature: number;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  depends_on?: string | null;
};

type ModelRequestsOut = {
  fixtures: Array<{
    fixture_id: string;
    client: string;
    channel: string;
    before: { call1: ModelRequest; call2: ModelRequest };
    after: { call1: ModelRequest; call2: ModelRequest };
  }>;
  note: string;
};

function promptSampleForV67(agentCtx: any, priorOutreach: string, processed: string): string {
  const lines: string[] = [];
  lines.push(`Offer: ${agentCtx?.offer_description ?? ''}`);
  lines.push(`Company: ${agentCtx?.company_name ?? ''}`);
  if (agentCtx?.calendar_link) lines.push(`Calendar: ${agentCtx.calendar_link}`);
  lines.push(priorOutreach.trim());
  lines.push(`Concrete next steps in latest: ${JSON.stringify(extractProspectPaths(processed))}`);
  return lines.filter(Boolean).join("\n");
}

function promptSampleForAfter(agentCtx: any, priorOutreach: string, latest: string): string {
  const lines: string[] = [];
  lines.push(`LATEST (answer first):\n${latest}`);
  lines.push(`Offer: ${agentCtx?.offer_description ?? ''}`);
  lines.push(priorOutreach.trim());
  lines.push(`Concrete next steps in latest: ${JSON.stringify(extractProspectPaths(latest))}`);
  return lines.filter(Boolean).join("\n");
}

function formatMdReport(items: ReportItem[]): string {
  const parts: string[] = [];
  parts.push(`# classify-reply fixtures harness report (dry-run when no key)`);
  parts.push(`Total fixtures: ${items.length}`);
  for (const it of items) {
    parts.push(`\n---\n## ${it.fixture_id} (${it.client}, ${it.channel})`);
    parts.push(`\n**Latest genuine prospect message:**\n\n${it.latest_genuine_prospect_message}`);
    parts.push(`\n**Prod draft (from fixture):**\n\n${it.prod_draft ?? '(none)'}`);
    parts.push(`\n**BEFORE (v67) prompt sample:**\n\n${it.v67_prompt_sample}`);
    parts.push(`\n**AFTER (new) prompt sample:**\n\n${it.after_prompt_sample}`);
  }
  parts.push(`\n\nNote: This report shows prompt/message construction only when running in --dry-run or without an ANTHROPIC_API_KEY.`);
  return parts.join("\n");
}

if (import.meta.main) {
  const args = new Set(Deno.args);
  const isDryRun = args.has("--dry-run") || !Deno.env.get("ANTHROPIC_API_KEY");
  const index = readJson<Array<{ file: string; client: string; channel: string }>>(
    `${FIXTURES_DIR}/INDEX.json`,
  );

  const reports: ReportItem[] = [];
  const requests: ModelRequestsOut = { fixtures: [], note: "Replay with Anthropic Messages API v2023-06-01; Call 2 persona block depends on Call 1's matched_persona. Campaign-intelligence inputs are omitted for both paths as not present in the snapshot." };
  for (const row of index) {
    const fpath = `${FIXTURES_DIR}/${row.file}`;
    const fx = readJson<Fixture>(fpath);
    const ctx = readJson<ClientContext>(`${UPLOADS}/fixtures/${fx.context_file}`);
    const agentCtx = ctx.agent_config_prompt_fields ?? {};
    const mailboxEmails = (ctx.email_sender_mailboxes ?? []).map((m) => m.mailbox_email);
    const mailboxFromNames = (ctx.email_sender_mailboxes ?? []).map((m) => m.from_name ?? m.sender_name ?? "");
    const effSenderName: string = agentCtx?.sender_name ?? (ctx.sender_profiles?.[0]?.sender_name ?? "Sender");
    const companyName: string = agentCtx?.company_name ?? "";

    // BEFORE (v67)
    const before = buildBeforeMessages(fx.request.reply_text, fx.request.thread_history, fx.channel);
    const priorV = summarizeLeadingOutbound(before.leadingOutbound, effSenderName);
    // BEFORE Call 1 system (compact personas/guidelines/templates omitted in snapshot)
    const personaList = "No personas defined.";
    const call1SystemBefore = `You are an expert B2B sales analyst working on behalf of ${effSenderName} at ${companyName}. Your job is to read an inbound prospect reply and classify it precisely — you do NOT write the response, you analyze.

## The Offer
${agentCtx?.offer_description ?? ""}
${agentCtx?.target_icp ? `Who it's for: ${agentCtx.target_icp}` : ""}

## The Prospect
${priorV}
## Known Buyer Personas
${personaList}

## Your Task
Analyze the prospect's latest reply together with the conversation so far, then return ONLY this JSON object:
{
  "intent": one of 'interested', 'not_interested', 'referral', 'out_of_office', 'bounce', 'needs_more_info', 'unknown',
  "intent_confidence": a float from 0.00 to 1.00,
  "is_objection": boolean,
  "prospect_read": {
    "seniority": one of "exec", "mid", "ic", "unknown",
    "buying_role": one of "decision_maker", "influencer", "end_user", "unknown",
    "matched_persona": the EXACT title of the best-fit persona above, or null,
    "suggested_angle": "one sentence — see instructions"
  }
}
Return ONLY valid JSON. No markdown fences. No explanation.`;
    const beforeCall1: ModelRequest = {
      model: "claude-sonnet-4-6",
      temperature: 0,
      max_tokens: 500,
      system: call1SystemBefore,
      messages: before.messages,
    };
    // BEFORE Call 2 system (persona section depends on Call 1)
    const stageSectionV = before.isFirstTouch
      ? `## Conversation Stage — First Reply
This is the prospect's first reply in this thread.`
      : `## Conversation Stage — Ongoing Thread
This is part of an ongoing exchange.`;
    const call2SystemBefore = `You are an expert B2B sales agent operating on behalf of ${effSenderName}${agentCtx?.sender_title ? `, ${agentCtx.sender_title}` : ''} at ${companyName}.

## About ${effSenderName}
${agentCtx?.sender_bio || ''}
${agentCtx?.sender_linkedin ? `LinkedIn: ${agentCtx.sender_linkedin}` : ''}

## The Offer
Company: ${companyName}${agentCtx?.company_url ? ` (${agentCtx.company_url})` : ''}
What we sell: ${agentCtx?.offer_description ?? ''}
${agentCtx?.target_icp ? `Who it's for: ${agentCtx.target_icp}` : ''}
${agentCtx?.outcome_delivered ? `Outcome we deliver: ${agentCtx.outcome_delivered}` : ''}
${agentCtx?.desired_action ? `Desired prospect action: ${agentCtx.desired_action}` : ''}
${agentCtx?.communication_style ? `Communication style: ${agentCtx.communication_style}` : ''}
${Array.isArray(agentCtx?.avoid_phrases) && agentCtx.avoid_phrases.length ? 'Never say or reference: ' + agentCtx.avoid_phrases.join(', ') : ''}
${agentCtx?.sample_message ? 'Writing style example (match this tone exactly):\n' + agentCtx.sample_message : ''}

## Grounding Rules (RANKED — follow IN THIS ORDER)
1) Respond to the latest prospect message FIRST AND FOREMOST...

## Resources to Reference
${agentCtx?.calendar_link ? `Calendar booking link: ${agentCtx.calendar_link}` : ''}
${agentCtx?.case_studies || ''}

## Pricing
${agentCtx?.pricing_summary || 'Pricing depends on use case — direct prospects to a call rather than quoting numbers.'}

## When to Disqualify
${agentCtx?.disqualification_criteria || 'Use judgment — politely decline if the prospect is clearly outside ICP.'}

## Objection Playbook
${agentCtx?.objection_handling_notes || 'Acknowledge the objection, validate it, then redirect to value.'}

## About the Prospect
${priorV}

## Concrete next step(s) the prospect provided
${JSON.stringify(extractProspectPaths(before.processed))}

${stageSectionV}

## Your Task
Return ONLY valid JSON (see repo).`;
    const beforeCall2: ModelRequest = {
      model: "claude-sonnet-4-6",
      temperature: 0.5,
      max_tokens: 1000,
      system: call2SystemBefore,
      messages: before.messages,
      depends_on: "call1.matched_persona",
    };

    // AFTER (new)
    const after = buildAfterMessages(before.processed, fx.request.thread_history, fx.channel, effSenderName, mailboxEmails, mailboxFromNames);
    const priorA = summarizeLeadingOutbound(after.leadingOutbound, effSenderName);
    const latest = after.latestProspectText;
    const call1SystemAfter = call1SystemBefore; // same structure for offline export
    const afterCall1: ModelRequest = {
      model: "claude-sonnet-4-6",
      temperature: 0,
      max_tokens: 500,
      system: call1SystemAfter,
      messages: after.messages,
    };
    const stageSectionA = after.isFirstTouch
      ? `## Conversation Stage — First Reply
This is the prospect's first reply in this thread.`
      : `## Conversation Stage — Ongoing Thread
This is part of an ongoing exchange.`;
    const call2SystemAfter = `You are an expert B2B sales agent operating on behalf of ${effSenderName}${agentCtx?.sender_title ? `, ${agentCtx.sender_title}` : ''} at ${companyName}.

## About ${effSenderName}
${agentCtx?.sender_bio || ''}
${agentCtx?.sender_linkedin ? `LinkedIn: ${agentCtx.sender_linkedin}` : ''}

## Latest Prospect Message (ANSWER THIS FIRST)
${latest}

## Grounding Rules (RANKED — follow IN THIS ORDER)
1) Respond to the latest prospect message FIRST AND FOREMOST...

## Resources to Reference
${agentCtx?.calendar_link ? `Calendar booking link: ${agentCtx.calendar_link}` : ''}
${agentCtx?.case_studies || ''}

## Pricing
${agentCtx?.pricing_summary || 'Pricing depends on use case — direct prospects to a call rather than quoting numbers.'}

## When to Disqualify
${agentCtx?.disqualification_criteria || 'Use judgment — politely decline if the prospect is clearly outside ICP.'}

## Objection Playbook
${agentCtx?.objection_handling_notes || 'Acknowledge the objection, validate it, then redirect to value.'}

## About the Prospect
${priorA}

## Concrete next step(s) the prospect provided
${JSON.stringify(extractProspectPaths(latest))}

${stageSectionA}

## Your Task
Return ONLY valid JSON (see repo).`;
    const afterCall2: ModelRequest = {
      model: "claude-sonnet-4-6",
      temperature: 0.5,
      max_tokens: 1000,
      system: call2SystemAfter,
      messages: after.messages,
      depends_on: "call1.matched_persona",
    };

    reports.push({
      fixture_id: fx.fixture_id,
      client: fx.client,
      channel: fx.channel,
      latest_genuine_prospect_message: after.latestProspectText,
      prod_draft: fx.prod_before?.draft_response ?? null,
      v67_prompt_sample: promptSampleForV67(agentCtx, priorV, before.processed),
      after_prompt_sample: promptSampleForAfter(agentCtx, priorA, after.latestProspectText),
    });
    requests.fixtures.push({
      fixture_id: fx.fixture_id,
      client: fx.client,
      channel: fx.channel,
      before: { call1: beforeCall1, call2: beforeCall2 },
      after: { call1: afterCall1, call2: afterCall2 },
    });
  }

  // Write artifacts
  await Deno.writeTextFile(ARTIFACT_MD, formatMdReport(reports));
  await Deno.writeTextFile(ARTIFACT_JSON, JSON.stringify(reports, null, 2));
  await Deno.writeTextFile("/opt/cursor/artifacts/model-requests.json", JSON.stringify(requests, null, 2));

  console.log(`Wrote:\n- ${ARTIFACT_MD}\n- ${ARTIFACT_JSON}`);
  console.log(`- /opt/cursor/artifacts/model-requests.json`);
  if (isDryRun) {
    console.log("Dry-run mode (no model calls).");
  } else {
    console.log("Model mode enabled, but this harness currently focuses on prompt construction per spec.");
  }
}

