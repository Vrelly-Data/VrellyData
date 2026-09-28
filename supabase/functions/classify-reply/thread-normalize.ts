// Thread normalization utilities for classify-reply.
// Pure functions only — no side effects, no network calls.
// Goals:
// - Relabel our own outbound that is mislabelled as `prospect` to `sender` (in-memory only)
// - Strip quoted outbound chains out of prospect entries when building model turns
// - Extract the chronologically-latest genuine prospect message
//
// Heuristics are conservative — prefer false negatives to false positives.

import { preprocessEmailReply } from "../_shared/reply-text.ts";

export type RawThreadEntry = {
  role?: "prospect" | "sender" | "system" | string;
  content?: string;
  channel?: string;
  timestamp?: string;
  fromName?: string | null;
};

export type NormalizedEntry = {
  role: "prospect" | "sender";
  originalRole: string;
  content: string; // original content (trimmed)
  cleanContent: string; // for model turns (prospect entries cleaned for email)
  channel: string;
  timestampMs: number | null;
  fromName?: string | null;
  wasRelabelled: boolean;
  originalIndex: number;
};

export type SenderSignals = {
  // Case-insensitive canonical sets
  senderNames: Set<string>;
  senderEmails: Set<string>;
  senderDomains: Set<string>;
};

function toMs(ts?: string): number | null {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

function normalizeLowerSet(items: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const it of items) {
    const v = (it ?? "").trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

export function deriveSenderSignals(opts: {
  // from agent_context
  agentSenderName?: string | null;
  // from sender_profiles
  profileNames?: Array<string | null | undefined>;
  // from email_sender_mailboxes
  mailboxEmails?: Array<string | null | undefined>;
  mailboxFromNames?: Array<string | null | undefined>;
  // from prior sender turns in the same thread
  threadSenderNames?: Array<string | null | undefined>;
}): SenderSignals {
  const allNames = [
    opts.agentSenderName,
    ...(opts.profileNames ?? []),
    ...(opts.mailboxFromNames ?? []),
    ...(opts.threadSenderNames ?? []),
  ];
  const senderNames = normalizeLowerSet(allNames);
  const emails = (opts.mailboxEmails ?? [])
    .map((e) => (e ?? "").trim().toLowerCase())
    .filter(Boolean);
  const senderEmails = new Set(emails);
  const senderDomains = new Set(
    emails
      .map((e) => {
        const at = e.indexOf("@");
        return at >= 0 ? e.slice(at + 1) : "";
      })
      .filter(Boolean),
  );
  return { senderNames, senderEmails, senderDomains };
}

function containsAny(haystack: string, needles: Set<string>): boolean {
  for (const n of needles) {
    if (!n) continue;
    if (haystack.includes(n)) return true;
  }
  return false;
}

function detectForwardHeader(text: string): boolean {
  // Common indicators of forwarded copies
  const t = text.toLowerCase();
  return (
    t.includes("forwarded message") ||
    t.includes("-----original message-----")
  );
}

export function detectSenderMislabel(entry: RawThreadEntry, signals: SenderSignals): boolean {
  const role = (entry.role ?? "").toLowerCase();
  if (role !== "prospect") return false;
  const content = String(entry.content ?? "");
  const lower = content.toLowerCase();
  if (!lower.trim()) return false;
  // Signal 1: explicit forward header (we forwarded something)
  if (detectForwardHeader(content)) return true;
  // Signal 2: matches sending identities (names or mailbox domains)
  if (entry.fromName && signals.senderNames.has((entry.fromName ?? "").trim().toLowerCase())) {
    return true;
  }
  // Heuristic refinement: if this looks like a quoted chain ("From:" / "On ... wrote:"),
  // do not treat sender name mentions as a mislabel — stripping will handle it.
  const looksQuotedChain = /\bfrom:\s/i.test(content) || /\bon\s.+wrote:/i.test(content) || />/.test(content);
  if (!looksQuotedChain && containsAny(lower, signals.senderNames)) return true;
  if (containsAny(lower, signals.senderDomains)) return true;
  // Prefer false negatives — do not try to be clever beyond this
  return false;
}

function cleanProspectContentForModel(content: string, channel: string): string {
  if ((channel ?? "").toLowerCase() !== "email") return content;
  const cleaned = preprocessEmailReply(content);
  // Safety fallback: if over-stripped (<20 chars), keep original
  return cleaned && cleaned.length >= 20 ? cleaned : content;
}

export function normalizeThread(
  raw: unknown,
  opts: { channel: string; signals: SenderSignals },
): { normalized: NormalizedEntry[]; relabelCount: number } {
  const arr: RawThreadEntry[] = Array.isArray(raw) ? (raw as RawThreadEntry[]) : [];
  const out: NormalizedEntry[] = [];
  let relabelCount = 0;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i] || {};
    const role = (e.role ?? "").toLowerCase();
    const baseRole: "prospect" | "sender" =
      role === "prospect" || role === "sender" ? (role as any) : "sender";
    const content = typeof e.content === "string" ? e.content : "";
    const ch = (e.channel ?? opts.channel ?? "").toLowerCase();
    const wasRelabelled = baseRole === "prospect" && detectSenderMislabel(e, opts.signals);
    if (wasRelabelled) relabelCount++;
    const finalRole: "prospect" | "sender" = wasRelabelled ? "sender" : baseRole;
    const cleanContent = finalRole === "prospect"
      ? cleanProspectContentForModel(content, ch)
      : content;
    out.push({
      role: finalRole,
      originalRole: role || "unknown",
      content: content,
      cleanContent,
      channel: ch,
      timestampMs: toMs(e.timestamp),
      fromName: e.fromName ?? null,
      wasRelabelled,
      originalIndex: i,
    });
  }
  return { normalized: out, relabelCount };
}

export function pickLatestGenuineProspect(
  normalized: NormalizedEntry[],
): { latest: NormalizedEntry | null } {
  const prospects = normalized.filter((e) => e.role === "prospect" && e.cleanContent.trim());
  if (prospects.length === 0) return { latest: null };
  // Choose by timestamp when available; fallback to array order
  const withIdx = prospects.map((e, idx) => ({ e, idx }));
  const best = withIdx.reduce((acc, cur) => {
    const a = acc.e.timestampMs ?? -Infinity;
    const b = cur.e.timestampMs ?? -Infinity;
    if (b > a) return cur;
    if (b === a) {
      // tie-breaker: later in thread
      return cur.idx >= acc.idx ? cur : acc;
    }
    return acc;
  }, withIdx[0]);
  return { latest: best.e };
}

export function buildAnthropicMessages(
  normalized: NormalizedEntry[],
  latestProspectText: string,
  channel: string,
): {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  leadingOutbound: Array<{ role: "user" | "assistant"; content: string }>;
  isFirstTouch: boolean;
} {
  // Remove a trailing duplicate of the latest prospect text, if present
  const trimmed = (() => {
    if (!normalized.length) return normalized;
    const tail = normalized[normalized.length - 1];
    if (
      tail.role === "prospect" &&
      typeof tail.cleanContent === "string" &&
      tail.cleanContent.trim() === latestProspectText.trim()
    ) {
      return normalized.slice(0, -1);
    }
    return normalized;
  })();

  const mapped = trimmed
    .map((e) => ({
      role: (e.role === "prospect" ? "user" : "assistant") as "user" | "assistant",
      content: e.role === "prospect" ? e.cleanContent : e.content,
    }))
    .filter((m) => m.content.trim().length > 0);

  const firstUserIdx = mapped.findIndex((m) => m.role === "user");
  const leadingOutbound =
    firstUserIdx >= 0 ? mapped.slice(0, firstUserIdx) : mapped.slice(0);
  const userFirst = firstUserIdx >= 0 ? mapped.slice(firstUserIdx) : [];

  const collapsed: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of userFirst) {
    const tail = collapsed[collapsed.length - 1];
    if (tail && tail.role === m.role) {
      tail.content = `${tail.content}\n\n${m.content}`;
    } else {
      collapsed.push({ ...m });
    }
  }

  // Append the latest prospect message explicitly as the final user turn
  const finalUserContent =
    `[Channel: ${channel}]\n${latestProspectText}\n\nAnalyze this reply and respond as instructed.`;
  const finalTail = collapsed[collapsed.length - 1];
  if (finalTail && finalTail.role === "user") {
    finalTail.content = `${finalTail.content}\n\n${finalUserContent}`;
  } else {
    collapsed.push({ role: "user", content: finalUserContent });
  }
  const isFirstTouch = trimmed.length === 0;

  return { messages: collapsed, leadingOutbound, isFirstTouch };
}

