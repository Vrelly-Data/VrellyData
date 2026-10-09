// Signals — shared types and presentation helpers for the admin tab and the
// client Agent → Signals view. Data access lives in src/hooks/useSignals.ts;
// every count/aggregate comes from SQL functions (signals_overview,
// signals_feed, signals_admin_source_stats), never from paging rows here.

export type SignalStatus = 'new' | 'reviewed' | 'dismissed' | 'pushed';

export type SignalRow = {
  id: string;
  source_key: string;
  vertical: string;
  signal_type: string;
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
  title: string;
  url: string | null;
  score: number;
  payload: Record<string, unknown>;
  visibility: 'admin' | 'all_clients' | 'team';
  team_status: SignalStatus;
  status_updated_at: string | null;
  created_at: string;
};

export type VerticalCount = { vertical: string; today: number; d7: number; d30: number; total: number; new: number };

export type SignalSource = {
  id: string;
  key: string;
  vertical: string;
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

export type SignalFilters = {
  vertical: string;
  from?: string | null;
  to?: string | null;
  minScore?: number | null;
  status?: SignalStatus | null;
  state?: string | null;
  country?: string | null;
  search?: string | null;
  sourceKey?: string | null;
};

// Known verticals get a friendly label; a new vertical (just a new
// signal_sources row) still shows, title-cased from its key.
const VERTICAL_LABELS: Record<string, string> = {
  private_equity: 'Private equity',
  medical_device: 'Medical devices',
  saas_hiring: 'SaaS hiring',
  github: 'GitHub',
  web_visitors: 'Website visitors',
};

export function verticalLabel(v: string): string {
  return VERTICAL_LABELS[v] ?? v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const VERTICAL_ORDER = ['medical_device', 'saas_hiring', 'github', 'private_equity', 'web_visitors'];
export function sortVerticals<T extends { vertical: string }>(rows: T[]): T[] {
  const rank = (v: string) => {
    const i = VERTICAL_ORDER.indexOf(v);
    return i === -1 ? VERTICAL_ORDER.length : i;
  };
  return [...rows].sort((a, b) => rank(a.vertical) - rank(b.vertical) || a.vertical.localeCompare(b.vertical));
}

export const VISIBILITY_LABEL: Record<SignalRow['visibility'], string> = {
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
