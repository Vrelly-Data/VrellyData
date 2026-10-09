// Auto Pilot — the auto-send decision, its routing, and its outcome handling.
//
// Called by classify-reply AFTER classification and drafting are finished and
// written (draft_response set, inbox_status 'draft_ready'). Nothing here
// classifies or drafts; it only decides whether that draft goes out on its own,
// to which sender, and what happens when the send fails.
//
// WHY IT EXISTS (2026-10). The previous auto-send routed by CHANNEL alone:
// every LinkedIn reply went to send-heyreach-message. A Reply.io LinkedIn lead
// has no heyreach_conversation_id, so that call failed — fire-and-forget, so
// silently, and the lead sat in draft_ready forever with no trace of why.
// Routing is now by SOURCE first, and every send is awaited: a failure leaves
// the lead as draft_ready and writes an 'auto_send_failed' activity with the
// sender's own error.
//
// The senders (send-agent-reply, send-smartlead-email, send-heyreach-message)
// are NOT changed: each already accepts `auto: true`, keeps its own guards
// (opted-out refusal, thread ownership checks), and on success marks the lead
// sent + auto_handled and writes a 'message_sent' activity with
// metadata.sent_by = 'auto' — which is what the daily cap counts.

export const AUTO_SEND_INTENTS: ReadonlySet<string> = new Set([
  "interested", "needs_more_info", "not_interested", "referral",
]);
export const SUPPRESS_INTENTS: ReadonlySet<string> = new Set(["out_of_office", "bounce"]);

/** A reply older than this is never auto-answered — a human should look first. */
export const AUTO_SEND_MAX_REPLY_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTO_SEND_DAILY_CAP = 25;
/** Upper bound on one awaited send; the senders call slow third-party APIs. */
export const AUTO_SEND_TIMEOUT_MS = 60_000;

export type AutoSendTarget = "send-agent-reply" | "send-smartlead-email" | "send-heyreach-message";

/**
 * Which sender handles a lead. SOURCE decides; channel only has to be one that
 * sender can deliver on. Everything else is held for a human.
 *
 *   reply_io  + email | linkedin -> send-agent-reply   (Reply.io thread reply, both channels)
 *   smartlead + email            -> send-smartlead-email
 *   heyreach  + linkedin         -> send-heyreach-message
 */
export function routeAutoSend(source: string | null | undefined, channel: string | null | undefined): AutoSendTarget | null {
  const s = String(source ?? "").trim().toLowerCase();
  const c = String(channel ?? "").trim().toLowerCase();
  if (s === "reply_io" && (c === "email" || c === "linkedin")) return "send-agent-reply";
  if (s === "smartlead" && c === "email") return "send-smartlead-email";
  if (s === "heyreach" && c === "linkedin") return "send-heyreach-message";
  return null;
}

export type HoldReason =
  | "opted_out"
  | "intent_not_auto_sendable"
  | "no_draft"
  | "reply_too_old"
  | "reply_time_unknown"
  | "already_replied"
  | "unknown_source"
  | "channel_not_supported"
  | "daily_cap";

export type AutoSendDecision =
  | { action: "suppress" }
  | { action: "hold"; reason: HoldReason }
  | { action: "send"; target: AutoSendTarget };

export interface ThreadEntry {
  role?: string | null;
  timestamp?: string | null;
}

/**
 * True when the newest message in the thread is ours: the latest prospect
 * message has already been answered, so another send would double-reply.
 */
export function alreadyReplied(thread: unknown): boolean {
  const arr = Array.isArray(thread) ? (thread as ThreadEntry[]) : [];
  let latestProspect = -Infinity;
  let latestOurs = -Infinity;
  for (const m of arr) {
    const t = m?.timestamp ? Date.parse(m.timestamp) : NaN;
    if (!Number.isFinite(t)) continue;
    const role = String(m?.role ?? "").toLowerCase();
    if (role === "prospect") latestProspect = Math.max(latestProspect, t);
    else if (role === "sender" || role === "agent" || role === "user") latestOurs = Math.max(latestOurs, t);
  }
  return latestOurs > -Infinity && latestOurs >= latestProspect;
}

export interface AutoSendInput {
  intent: string;
  draft: string | null | undefined;
  source: string | null | undefined;
  channel: string | null | undefined;
  dispositionTag: string | null | undefined;
  lastReplyAt: string | null | undefined;
  replyThread: unknown;
  sentToday: number;
  dailyCap: number;
  now?: number;
}

/**
 * Pure. The order is the order of the safety argument: compliance first
 * (opted out), then "should this ever be automatic" (intent, draft, age,
 * already answered), then "can it be delivered" (route), then volume (cap).
 */
export function decideAutoSend(i: AutoSendInput): AutoSendDecision {
  const now = i.now ?? Date.now();
  if (SUPPRESS_INTENTS.has(i.intent)) return { action: "suppress" };
  if ((i.dispositionTag ?? "") === "opted_out") return { action: "hold", reason: "opted_out" };
  if (!AUTO_SEND_INTENTS.has(i.intent)) return { action: "hold", reason: "intent_not_auto_sendable" };
  if (!(typeof i.draft === "string" && i.draft.trim().length > 0)) return { action: "hold", reason: "no_draft" };
  const replyAt = i.lastReplyAt ? Date.parse(i.lastReplyAt) : NaN;
  if (!Number.isFinite(replyAt)) return { action: "hold", reason: "reply_time_unknown" };
  if (now - replyAt > AUTO_SEND_MAX_REPLY_AGE_MS) return { action: "hold", reason: "reply_too_old" };
  if (alreadyReplied(i.replyThread)) return { action: "hold", reason: "already_replied" };
  const target = routeAutoSend(i.source, i.channel);
  if (!target) {
    const known = ["reply_io", "smartlead", "heyreach"].includes(String(i.source ?? "").toLowerCase());
    return { action: "hold", reason: known ? "channel_not_supported" : "unknown_source" };
  }
  if (i.sentToday >= Math.max(0, i.dailyCap)) return { action: "hold", reason: "daily_cap" };
  return { action: "send", target };
}

/** Each sender's own request shape (they predate this module and differ). */
export function buildSendBody(
  target: AutoSendTarget,
  a: { userId: string; leadId: string; message: string; intent: string },
): Record<string, unknown> {
  switch (target) {
    case "send-agent-reply":
      return { user_id: a.userId, leadId: a.leadId, draftResponse: a.message, intent: a.intent, auto: true };
    case "send-smartlead-email":
      return { user_id: a.userId, leadId: a.leadId, message: a.message, auto: true };
    case "send-heyreach-message":
      return { user_id: a.userId, lead_id: a.leadId, message: a.message, auto: true };
  }
}

/**
 * A send succeeded only when the sender says so: HTTP 2xx AND success === true.
 * send-agent-reply answers an opted-out contact with 200 + success:false +
 * handled:true — that is NOT a send, and must not be counted as one.
 */
export function interpretSendResult(status: number, body: unknown): { ok: true } | { ok: false; error: string; code: string | null } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300 && b.success === true) return { ok: true };
  const error = String(b.error ?? b.message ?? `HTTP ${status}`).slice(0, 500);
  const code = typeof b.code === "string" ? b.code : null;
  return { ok: false, error, code };
}

/** Start of the current UTC day — the cap resets at 00:00 UTC. */
export function utcDayStart(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/** Auto-sends today: the senders' own 'message_sent' activities marked sent_by=auto. */
export async function countAutoSendsToday(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  now = Date.now(),
): Promise<number> {
  const { count, error } = await supabase
    .from("agent_activity")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("activity_type", "message_sent")
    .eq("metadata->>sent_by", "auto")
    .gte("created_at", utcDayStart(now));
  if (error) throw new Error(`auto-send count failed: ${error.message}`);
  return count ?? 0;
}

export interface RunAutoPilotArgs {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  supabaseUrl: string;
  agentKey: string;
  userId: string;
  leadId: string;
  intent: string;
  draft: string | null | undefined;
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  now?: number;
}

export type AutoPilotOutcome =
  | { outcome: "suppressed" }
  | { outcome: "held"; reason: HoldReason | "lookup_failed" }
  | { outcome: "sent"; target: AutoSendTarget }
  | { outcome: "failed"; target: AutoSendTarget; error: string };

/**
 * Decide, route, send (awaited), record. Never throws: classify-reply has
 * already done its job, and a failure here must surface as data, not as a
 * lost classification.
 */
export async function runAutoPilot(a: RunAutoPilotArgs): Promise<AutoPilotOutcome> {
  const { supabase, userId, leadId } = a;
  const now = a.now ?? Date.now();
  const fetchFn = a.fetchFn ?? fetch;

  const activity = async (activity_type: string, description: string, metadata: Record<string, unknown>) => {
    const { error } = await supabase.from("agent_activity").insert({
      user_id: userId, lead_id: leadId, activity_type, description, metadata,
    });
    if (error) console.error(`[auto-pilot] activity ${activity_type} insert failed: ${error.message}`);
  };

  // Fresh read of exactly what the decision needs — not classify-reply's
  // context fetch, which may have been partial.
  const [{ data: lead, error: leadErr }, { data: cfg, error: cfgErr }] = await Promise.all([
    supabase.from("agent_leads")
      .select("source, channel, disposition_tag, last_reply_at, reply_thread, full_name")
      .eq("id", leadId).eq("user_id", userId).maybeSingle(),
    supabase.from("agent_configs")
      .select("auto_send_daily_cap")
      .eq("user_id", userId).eq("is_active", true).maybeSingle(),
  ]);
  if (leadErr || cfgErr || !lead) {
    const err = leadErr?.message ?? cfgErr?.message ?? "lead not found";
    console.error(`[auto-pilot] lookup failed for lead ${leadId}: ${err}`);
    await activity("auto_send_held", "Auto Pilot held this reply: could not load the lead or settings", { reason: "lookup_failed", error: err });
    return { outcome: "held", reason: "lookup_failed" };
  }

  const dailyCap = Number.isFinite(Number(cfg?.auto_send_daily_cap)) ? Number(cfg?.auto_send_daily_cap) : DEFAULT_AUTO_SEND_DAILY_CAP;
  let sentToday = 0;
  try {
    sentToday = await countAutoSendsToday(supabase, userId, now);
  } catch (e) {
    // Fail closed: an unknown count is not permission to send.
    sentToday = Number.POSITIVE_INFINITY;
    console.error(`[auto-pilot] ${e instanceof Error ? e.message : e}`);
  }

  const decision = decideAutoSend({
    intent: a.intent, draft: a.draft, source: lead.source, channel: lead.channel,
    dispositionTag: lead.disposition_tag, lastReplyAt: lead.last_reply_at, replyThread: lead.reply_thread,
    sentToday, dailyCap, now,
  });

  if (decision.action === "suppress") {
    // Unchanged from the previous handler: OOO / bounce are marked handled with
    // no outbound message.
    await supabase.from("agent_leads")
      .update({ inbox_status: "replied", draft_response: null, auto_handled: true })
      .eq("id", leadId).eq("user_id", userId);
    return { outcome: "suppressed" };
  }

  if (decision.action === "hold") {
    // The lead is already draft_ready (classify-reply wrote it); nothing to change.
    const why: Record<HoldReason, string> = {
      opted_out: "the contact has opted out",
      intent_not_auto_sendable: `intent "${a.intent}" is not auto-sendable`,
      no_draft: "there is no draft",
      reply_too_old: "the reply is more than 24h old",
      reply_time_unknown: "the reply time is unknown",
      already_replied: "this reply has already been answered",
      unknown_source: `lead source "${lead.source ?? "unknown"}" has no auto-sender`,
      channel_not_supported: `${lead.source} cannot send on channel "${lead.channel}"`,
      daily_cap: `the daily auto-send cap (${dailyCap}) is reached`,
    };
    await activity("auto_send_held", `Auto Pilot held this reply for approval: ${why[decision.reason]}`, {
      reason: decision.reason, intent: a.intent, source: lead.source, channel: lead.channel,
      ...(decision.reason === "daily_cap" ? { sent_today: sentToday, daily_cap: dailyCap } : {}),
    });
    return { outcome: "held", reason: decision.reason };
  }

  const target = decision.target;
  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetchFn(`${a.supabaseUrl}/functions/v1/${target}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": a.agentKey },
      body: JSON.stringify(buildSendBody(target, { userId, leadId, message: String(a.draft), intent: a.intent })),
      signal: AbortSignal.timeout(AUTO_SEND_TIMEOUT_MS),
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (e) {
    body = { error: `request to ${target} failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const result = interpretSendResult(status, body);
  if (result.ok) {
    console.log(`[auto-pilot] sent lead=${leadId} via ${target}`);
    return { outcome: "sent", target };
  }

  // The sender failed or refused. The lead stays draft_ready for a human (the
  // sender writes nothing on failure; on an opted-out refusal it has already
  // tagged and dismissed the lead itself) and the reason is recorded where the
  // operator will see it.
  console.error(`[auto-pilot] send failed lead=${leadId} via ${target}: ${result.error}`);
  await activity("auto_send_failed", `Auto Pilot could not send this reply: ${result.error}`, {
    target, status, error: result.error, code: result.code, intent: a.intent, source: lead.source, channel: lead.channel,
  });
  return { outcome: "failed", target, error: result.error };
}
