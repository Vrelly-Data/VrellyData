// The 'replied' inference_events row for a HeyReach reply, shared by
// heyreach-webhook and poll-heyreach-inbox so both write the SAME row under the
// SAME dedupe key and never double-insert one reply.
//
// Key: (source, source_row_id, event_type) = ('heyreach_webhook',
// '<conversationId>:<newest thread timestamp, ISO>', 'replied') — the webhook's
// existing key, unchanged, so rows it already wrote still dedupe. The poller
// writes under the same source value (metadata.writer tells them apart).
//
// The two paths can see the same message with slightly different timestamps
// (webhook recent_messages.creation_time vs GetChatroom createdAt), which would
// give two different keys. So before writing, a row of the same team +
// conversation within SAME_REPLY_TOLERANCE_MS of this one counts as the same
// reply and nothing is written.
//
// Writes only inference_events. Never throws: the warehouse write is
// best-effort and must not change what the caller does next.

export const HEYREACH_INFERENCE_SOURCE = "heyreach_webhook";
/** Same tolerance as the webhook's thread merge (clock skew + propagation). */
export const SAME_REPLY_TOLERANCE_MS = 120_000;

export type ThreadEntry = { role: string; content: string; timestamp: string; channel?: string };

// Newest message timestamp in a thread, as an ISO string, or null when the
// thread is empty or carries no parseable timestamp. The same quantity the
// poller derives for its resurface gate (a max over the thread, not the last
// array element).
export function newestThreadTimestamp(thread: ThreadEntry[] | null | undefined): string | null {
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: string | null = null;
  for (const e of thread ?? []) {
    const ms = new Date(e?.timestamp ?? "").getTime();
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

export interface HeyReachReplyInput {
  teamId: string | null;
  agentConfigId: string;
  conversationId: string | null;
  thread: ThreadEntry[];
  email?: string | null;
  linkedinUrl?: string | null;
  /** Fallback person key when there is no email or LinkedIn URL. */
  externalId?: string | null;
  fullName?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  campaignExternalId?: string | null;
  replyText: string;
  externalMessageId?: string | null;
  leadCategory?: unknown;
  language: { code: string | null; method: string | null };
  extraMetadata?: Record<string, unknown>;
}

/** The row, or null when there is no person key or no stable id (the webhook's existing skip). */
export function buildHeyReachRepliedEvent(i: HeyReachReplyInput): Record<string, unknown> | null {
  const email = i.email && i.email.trim() ? i.email.trim().toLowerCase() : null;
  const linkedin = i.linkedinUrl && i.linkedinUrl.trim() ? i.linkedinUrl.trim() : null;
  const personKey = email || linkedin || (i.externalId ?? "");
  const occurredAt = newestThreadTimestamp(i.thread);
  const stableId = i.conversationId && occurredAt ? `${i.conversationId}:${occurredAt}` : null;
  if (!personKey || !stableId) return null;
  return {
    team_id: i.teamId,
    agent_config_id: i.agentConfigId,
    person_key: personKey,
    email,
    linkedin_url: i.linkedinUrl ?? null,
    full_name: i.fullName || null,
    job_title: i.jobTitle || null,
    company_name: i.company || null,
    channel: "linkedin",
    campaign_external_id: i.campaignExternalId || null,
    campaign_name: null,
    sequence_step_type: null,
    copy_fingerprint: null,
    subject: null,
    event_type: "replied",
    intent: null,
    is_objection: null,
    pipeline_stage: "replied",
    disposition_tag: null,
    occurred_at: occurredAt,
    source: HEYREACH_INFERENCE_SOURCE,
    source_row_id: stableId,
    metadata: {
      provider: "heyreach",
      lead_category: i.leadCategory ?? null,
      reply_text: i.replyText,
      reply_language_code: i.language.code,
      reply_language_method: i.language.method,
      external_message_id: i.externalMessageId ?? null,
      conversation_id: i.conversationId,
      // Normalized provider ids
      provider_thread_id: i.conversationId,
      provider_message_id: i.externalMessageId ?? null,
      ...(i.extraMetadata ?? {}),
    },
  };
}

export type WriteResult = "written" | "duplicate" | "skipped" | "error";

/**
 * True when another row (a DIFFERENT key) already records this reply: same
 * team + conversation, occurred_at within the tolerance. The exact same key is
 * left to the unique index (the webhook's upsert refreshes its own row).
 */
export function isNearDuplicate(
  row: Record<string, unknown>,
  existing: Array<{ source_row_id?: unknown; metadata?: unknown; occurred_at?: unknown }>,
): boolean {
  const conv = String((row.metadata as Record<string, unknown>)?.conversation_id ?? "");
  const at = Date.parse(String(row.occurred_at));
  return existing.some((e) => {
    if (e.source_row_id === row.source_row_id) return false;
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    if (String(m.conversation_id ?? m.provider_thread_id ?? "") !== conv) return false;
    const t = Date.parse(String(e.occurred_at));
    return Number.isFinite(t) && Math.abs(t - at) <= SAME_REPLY_TOLERANCE_MS;
  });
}

/**
 * Writes the row unless the same reply is already recorded.
 *   mode 'upsert' (webhook): an exact-key redelivery updates its row, as before.
 *   mode 'insert' (poller / backfill): an exact-key row is left alone.
 */
// deno-lint-ignore no-explicit-any
export async function writeHeyReachRepliedEvent(
  supabase: any,
  row: Record<string, unknown> | null,
  mode: "upsert" | "insert",
  opts: { signal?: AbortSignal; log?: string } = {},
): Promise<WriteResult> {
  const log = opts.log ?? "heyreach-inference";
  if (!row) return "skipped";
  try {
    const at = Date.parse(String(row.occurred_at));
    let q = supabase
      .from("inference_events")
      .select("source_row_id, occurred_at, metadata")
      .eq("source", HEYREACH_INFERENCE_SOURCE)
      .eq("event_type", "replied")
      .gte("occurred_at", new Date(at - SAME_REPLY_TOLERANCE_MS).toISOString())
      .lte("occurred_at", new Date(at + SAME_REPLY_TOLERANCE_MS).toISOString());
    q = row.team_id ? q.eq("team_id", row.team_id) : q.is("team_id", null);
    if (opts.signal) q = q.abortSignal(opts.signal);
    const { data: near, error: nearErr } = await q.limit(50);
    if (nearErr) {
      // Unknown state: writing could double-insert, so don't.
      console.warn(`[${log}] inference_events dedupe lookup failed (non-fatal, not written):`, nearErr.message ?? nearErr);
      return "error";
    }
    const rows = (near ?? []) as Array<{ source_row_id?: unknown; metadata?: unknown; occurred_at?: unknown }>;
    if (isNearDuplicate(row, rows)) return "duplicate";
    if (mode === "insert" && rows.some((e) => e.source_row_id === row.source_row_id)) return "duplicate";

    let w = supabase.from("inference_events").upsert(
      row,
      // partial unique index on (source, source_row_id, event_type) where source_row_id is not null
      { onConflict: "source,source_row_id,event_type", ignoreDuplicates: mode === "insert" },
    );
    if (opts.signal) w = w.abortSignal(opts.signal);
    const { error } = await w;
    if (error) {
      console.warn(`[${log}] inference_events write error (non-fatal):`, error.message ?? error);
      return "error";
    }
    return "written";
  } catch (e) {
    console.warn(`[${log}] inference_events write failed (non-fatal):`, e);
    return "error";
  }
}

export type ChatroomMessage = { id?: unknown; sender?: string; body?: string; createdAt?: string };

/**
 * One row per prospect message from the last `maxAgeDays`, newest first, each
 * keyed exactly as the webhook keyed it when that message arrived: the thread
 * UP TO that message (so its newest timestamp is the message's own).
 * GetChatroom messages (poll-heyreach-inbox and its backfill).
 */
export function heyReachRepliedEventsFromChatroom(
  base: Omit<HeyReachReplyInput, "thread" | "replyText" | "externalMessageId" | "language">,
  messages: ChatroomMessage[],
  opts: { maxAgeDays: number; nowMs: number; limit: number; detectLanguage: (t: string) => { code: string | null; method: string | null } },
): Array<Record<string, unknown>> {
  const thread: ThreadEntry[] = (messages ?? []).map((m) => ({
    role: m.sender === "ME" ? "sender" : "prospect",
    content: m.body || "",
    timestamp: m.createdAt || "",
    channel: "linkedin",
  }));
  const cutoff = opts.nowMs - opts.maxAgeDays * 86_400_000;
  const picks: Array<{ ms: number; idx: number }> = [];
  thread.forEach((e, idx) => {
    const ms = Date.parse(e.timestamp);
    if (e.role === "prospect" && e.content.trim() && Number.isFinite(ms) && ms >= cutoff) picks.push({ ms, idx });
  });
  picks.sort((a, b) => b.ms - a.ms);
  const out: Array<Record<string, unknown>> = [];
  for (const p of picks.slice(0, opts.limit)) {
    const upTo = thread.filter((e) => {
      const ms = Date.parse(e.timestamp);
      return Number.isFinite(ms) && ms <= p.ms;
    });
    const text = thread[p.idx].content;
    const row = buildHeyReachRepliedEvent({
      ...base,
      thread: upTo,
      replyText: text,
      externalMessageId: messages[p.idx]?.id == null ? null : String(messages[p.idx].id),
      language: opts.detectLanguage(text),
    });
    if (row) out.push(row);
  }
  return out;
}
