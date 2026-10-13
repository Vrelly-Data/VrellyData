/**
 * Signals audience filter vocabulary — the client half.
 *
 * The server half, which validates and compiles these, is
 * supabase/functions/_shared/signal-audience.ts. It rejects unknown keys,
 * types, markets and seniorities, so a drift here shows up as a 400 on
 * preview, never as a silently wider audience. Types are PUBLIC keys
 * (high_intent, …) — see ./signalCatalog.ts.
 */
import { ALL_MARKETS, LIVE_SIGNAL_TYPES } from './signalCatalog';

/** agent_audiences.filters for source='signals' (filters_version 3). */
export interface SignalAudienceFilters {
  /** Public type keys; empty = every type the user can see. */
  types?: string[];
  /** Markets, any of; empty = all. */
  markets?: string[];
  recency_days?: number;
  min_score?: number;
  fda?: { product_codes?: string[]; device_keywords?: string[]; states?: string[] };
  hiring?: { role_keywords?: string[] };
  product_launch?: { topics?: string[] };
  persona?: {
    job_titles?: string[];
    exclude_job_titles?: string[];
    seniorities?: string[];
    departments?: string[];
  };
  max_per_company?: number;
  use_apollo?: boolean;
  us_only?: boolean;
}

/** Signal types an audience can draw on (public labels). Visibility is enforced in SQL. */
export const SIGNAL_TYPE_OPTIONS = LIVE_SIGNAL_TYPES.map((t) => ({ value: t.key, label: t.label }));

export const SIGNAL_MARKET_OPTIONS = ALL_MARKETS.map((m) => ({ value: m.key, label: m.label }));

export const DEFAULT_SIGNAL_FILTERS: SignalAudienceFilters = {
  // Apollo (paid) is opt-in per audience.
  recency_days: 30, min_score: 0, max_per_company: 2, use_apollo: false, us_only: true, persona: {},
};

/** The server requires someone to reach: a title, a seniority or a department. */
export function hasSignalPersona(f: SignalAudienceFilters | null | undefined): boolean {
  const p = f?.persona;
  return !!p && [p.job_titles, p.seniorities, p.departments].some((xs) => (xs ?? []).some((x) => String(x).trim() !== ''));
}

/** Prefill for "Build audience from these": the selection's types, a window covering its oldest signal. */
export function filtersFromSelection(signals: Array<{ type: string; occurred_at: string }>, now = Date.now()): SignalAudienceFilters {
  const types = [...new Set(signals.map((s) => s.type))];
  const oldest = Math.min(...signals.map((s) => Date.parse(s.occurred_at)).filter(Number.isFinite));
  const days = Number.isFinite(oldest) ? Math.ceil((now - oldest) / 86_400_000) + 1 : 30;
  return { ...DEFAULT_SIGNAL_FILTERS, types, recency_days: Math.min(365, Math.max(1, days)) };
}

export const PERSON_SOURCE_LABEL: Record<'vrelly' | 'signal' | 'apollo', string> = {
  vrelly: 'Vrelly',
  signal: 'Signal',
  apollo: 'Apollo',
};
