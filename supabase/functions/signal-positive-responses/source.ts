// positive_response ("High Intent" to clients) — people who replied
// 'interested' to ANY team's outbound, on any platform (Reply.io, Smartlead,
// HeyReach, and the historical backfills).
//
// Internal source: reads public.inference_events through
// signals_positive_candidates, ONE row per (team, person_key) with the newest
// non-empty value of each field. The team is the client that received the
// reply (signals_hi_team): inference_events.team_id; else, for backfill rows,
// config.backfill_team_map (source → team) or the Reply.io account
// (metadata.provider_team_id → outbound_integrations.reply_team_id). A reply
// no team can be found for becomes an ADMIN-only signal; it is never guessed
// onto a client.
//
// NAMING. Clients see only: "High intent: <Name>, <Title> at <Company>", the
// who/where columns, industry/seniority/size and markets. The reply excerpt,
// campaign, platform, channel and inference source go to admin_detail
// (signal_admin_details, admin-only), never to title / payload / url.
//
// The first run (no previous success) takes every interested row; later runs
// take people with an interested row since the last success minus 2 days.
// After the write, enrichPositiveResponses fills missing firmographics
// (../_shared/signal-enrichment.ts) for new and changed signals.

import {
  clampScore, collapseSpaces, dedupeKey, type FetchResult, normalizeDomain, type SignalInput, type SourceContext, toIso,
} from "../_shared/signals.ts";
import { highIntentTitle } from "../_shared/signal-catalog.ts";
import { assignMarkets } from "../_shared/signal-markets.ts";
import { APOLLO_MAX_PER_RUN, enrichHighIntent, type EnrichTarget } from "../_shared/signal-enrichment.ts";
import { supabaseEnrichDeps } from "../_shared/signal-enrichment-supabase.ts";

export interface PositiveCandidate {
  scope_key: string;
  team_id: string | null;
  team_default_market?: string | null;
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
  keywords?: string | null;
  platform?: string | null;
  channel?: string | null;
  campaign_name?: string | null;
  source?: string | null;
  reply_text?: string | null;
}

const OWNER_TITLE = /\b(owner|co-?owner|founder|co-?founder|ceo|chief executive|president|principal|managing (partner|director|member)|proprietor)\b/i;

export function scorePositive(c: Pick<PositiveCandidate, "job_title" | "last_at">, now: number): number {
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

export function mapPositiveCandidate(c: PositiveCandidate, now = Date.now()): SignalInput | null {
  const occurred = toIso(c.last_at);
  if (!c.person_key || !occurred) return null;
  const name = collapseSpaces(c.full_name);
  const title = collapseSpaces(c.job_title);
  const company = collapseSpaces(c.company_name);
  const industry = collapseSpaces(c.industry);
  return {
    signal_type: "positive_response",
    occurred_at: occurred,
    dedupe_key: dedupeKey("hi", c.team_id ?? "admin", c.person_key),
    title: highIntentTitle({ name, title, company }),
    url: null,
    score: scorePositive(c, now),
    markets: assignMarkets({
      signal_type: "positive_response", industry, keywords: c.keywords ?? null, team_default_market: c.team_default_market ?? null,
    }),
    company_name: company,
    company_domain: normalizeDomain(c.company_domain),
    person_name: name,
    person_title: title,
    person_email: collapseSpaces(c.email)?.toLowerCase() ?? null,
    person_linkedin: collapseSpaces(c.linkedin_url),
    city: collapseSpaces(c.city),
    state: collapseSpaces(c.state),
    country: collapseSpaces(c.country),
    industry,
    seniority: collapseSpaces(c.seniority),
    company_size: collapseSpaces(c.company_size),
    visibility: c.team_id ? "team" : "admin",
    team_id: c.team_id ?? null,
    // Client-visible: deliberately nothing about how this was found.
    payload: {},
    admin_detail: {
      person_key: c.person_key,
      reply_excerpt: collapseSpaces(c.reply_text),
      reply_date: occurred,
      first_interested_at: toIso(c.first_at ?? null),
      interested_rows: c.interested_rows ?? null,
      platform: collapseSpaces(c.platform),
      channel: c.channel ?? null,
      campaign_name: collapseSpaces(c.campaign_name),
      inference_source: c.source ?? null,
    },
  };
}

export const OVERLAP_MS = 2 * 86_400_000;

export async function fetchPositiveResponses(ctx: SourceContext): Promise<FetchResult> {
  const pageSize = Number(ctx.config.page_size ?? 500);
  const since = ctx.lastSuccessAt ? new Date(Date.parse(ctx.lastSuccessAt) - OVERLAP_MS).toISOString() : null;
  const signals: SignalInput[] = [];
  let fetched = 0, pages = 0, after: string | null = null;
  for (;;) {
    const { data, error } = await ctx.supabase.rpc("signals_positive_candidates", {
      p_config: ctx.config, p_since: since, p_after: after, p_limit: pageSize,
    });
    if (error) {
      return { signals, fetched, error: `signals_positive_candidates: ${error.message}`, detail: { since, pages, backfill: since === null } };
    }
    const rows = (data ?? []) as PositiveCandidate[];
    pages++;
    fetched += rows.length;
    for (const r of rows) {
      const s = mapPositiveCandidate(r, ctx.now);
      if (s) signals.push(s);
    }
    if (rows.length < pageSize) break;
    after = rows[rows.length - 1].scope_key;
  }
  const teams = new Set(signals.map((s) => s.team_id ?? "admin"));
  return { signals, fetched, detail: { since, pages, backfill: since === null, scopes: teams.size } };
}

// ------------------------------------------------------------ enrichment ---

interface QueueRow {
  signal_id: string;
  team_id: string | null;
  team_default_market: string | null;
  person_key: string;
  person_name: string | null;
  company_name: string | null;
  company_domain: string | null;
  email: string | null;
  linkedin: string | null;
  industry: string | null;
  person_title: string | null;
  seniority: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  company_size: string | null;
  keywords: string | null;
  apollo_done: boolean;
  free_done: boolean;
}

export function queueRowToTarget(q: QueueRow): EnrichTarget {
  return {
    signal_id: q.signal_id, team_id: q.team_id, person_key: q.person_key, person_name: q.person_name,
    company_name: q.company_name, company_domain: q.company_domain, email: q.email, linkedin: q.linkedin,
    team_default_market: q.team_default_market, apollo_done: q.apollo_done, free_done: q.free_done,
    keywords: q.keywords ? [q.keywords] : null,
    current: {
      industry: q.industry, person_title: q.person_title, seniority: q.seniority,
      city: q.city, state: q.state, country: q.country, company_size: q.company_size,
    },
  };
}

/**
 * After every write: enrich the queue (new signals, signals changed since
 * their last enrichment, and — for teams with Apollo on — signals Apollo has
 * not finished). Free steps always; Apollo per the team's opt-in and budget.
 */
export async function enrichPositiveResponses(ctx: SourceContext): Promise<{ detail?: Record<string, unknown>; error?: string | null }> {
  const batch = Math.max(1, Math.min(5000, Number(ctx.config.enrich_batch ?? 500)));
  const { data, error } = await ctx.supabase.rpc("signals_hi_enrichment_queue", { p_limit: batch });
  if (error) return { error: `signals_hi_enrichment_queue: ${error.message}` };
  const targets = ((data ?? []) as QueueRow[]).map(queueRowToTarget);
  if (!targets.length) return { detail: { enrich_queue: 0 } };

  const summary = await enrichHighIntent(targets, supabaseEnrichDeps(ctx.supabase, ctx.fetchFn), {
    apolloMaxPerRun: Number(ctx.config.apollo_max_per_run ?? APOLLO_MAX_PER_RUN),
  });

  let applied = 0, writtenBack = 0;
  const errors = [...summary.errors];
  const rows = summary.results.map((r) => ({
    signal_id: r.signal_id, values: r.values, filled: r.filled, markets: r.markets, title: r.title,
    apollo_status: r.apollo_status,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { data: out, error: aErr } = await ctx.supabase.rpc("signals_hi_apply_enrichment", {
      p_rows: rows.slice(i, i + 500), p_config: ctx.config,
    });
    if (aErr) {
      errors.push(`signals_hi_apply_enrichment: ${aErr.message}`);
      break;
    }
    applied += Number(out?.signals ?? 0);
    writtenBack += Number(out?.inference_rows ?? 0);
  }
  return {
    detail: {
      enrich_queue: targets.length, enriched: applied, free_fields_filled: summary.free_filled,
      apollo_records: summary.apollo_records, apollo_matched: summary.apollo_matched,
      apollo_credits: summary.credits_spent, apollo_insufficient_credits: summary.insufficient_credits,
      inference_rows_written_back: writtenBack,
    },
    error: errors.length ? errors.join("; ").slice(0, 1000) : null,
  };
}
