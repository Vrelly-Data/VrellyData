/**
 * Signals audience filter vocabulary — the client half.
 *
 * The server half, which validates and compiles these, is
 * supabase/functions/_shared/signal-audience.ts. It rejects unknown keys,
 * verticals and seniorities, so a drift here shows up as a 400 on preview,
 * never as a silently wider audience.
 */

/** agent_audiences.filters for source='signals' (filters_version 3). */
export interface SignalAudienceFilters {
  verticals?: string[];
  signal_types?: string[];
  recency_days?: number;
  min_score?: number;
  fda?: { product_codes?: string[]; device_keywords?: string[]; states?: string[] };
  hiring?: { role_keywords?: string[] };
  github?: { topics?: string[] };
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

/** Verticals an audience can draw on; private equity is admin-only and the server enforces it. */
export const SIGNAL_VERTICAL_OPTIONS = [
  { value: 'medical_device', label: 'Medical devices (510(k))' },
  { value: 'saas_hiring', label: 'SaaS hiring' },
  { value: 'github', label: 'GitHub activity' },
  { value: 'web_visitors', label: 'Website visitors' },
  { value: 'private_equity', label: 'Private equity (admin)' },
];

export const DEFAULT_SIGNAL_FILTERS: SignalAudienceFilters = {
  // Apollo (paid) is opt-in per audience.
  recency_days: 30, min_score: 0, max_per_company: 2, use_apollo: false, us_only: true, persona: {},
};

/** The server requires someone to reach: a title, a seniority or a department. */
export function hasSignalPersona(f: SignalAudienceFilters | null | undefined): boolean {
  const p = f?.persona;
  return !!p && [p.job_titles, p.seniorities, p.departments].some((xs) => (xs ?? []).some((x) => String(x).trim() !== ''));
}

/** Prefill for "Build audience from these": the selection's verticals, a window covering its oldest signal. */
export function filtersFromSelection(signals: Array<{ vertical: string; occurred_at: string }>, now = Date.now()): SignalAudienceFilters {
  const verticals = [...new Set(signals.map((s) => s.vertical))];
  const oldest = Math.min(...signals.map((s) => Date.parse(s.occurred_at)).filter(Number.isFinite));
  const days = Number.isFinite(oldest) ? Math.ceil((now - oldest) / 86_400_000) + 1 : 30;
  return { ...DEFAULT_SIGNAL_FILTERS, verticals, recency_days: Math.min(365, Math.max(1, days)) };
}

export const PERSON_SOURCE_LABEL: Record<'vrelly' | 'signal' | 'apollo', string> = {
  vrelly: 'Vrelly',
  signal: 'Signal',
  apollo: 'Apollo',
};
