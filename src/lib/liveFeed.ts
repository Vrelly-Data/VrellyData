// Pure shaping for the Admin → Inference Live Feed: one card per reply, enriched with its
// classification (which carries the intent), plus a per-card completeness check.
import { cleanSubject } from '@/lib/inferenceAnalytics';

export type LiveEvent = {
  id: string;
  team_id: string | null;
  person_key: string;
  event_type: string;
  channel: string;
  occurred_at: string;
  source: string;
  intent: string | null;
  full_name: string | null;
  job_title: string | null;
  company_name: string | null;
  industry: string | null;
  company_size: string | null;
  city: string | null;
  state: string | null;
  seniority: string | null;
  campaign_name: string | null;
  copy_fingerprint: string | null;
  subject: string | null;
  metadata: Record<string, unknown> | null;
};

export const COMPLETENESS_FIELDS = ['title', 'industry', 'size', 'city', 'step', 'variant'] as const;
export type CompletenessField = (typeof COMPLETENESS_FIELDS)[number];
export const COMPLETENESS_LABELS: Record<CompletenessField, string> = {
  title: 'Title',
  industry: 'Industry',
  size: 'Size',
  city: 'City',
  step: 'Step',
  variant: 'Variant',
};

export type LiveCard = {
  id: string;
  kind: 'reply' | 'classification'; // classification = no reply event in view for this person
  occurredAt: string;
  channel: string;
  intent: string | null;
  sources: string[];
  name: string | null;
  title: string | null;
  company: string | null;
  industry: string | null;
  companySize: string | null;
  city: string | null;
  state: string | null;
  seniority: string | null;
  campaign: string | null;
  step: number | null;
  variant: string | null; // copy fingerprint or variant id
  subject: string | null;
  hoursToReply: number | null;
  snippet: string | null;
  completeness: Record<CompletenessField, boolean>;
};

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const meta = (e: LiveEvent | undefined, key: string): unknown => (e?.metadata ? e.metadata[key] : undefined);

function first<T>(...values: Array<T | null | undefined>): T | null {
  for (const v of values) if (v !== null && v !== undefined) return v;
  return null;
}

function buildCard(kind: LiveCard['kind'], primary: LiveEvent, cls?: LiveEvent): LiveCard {
  const pick = (f: (e: LiveEvent) => string | null) => first(text(f(primary)), cls ? text(f(cls)) : null);
  const card: Omit<LiveCard, 'completeness'> = {
    id: primary.id,
    kind,
    occurredAt: primary.occurred_at,
    channel: primary.channel,
    intent: first(text(primary.intent), cls ? text(cls.intent) : null),
    sources: [...new Set([primary.source, cls?.source].filter(Boolean) as string[])],
    name: pick((e) => e.full_name),
    title: pick((e) => e.job_title),
    company: pick((e) => e.company_name),
    industry: pick((e) => e.industry),
    companySize: pick((e) => e.company_size),
    city: pick((e) => e.city),
    state: pick((e) => e.state),
    seniority: pick((e) => e.seniority),
    campaign: pick((e) => e.campaign_name),
    step: first(
      num(meta(primary, 'sequence_step_number')),
      num(meta(primary, 'sequence_number')),
      num(meta(cls, 'sequence_step_number')),
      num(meta(cls, 'sequence_number')),
    ),
    variant: first(
      text(primary.copy_fingerprint),
      text(meta(primary, 'variant_id')),
      cls ? text(cls.copy_fingerprint) : null,
      text(meta(cls, 'variant_id')),
    ),
    subject: cleanSubject(
      first(text(primary.subject), text(meta(primary, 'subject')), text(meta(primary, 'reply_subject'))),
    ),
    hoursToReply: first(num(meta(primary, 'hours_to_reply')), num(meta(cls, 'hours_to_reply'))),
    snippet: first(text(meta(primary, 'reply_text')), text(meta(cls, 'reply_text'))),
  };
  return {
    ...card,
    completeness: {
      title: !!card.title,
      industry: !!card.industry,
      size: !!card.companySize,
      city: !!card.city,
      step: card.step !== null,
      variant: !!card.variant,
    },
  };
}

const personKey = (e: LiveEvent) => `${e.team_id ?? ''}|${e.person_key}`;

// Replies become cards; each takes intent (and any missing context) from the newest
// classification of the same person. Classifications with no reply in view get their own card.
export function buildLiveCards(events: LiveEvent[]): LiveCard[] {
  const latestClassified = new Map<string, LiveEvent>();
  for (const e of events) {
    if (e.event_type !== 'classified') continue;
    const prev = latestClassified.get(personKey(e));
    if (!prev || prev.occurred_at < e.occurred_at) latestClassified.set(personKey(e), e);
  }
  const consumed = new Set<string>();
  const cards: LiveCard[] = [];
  for (const e of events) {
    if (e.event_type !== 'replied') continue;
    const cls = latestClassified.get(personKey(e));
    if (cls) consumed.add(cls.id);
    cards.push(buildCard('reply', e, cls));
  }
  for (const cls of latestClassified.values()) {
    if (!consumed.has(cls.id)) cards.push(buildCard('classification', cls));
  }
  return cards.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

export function isFullyEnriched(card: LiveCard): boolean {
  return COMPLETENESS_FIELDS.every((f) => card.completeness[f]);
}

export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Monday 00:00 local time
export function startOfWeek(now = new Date()): Date {
  const d = startOfToday(now);
  const isoDow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (isoDow - 1));
  return d;
}
