// Shared inbox-reply helpers for the two Reply.io ingestion paths (reply-webhook
// + poll-reply-inbox). Keeps "should a new reply resurface the lead + draft?"
// and the classify-reply invocation identical across both.

// Disposition tags the operator used to permanently sideline a lead. A new reply
// must NOT drag these back into Pending Approval (and classify-reply also
// early-returns for opted_out — this is the ingestion-side guard).
export const SUPPRESSED_TAGS = ['opted_out', 'not_relevant'];
export function isSuppressed(dispositionTag: string | null | undefined): boolean {
  return SUPPRESSED_TAGS.includes(String(dispositionTag ?? ''));
}

export interface ThreadEntry {
  role?: string;
  content?: string;
  timestamp?: string;
}
export function newestEntry(thread: unknown): ThreadEntry | null {
  if (!Array.isArray(thread) || thread.length === 0) return null;
  return thread[thread.length - 1] as ThreadEntry;
}

// Decide whether an ingested reply should (re)surface the lead to 'pending' and
// trigger a draft. Resurface ONLY when:
//   * the lead is NOT suppressed (opted_out / not_relevant), AND
//   * the newest thread entry is an unanswered prospect reply, AND
//   * it is genuinely newer than what we already recorded (newerThanPrior) — the
//     re-delivery / re-poll guard, computed by the caller (webhook: content
//     dedup; poll: newest prospect timestamp > prior last_reply_at).
export function shouldResurface(opts: {
  dispositionTag: string | null | undefined;
  newestRole: string | null | undefined;
  newerThanPrior: boolean;
}): boolean {
  if (isSuppressed(opts.dispositionTag)) return false;
  if (opts.newestRole !== 'prospect') return false;
  return opts.newerThanPrior;
}

// deno-lint-ignore no-explicit-any
type AgentConfig = Record<string, any>;

// Fire-and-forget classify-reply — builds the exact body both ingestion paths
// use. Call ONLY when a lead is (re)surfaced to 'pending'.
export function fireClassifyReply(opts: {
  supabaseUrl: string;
  agentKey: string;
  leadId: string;
  replyText: string;
  threadHistory: unknown;
  agentConfig: AgentConfig;
  channel: string;
  userId: string;
}): void {
  const c = opts.agentConfig;
  fetch(`${opts.supabaseUrl}/functions/v1/classify-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': opts.agentKey },
    body: JSON.stringify({
      reply_text: opts.replyText,
      thread_history: opts.threadHistory,
      lead_id: opts.leadId,
      agent_context: {
        offer_description: c.offer_description,
        desired_action: c.desired_action,
        outcome_delivered: c.outcome_delivered,
        target_icp: c.target_icp,
        sender_name: c.sender_name,
        sender_title: c.sender_title,
        sender_linkedin: c.sender_linkedin || '',
        sender_bio: c.sender_bio,
        company_name: c.company_name,
        company_url: c.company_url,
        communication_style: c.communication_style,
        avoid_phrases: c.avoid_phrases || [],
        sample_message: c.sample_message || '',
        calendar_link: c.calendar_link || '',
        pricing_summary: c.pricing_summary || '',
        case_studies: c.case_studies || '',
        disqualification_criteria: c.disqualification_criteria || '',
        objection_handling_notes: c.objection_handling_notes || '',
      },
      channel: opts.channel,
      user_id: opts.userId,
    }),
  }).catch((err) => console.error('[classify-reply] fire-and-forget error:', err));
}
