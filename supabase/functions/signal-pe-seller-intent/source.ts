// private_equity / seller_intent — SourceCo prospects who replied 'interested'.
//
// Internal source: reads public.inference_events through
// signals_pe_candidates (one row per person_key, newest values first), which
// takes its SourceCo scope from config (backfill_sources + team_ids). The
// first run (no previous success) is the one-time backfill of every existing
// row; later runs take people with an interested row since the last success
// minus a 2-day overlap. ALWAYS admin-only: SourceCo client data.

import { clampScore, collapseSpaces, dedupeKey, type FetchResult, normalizeDomain, type SignalInput, type SourceContext, toIso } from "../_shared/signals.ts";

export interface PeCandidate {
  person_key: string;
  last_at: string;
  first_at?: string | null;
  interested_rows?: number | null;
  full_name?: string | null;
  job_title?: string | null;
  seniority?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  industry?: string | null;
  company_size?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  channel?: string | null;
  campaign_name?: string | null;
  source?: string | null;
  reply_text?: string | null;
}

const OWNER_TITLE = /\b(owner|co-?owner|founder|co-?founder|ceo|chief executive|president|principal|managing (partner|director|member)|proprietor)\b/i;

export function scorePe(c: PeCandidate, now: number): number {
  let s = 35;
  if (OWNER_TITLE.test(c.job_title ?? "")) s += 30;
  const at = Date.parse(c.last_at);
  const days = Number.isFinite(at) ? (now - at) / 86_400_000 : Infinity;
  if (days <= 7) s += 35;
  else if (days <= 30) s += 25;
  else if (days <= 90) s += 15;
  else if (days <= 365) s += 5;
  return clampScore(s);
}

export function mapPeCandidate(c: PeCandidate, now = Date.now()): SignalInput | null {
  const occurred = toIso(c.last_at);
  if (!c.person_key || !occurred) return null;
  const name = collapseSpaces(c.full_name);
  const company = collapseSpaces(c.company_name);
  const excerpt = collapseSpaces(c.reply_text);
  const who = [name, collapseSpaces(c.job_title)].filter(Boolean).join(", ") || "A SourceCo prospect";
  return {
    signal_type: "seller_intent",
    occurred_at: occurred,
    dedupe_key: dedupeKey("pe", c.person_key),
    title: `${who}${company ? ` at ${company}` : ""} replied interested`.slice(0, 500),
    url: null,
    score: scorePe(c, now),
    company_name: company,
    company_domain: normalizeDomain(c.company_domain),
    person_name: name,
    person_title: collapseSpaces(c.job_title),
    person_email: collapseSpaces(c.email)?.toLowerCase() ?? null,
    person_linkedin: collapseSpaces(c.linkedin_url),
    city: collapseSpaces(c.city),
    state: collapseSpaces(c.state),
    country: collapseSpaces(c.country),
    visibility: "admin",
    payload: {
      person_key: c.person_key,
      industry: collapseSpaces(c.industry),
      company_size: collapseSpaces(c.company_size),
      seniority: collapseSpaces(c.seniority),
      reply_excerpt: excerpt,
      reply_date: occurred,
      first_interested_at: toIso(c.first_at ?? null),
      interested_rows: c.interested_rows ?? null,
      channel: c.channel ?? null,
      campaign_name: collapseSpaces(c.campaign_name),
      inference_source: c.source ?? null,
    },
  };
}

export const PE_OVERLAP_MS = 2 * 86_400_000;

export async function fetchPeSellerIntent(ctx: SourceContext): Promise<FetchResult> {
  const pageSize = Number(ctx.config.page_size ?? 500);
  const since = ctx.lastSuccessAt ? new Date(Date.parse(ctx.lastSuccessAt) - PE_OVERLAP_MS).toISOString() : null;
  const signals: SignalInput[] = [];
  let fetched = 0, pages = 0, after: string | null = null;
  for (;;) {
    const { data, error } = await ctx.supabase.rpc("signals_pe_candidates", {
      p_config: ctx.config, p_since: since, p_after: after, p_limit: pageSize,
    });
    if (error) {
      return { signals, fetched, error: `signals_pe_candidates: ${error.message}`, detail: { since, pages, backfill: since === null } };
    }
    const rows = (data ?? []) as PeCandidate[];
    pages++;
    fetched += rows.length;
    for (const r of rows) {
      const s = mapPeCandidate(r, ctx.now);
      if (s) signals.push(s);
    }
    if (rows.length < pageSize) break;
    after = rows[rows.length - 1].person_key;
  }
  return { signals, fetched, detail: { since, pages, backfill: since === null } };
}
