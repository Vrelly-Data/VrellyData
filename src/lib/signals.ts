// Signals — shared types and presentation helpers for the admin tab and the
// client Agent → Signals view. Data access lives in src/hooks/useSignals.ts;
// every count/aggregate comes from SQL functions (signals_overview,
// signals_feed, signals_breakdown, signals_admin_source_stats), never from
// paging rows here. Type / market vocabulary: ./signalCatalog.ts.

export type SignalStatus = 'new' | 'reviewed' | 'dismissed' | 'pushed';

/**
 * A row as signals_feed returns it. `type` is the PUBLIC key (high_intent, …).
 * The admin-only fields are present only for platform admins.
 */
export type SignalRow = {
  id: string;
  type: string;
  markets: string[];
  occurred_at: string;
  company_name: string | null;
  company_domain: string | null;
  person_name: string | null;
  person_title: string | null;
  person_email: string | null;
  person_linkedin: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  seniority: string | null;
  company_size: string | null;
  title: string;
  url: string | null;
  score: number;
  payload: Record<string, unknown>;
  team_status: SignalStatus;
  status_updated_at: string | null;
  created_at: string;
  // admin only
  signal_type?: string;
  source_key?: string;
  visibility?: 'admin' | 'all_clients' | 'team';
  team_id?: string | null;
  team_name?: string | null;
  enrichment?: Record<string, unknown>;
  admin_detail?: Record<string, unknown> | null;
};

/** Per-type counts (public type key). */
export type TypeCount = { type: string; today: number; d7: number; d30: number; total: number; new: number };

export type BreakdownItem = { value: string; count: number };
export type SignalBreakdown = {
  total: number;
  industry: BreakdownItem[];
  seniority: BreakdownItem[];
  title: BreakdownItem[];
  state: BreakdownItem[];
  country: BreakdownItem[];
  company_size: BreakdownItem[];
  platform?: BreakdownItem[];
  campaign?: BreakdownItem[];
};

export type SignalSettings = { team_id: string | null; country: string; default_market: string | null; is_admin: boolean };

export type TeamSignalSettings = {
  team_id: string; name: string; default_market: string | null; country: string | null; apollo_enrich: boolean; high_intent: number;
};

export type SignalSource = {
  id: string;
  key: string;
  signal_type: string;
  default_markets: string[];
  name: string;
  kind: 'api' | 'internal' | 'pixel';
  cadence: 'hourly' | 'daily' | 'realtime';
  default_visibility: 'admin' | 'all_clients' | 'team';
  function_name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  items_last_run: number | null;
};

export type SignalRun = {
  id: string;
  source_key: string;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  deduped: number;
  error: string | null;
  detail: Record<string, unknown>;
};

export type SourceStats = { source_key: string; total: number; today: number; d7: number; d30: number; latest: string | null };

export type SignalSite = { site_key: string; team_id: string; domain: string; is_active: boolean; created_at: string };

/** signals_feed / signals_breakdown p_filters (all optional; see the migration). */
export type SignalFilters = {
  type?: string | null;
  markets?: string[] | null;
  from?: string | null;
  to?: string | null;
  min_score?: number | null;
  status?: SignalStatus | null;
  state?: string | null;
  country?: string | null;
  include_unknown_country?: boolean;
  search?: string | null;
  // breakdown clicks (exact; '(unknown)' matches blanks)
  industry?: string | null;
  seniority?: string | null;
  title?: string | null;
  company_size?: string | null;
  breakdown_state?: string | null;
  breakdown_country?: string | null;
  // admin only (ignored for clients)
  platform?: string | null;
  campaign?: string | null;
  source_key?: string | null;
};

/** Drops empty values so the SQL sees only real filters. */
export function compactFilters(f: SignalFilters): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) =>
    v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
}

export const VISIBILITY_LABEL: Record<'admin' | 'all_clients' | 'team', string> = {
  admin: 'Admin only',
  all_clients: 'All clients',
  team: 'Your team',
};

export function scoreTone(score: number): 'high' | 'mid' | 'low' {
  return score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
}

export function locationOf(r: Pick<SignalRow, 'city' | 'state' | 'country'>): string {
  return [r.city, r.state, r.country].filter(Boolean).join(', ');
}

export function trackEndpoint(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/track`;
}

/**
 * The copy-paste pixel. sendBeacon with text/plain avoids a CORS preflight;
 * anon_id is a random id kept in localStorage (no cookie). Page views only —
 * SPA route changes are not tracked by this snippet.
 */
export function pixelSnippet(siteKey: string, endpoint = trackEndpoint()): string {
  return `<!-- Vrelly website visitors -->
<script>
(function(){var k=${JSON.stringify(siteKey)},e=${JSON.stringify(endpoint)},a=null;
try{a=localStorage.getItem("_vrl_aid");if(!a){a=(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g,"");localStorage.setItem("_vrl_aid",a)}}catch(_){}
var b=JSON.stringify({site_key:k,url:location.href,referrer:document.referrer||null,ts:new Date().toISOString(),anon_id:a});
if(navigator.sendBeacon){navigator.sendBeacon(e,new Blob([b],{type:"text/plain"}))}else{fetch(e,{method:"POST",body:b,keepalive:true,mode:"no-cors"})}})();
</script>`;
}

export const PIXEL_PRIVACY_NOTE =
  'Before adding the snippet, update your privacy policy (and cookie banner where required, e.g. for EU/UK visitors): ' +
  'it stores a random visitor id in the browser’s local storage and sends the page URL, referrer and user agent to Vrelly. ' +
  'IP addresses are hashed with a secret and never stored. Visitor identification is not enabled yet; if it is, ' +
  'your disclosure must say that a third-party service may identify visiting companies.';
