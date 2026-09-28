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
  agent_context: any;
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
  for (const row of index) {
    const fpath = `${FIXTURES_DIR}/${row.file}`;
    const fx = readJson<Fixture>(fpath);
    const ctx = readJson<ClientContext>(`${UPLOADS}/fixtures/${fx.context_file}`);
    const agentCtx = ctx.agent_context ?? {};
    const mailboxEmails = (ctx.email_sender_mailboxes ?? []).map((m) => m.mailbox_email);
    const mailboxFromNames = (ctx.email_sender_mailboxes ?? []).map((m) => m.from_name ?? m.sender_name ?? "");
    const effSenderName: string = agentCtx?.sender_name ?? (ctx.sender_profiles?.[0]?.sender_name ?? "Sender");

    // BEFORE (v67)
    const before = buildBeforeMessages(fx.request.reply_text, fx.request.thread_history, fx.channel);
    const priorV = summarizeLeadingOutbound(before.leadingOutbound, effSenderName);

    // AFTER (new)
    const after = buildAfterMessages(before.processed, fx.request.thread_history, fx.channel, effSenderName, mailboxEmails, mailboxFromNames);
    const priorA = summarizeLeadingOutbound(after.leadingOutbound, effSenderName);

    reports.push({
      fixture_id: fx.fixture_id,
      client: fx.client,
      channel: fx.channel,
      latest_genuine_prospect_message: after.latestProspectText,
      prod_draft: fx.prod_before?.draft_response ?? null,
      v67_prompt_sample: promptSampleForV67(agentCtx, priorV, before.processed),
      after_prompt_sample: promptSampleForAfter(agentCtx, priorA, after.latestProspectText),
    });
  }

  // Write artifacts
  await Deno.writeTextFile(ARTIFACT_MD, formatMdReport(reports));
  await Deno.writeTextFile(ARTIFACT_JSON, JSON.stringify(reports, null, 2));

  console.log(`Wrote:\n- ${ARTIFACT_MD}\n- ${ARTIFACT_JSON}`);
  if (isDryRun) {
    console.log("Dry-run mode (no model calls).");
  } else {
    console.log("Model mode enabled, but this harness currently focuses on prompt construction per spec.");
  }
}

