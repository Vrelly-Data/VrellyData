// Turns the raw inference_events projections into one ReplyRow per reply. Pure, so the joins
// (intent from classification, send time from the backfill's sent events) can be tested.
import { ReplyRow, cleanSubject, originOf } from '@/lib/inferenceAnalytics';
import { num } from '@/lib/liveFeed';

export type RawReply = {
  id: string;
  team_id: string | null;
  person_key: string;
  channel: string;
  occurred_at: string;
  source: string;
  intent: string | null;
  job_title: string | null;
  seniority: string | null;
  industry: string | null;
  company_size: string | null;
  state: string | null;
  copy_fingerprint: string | null;
  subject: string | null;
  hours_to_reply: unknown;
  reply_hour: unknown;
  reply_dow: unknown;
  step_number: unknown;
  sequence_number: unknown;
  variant_id: unknown;
  reply_subject: string | null;
  thread_id: string | null;
  backfill: string | null;
};
export type RawSend = { thread_id: string | null; send_hour: unknown; send_dow: unknown };
export type RawClassified = { team_id: string | null; person_key: string; intent: string | null; occurred_at: string };

export function assembleReplyRows(replies: RawReply[], sends: RawSend[], classified: RawClassified[]): ReplyRow[] {
  const sendByThread = new Map<string, { hour: number | null; dow: number | null }>();
  for (const s of sends) {
    if (s.thread_id) sendByThread.set(s.thread_id, { hour: num(s.send_hour), dow: num(s.send_dow) });
  }
  // Live replies mostly carry no intent; take the person's newest classification
  const intentByPerson = new Map<string, { intent: string; at: string }>();
  for (const c of classified) {
    const key = `${c.team_id ?? ''}|${c.person_key}`;
    const prev = intentByPerson.get(key);
    if (c.intent && (!prev || prev.at < c.occurred_at)) intentByPerson.set(key, { intent: c.intent, at: c.occurred_at });
  }

  return replies.map((r) => {
    const send = r.thread_id ? sendByThread.get(r.thread_id) : undefined;
    const variant = r.variant_id === null || r.variant_id === undefined ? null : String(r.variant_id);
    return {
      id: r.id,
      origin: originOf(r.source, r.backfill),
      channel: r.channel,
      occurredAt: r.occurred_at,
      intent: r.intent ?? intentByPerson.get(`${r.team_id ?? ''}|${r.person_key}`)?.intent ?? null,
      industry: r.industry,
      companySize: r.company_size,
      seniority: r.seniority,
      jobTitle: r.job_title,
      state: r.state,
      step: num(r.step_number) ?? num(r.sequence_number),
      sendHour: send?.hour ?? null,
      sendDow: send?.dow ?? null,
      replyHour: num(r.reply_hour),
      replyDow: num(r.reply_dow),
      hoursToReply: num(r.hours_to_reply),
      copyKey: r.copy_fingerprint ?? variant,
      copyLabel: cleanSubject(r.subject ?? r.reply_subject),
    };
  });
}
