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

function indexOfForwardHeader(text: string): number {
  // Return the index where a forward/original header starts, or -1 if absent.
  const re = /(^|\n)\s*-{2,}\s*(Forwarded message|Original Message)\s*-{2,}\s*$/im;
  const m = text.search(re);
  return m;
}

function parseForwardHeaderBlock(text: string, startIdx: number): {
  endIdx: number;
  fromEmail: string | null;
  toEmail: string | null;
} {
  // Parse lines after header start to extract From:/To: and find end of header.
  // Header typically spans a handful of lines (From, To, Subject, Date/Sent).
  const rest = text.slice(startIdx);
  const lines = rest.split(/\r?\n/);
  let fromEmail: string | null = null;
  let toEmail: string | null = null;
  let endOffset = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    endOffset += (i === 1 ? lines[0].length : lines[i - 1].length) + 1; // rough byte count
    if (!line.trim()) {
      // blank line → end of header block
      break;
    }
    const mFrom = /^From:\s*.*?<([^>\s]+)>/i.exec(line) || /^From:\s*([^<\s][^\s]+@[^\s]+)\s*$/i.exec(line);
    if (mFrom) {
      fromEmail = mFrom[1].toLowerCase();
    }
    const mTo = /^To:\s*.*?<([^>\s]+)>/i.exec(line) || /^To:\s*([^<\s][^\s]+@[^\s]+)\s*$/i.exec(line);
    if (mTo) {
      toEmail = mTo[1].toLowerCase();
    }
  }
  // Compute absolute end index (startIdx + header block length)
  const headerEndIdx = startIdx + endOffset;
  return { endIdx: headerEndIdx, fromEmail, toEmail };
}

export function detectSenderMislabel(entry: RawThreadEntry, signals: SenderSignals): boolean {
  const role = (entry.role ?? "").toLowerCase();
  if (role !== "prospect") return false;
  const content = String(entry.content ?? "");
  const lower = content.toLowerCase();
  if (!lower.trim()) return false;
  // Signal 1 (forwards): only treat as our forward when the header opens the message
  // (no prospect text above it) AND the forwarded From: matches our identities.
  const fwdIdx = indexOfForwardHeader(content);
  if (fwdIdx >= 0) {
    const above = content.slice(0, fwdIdx).trim();
    if (!above) {
      const { fromEmail, toEmail } = parseForwardHeaderBlock(content, fwdIdx);
      const fromMatches =
        !!fromEmail &&
        (signals.senderEmails.has(fromEmail) ||
          (fromEmail.includes("@") &&
            signals.senderDomains.has(fromEmail.split("@")[1])));
      // Presence of our mailbox in To: must NOT trigger relabel
      const toMatches = !!toEmail && (signals.senderEmails.has(toEmail) || (toEmail.includes("@") && signals.senderDomains.has(toEmail.split("@")[1])));
      if (fromMatches && !toMatches) return true;
    }
  }
  // Heuristic guard: quoted chains or 'From:' headers mid-text indicate the prospect
  // wrote above a quote — never relabel based on names/domains in that case.
  const looksQuotedChain =
    /^\s*From:\s/im.test(content) || /\bon\s.+wrote:/i.test(content) || />/.test(content);
  // Signal 2 (top-of-message From: header): explicit From: <our name/email> at TOP.
  if (!looksQuotedChain) {
    const topFrom = /^\s*From:\s*([^\n]+)$/im.exec(content);
    if (topFrom) {
      const hdr = topFrom[1].toLowerCase();
      const hasOurDomain = Array.from(signals.senderDomains).some((d) => hdr.includes(d));
      const hasOurEmail = Array.from(signals.senderEmails).some((e) => hdr.includes(e));
      const hasOurName = Array.from(signals.senderNames).some((n) => hdr.includes(n));
      if (hasOurEmail || hasOurDomain || hasOurName) return true;
    }
  }
  // Do NOT use naked name-substrings or fromName alone — too many false positives.
  // Prefer false negatives — do not try to be clever beyond this
  return false;
}

export function looksLikeOurSenderAtTop(content: string, signals: SenderSignals): boolean {
  const text = String(content ?? "");
  if (!text.trim()) return false;
  // Consider lines up to the first quoted header or 8 lines, whichever comes first.
  const fwdIdx = indexOfForwardHeader(text);
  const upto = fwdIdx >= 0 ? fwdIdx : text.length;
  const head = text.slice(0, upto);
  const lines = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  const lowerLines = lines.map((l) => l.toLowerCase());
  const hasName = Array.from(signals.senderNames).some((n) => n && lowerLines.some((l) => l === n || l.endsWith(n)));
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const hasEmail = lowerLines.some((l) => {
    const m = l.match(emailRe);
    if (!m) return false;
    const e = m[0].toLowerCase();
    return signals.senderEmails.has(e) || (e.includes("@") && signals.senderDomains.has(e.split("@")[1]));
  });
  return hasName || hasEmail;
}

function cleanProspectContentForModel(content: string, channel: string): string {
  if ((channel ?? "").toLowerCase() !== "email") return content;
  let cleaned = preprocessEmailReply(content);
  // Additional conservative trims for Outlook-style blocks and disclaimers that can
  // survive the anchored markers in preprocessEmailReply when blank lines intervene.
  // Prefer removing only the header block rather than dropping the whole body.
  if (cleaned) {
    // Strip a top-of-message forward header block, keep the body
    const fwd = indexOfForwardHeader(cleaned);
    if (fwd >= 0) {
      const above = cleaned.slice(0, fwd).trim();
      const { endIdx } = parseForwardHeaderBlock(cleaned, fwd);
      if (!above && endIdx > fwd) {
        cleaned = (cleaned.slice(0, fwd) + cleaned.slice(endIdx)).trim();
      }
    }
    // Remove confidentiality disclaimers
    const idxConf = cleaned.search(/\bCONFIDENTIALITY NOTICE\b/i);
    if (idxConf >= 0) cleaned = cleaned.slice(0, idxConf).trim();
    // If a naked "From:" header remains mid-text (quoted chain), remove that tail
    const idxFromMid = cleaned.search(/^\s*From:\s/im);
    if (idxFromMid >= 0) cleaned = cleaned.slice(0, idxFromMid).trim();
  }
  // For thread turns used to build model messages, prefer the cleaned content
  // even if very short — a terse reply like "Regarding?" is still the truth.
  // Top-level processed_reply_text retains its own <20-char fallback semantics.
  return cleaned && cleaned.length > 0 ? cleaned : content;
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

