/**
 * Signals catalog — the client half of supabase/functions/_shared/signal-catalog.ts.
 *
 * Two dimensions:
 *   TYPE   = what happened (primary tabs). Clients only ever see PUBLIC keys and
 *            labels: the internal positive_response is "High Intent" / high_intent.
 *            Never call it a positive response, an interested reply or similar.
 *   MARKET = who a signal is relevant to (filter chips, several per signal).
 */

export type SignalTypeKey =
  | 'high_intent' | 'fda_clearance' | 'hiring' | 'website_visit' | 'product_launch'
  | 'linkedin_post_keyword' | 'fast_growth';

export interface SignalTypeInfo {
  key: SignalTypeKey;
  label: string;
  /** One line, shown under the tab and in "coming soon" tabs. */
  description: string;
  comingSoon?: boolean;
}

/** Tab order. */
export const SIGNAL_TYPES: SignalTypeInfo[] = [
  { key: 'high_intent', label: 'High Intent', description: 'People showing strong buying intent toward your offer.' },
  { key: 'fda_clearance', label: 'FDA clearance', description: 'Companies that just received an FDA 510(k) clearance.' },
  { key: 'hiring', label: 'Hiring', description: 'Companies posting new roles on their job boards.' },
  { key: 'website_visit', label: 'Website visit', description: 'Visitors to your own website (your pixel).' },
  { key: 'product_launch', label: 'Product launch', description: 'New products and releases from software companies.' },
  { key: 'linkedin_post_keyword', label: 'LinkedIn posts (coming soon)', description: 'People posting on LinkedIn about topics you choose.', comingSoon: true },
  { key: 'fast_growth', label: 'Fast growth (coming soon)', description: 'Companies growing headcount quickly.', comingSoon: true },
];

export const LIVE_SIGNAL_TYPES = SIGNAL_TYPES.filter((t) => !t.comingSoon);

export function signalTypeLabel(key: string | null | undefined): string {
  const k = key === 'positive_response' ? 'high_intent' : key;
  return SIGNAL_TYPES.find((t) => t.key === k)?.label ?? (k ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export type MarketKey = 'private_equity' | 'medical_device' | 'saas' | 'recruiting' | 'other';

/** Chip order (after "All"). 'other' is a filter value but not a chip. */
export const MARKETS: Array<{ key: MarketKey; label: string }> = [
  { key: 'private_equity', label: 'Private Equity' },
  { key: 'medical_device', label: 'Medical Device' },
  { key: 'saas', label: 'SaaS' },
  { key: 'recruiting', label: 'Recruiting' },
];

export const ALL_MARKETS: Array<{ key: MarketKey; label: string }> = [...MARKETS, { key: 'other', label: 'Other' }];

export function marketLabel(key: string): string {
  return ALL_MARKETS.find((m) => m.key === key)?.label ?? key;
}

/** Country filter choices (ISO alpha-2). */
export const COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'US', label: 'United States' }, { code: 'CA', label: 'Canada' }, { code: 'GB', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' }, { code: 'DE', label: 'Germany' }, { code: 'FR', label: 'France' },
  { code: 'IE', label: 'Ireland' }, { code: 'NL', label: 'Netherlands' }, { code: 'IN', label: 'India' },
  { code: 'CN', label: 'China' }, { code: 'JP', label: 'Japan' }, { code: 'KR', label: 'South Korea' },
  { code: 'IL', label: 'Israel' }, { code: 'CH', label: 'Switzerland' }, { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' }, { code: 'MX', label: 'Mexico' }, { code: 'AE', label: 'United Arab Emirates' },
];
