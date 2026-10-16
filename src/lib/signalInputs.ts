/**
 * Signal Inputs — a team's own saved queries that create signals
 * (public.signal_inputs, run by the signal-inputs-run edge function).
 * The filter shapes mirror supabase/functions/signal-inputs-run/filters.ts,
 * which normalizes them again server-side.
 */

export type InputFamily = 'hiring' | 'github' | 'medical';

export interface HiringLocation { country?: string | null; state?: string | null; city?: string | null }
export interface HiringFilters {
  job_titles: string[];
  locations: HiringLocation[];
  industries: string[];
  company_sizes: string[];
  posted_within_days: number;
}
export interface GithubFilters {
  keywords: string[];
  topics: string[];
  orgs: string[];
  min_stars: number;
  activity: 'created' | 'pushed';
  owner: 'any' | 'org';
  within_days: number;
}
export type MedicalSource = '510k' | 'pma' | 'denovo' | 'recalls' | 'registrations' | 'clinical_trials' | 'breakthrough';
export interface MedicalFilters {
  sources: MedicalSource[];
  product_codes: string[];
  device_keywords: string[];
  specialties: string[];
  companies: string[];
  industry_sponsors_only: boolean;
  within_days: number;
}
export type InputFilters = HiringFilters | GithubFilters | MedicalFilters;

export interface WriterRun {
  at: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  total?: number;
  matched?: number;
  credits?: number;
  error?: string | null;
  [k: string]: unknown;
}

export interface SignalInput {
  id: string;
  team_id: string;
  source_key: InputFamily;
  name: string;
  filters: InputFilters;
  is_active: boolean;
  all_clients: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: WriterRun['status'] | 'running' | null;
  last_run: Record<string, WriterRun>;
  preview_count: number | null;
  preview_at: string | null;
}

export interface InputPreview {
  count: number | null;
  missing?: string;
  apollo_credits?: number;
  by_source: Record<string, number>;
  sample: Array<{ title: string; company: string | null; occurred_at: string | null; url: string | null; detail?: string | null }>;
  error?: string | null;
}

export const FAMILY_INFO: Record<InputFamily, { label: string; description: string; costNote?: string }> = {
  hiring: {
    label: 'Hiring',
    description: 'Companies with open roles that match your job titles and locations.',
    costNote: 'Uses Apollo credits: 1 per search and 1 per company whose postings are checked. A preview uses 1 credit.',
  },
  github: { label: 'GitHub', description: 'New or active repositories matching your keywords, topics or organizations.' },
  medical: { label: 'Medical / FDA', description: 'FDA clearances, approvals, recalls, listings and new device trials. Tagged Medical Device.' },
};

export const MEDICAL_SOURCE_OPTIONS: Array<{ value: MedicalSource; label: string; hint: string }> = [
  { value: '510k', label: '510(k) clearances', hint: 'openFDA, monthly' },
  { value: 'pma', label: 'PMA approvals', hint: 'original approvals only' },
  { value: 'denovo', label: 'De Novo grants', hint: 'openFDA' },
  { value: 'recalls', label: 'Recalls', hint: 'openFDA, weekly' },
  { value: 'registrations', label: 'Registrations & listings', hint: 'newly listed devices' },
  { value: 'clinical_trials', label: 'New device trials', hint: 'ClinicalTrials.gov' },
  { value: 'breakthrough', label: 'Breakthrough authorizations', hint: 'FDA list; designations themselves are confidential' },
];

export const COMPANY_SIZE_OPTIONS = [
  { value: '1,10', label: '1–10' }, { value: '11,50', label: '11–50' }, { value: '51,200', label: '51–200' },
  { value: '201,500', label: '201–500' }, { value: '501,1000', label: '501–1,000' }, { value: '1001,5000', label: '1,001–5,000' },
  { value: '5001,10000', label: '5,001–10,000' }, { value: '10001,', label: '10,001+' },
];

/** FDA review panels (openFDA advisory_committee_description). */
export const FDA_SPECIALTIES = [
  'Anesthesiology', 'Cardiovascular', 'Clinical Chemistry', 'Dental', 'Ear, Nose, Throat', 'Gastroenterology, Urology',
  'General Hospital', 'General, Plastic Surgery', 'Hematology', 'Immunology', 'Microbiology', 'Neurology',
  'Obstetrics/Gynecology', 'Ophthalmic', 'Orthopedic', 'Pathology', 'Physical Medicine', 'Radiology', 'Toxicology',
];

export const US_STATE_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

export function defaultFilters(f: InputFamily): InputFilters {
  if (f === 'hiring') return { job_titles: [], locations: [], industries: [], company_sizes: [], posted_within_days: 30 };
  if (f === 'github') return { keywords: [], topics: [], orgs: [], min_stars: 0, activity: 'created', owner: 'any', within_days: 30 };
  return { sources: ['510k'], product_codes: [], device_keywords: [], specialties: [], companies: [], industry_sponsors_only: true, within_days: 30 };
}

export function locationLabel(l: HiringLocation): string {
  return [l.city, l.state, l.country].filter(Boolean).join(', ');
}

/** One line describing an input's filters (card subtitle). */
export function filterSummary(family: InputFamily, f: InputFilters): string {
  const join = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} +${xs.length - max}` : xs.join(', '));
  if (family === 'hiring') {
    const h = f as HiringFilters;
    return [
      h.job_titles.length ? join(h.job_titles) : 'no job titles yet',
      h.locations.length ? `in ${join(h.locations.map(locationLabel))}` : 'any location',
      h.industries.length ? join(h.industries) : null,
      `posted ≤ ${h.posted_within_days}d`,
    ].filter(Boolean).join(' · ');
  }
  if (family === 'github') {
    const g = f as GithubFilters;
    return [
      g.keywords.length ? join(g.keywords) : null,
      g.topics.length ? `topics ${join(g.topics)}` : null,
      g.orgs.length ? `orgs ${join(g.orgs)}` : null,
      g.min_stars ? `≥ ${g.min_stars}★` : null,
      `${g.activity === 'pushed' ? 'active' : 'created'} ≤ ${g.within_days}d`,
    ].filter(Boolean).join(' · ');
  }
  const m = f as MedicalFilters;
  const labels = m.sources.map((s) => MEDICAL_SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s);
  return [
    join(labels, 4),
    m.specialties.length ? join(m.specialties) : null,
    m.product_codes.length ? `codes ${join(m.product_codes)}` : null,
    m.device_keywords.length ? join(m.device_keywords) : null,
    m.companies.length ? join(m.companies) : null,
    `≤ ${m.within_days}d`,
  ].filter(Boolean).join(' · ');
}

/** Totals of the input's last run across its writer sources. */
export function lastRunTotals(i: SignalInput): { matched: number; credits: number; errors: string[] } {
  let matched = 0, credits = 0;
  const errors: string[] = [];
  for (const r of Object.values(i.last_run ?? {})) {
    matched += Number(r.matched ?? 0);
    credits += Number(r.credits ?? 0);
    if (r.error) errors.push(String(r.error));
  }
  return { matched, credits, errors };
}

/** Text a client can add to their privacy policy (not legal advice). */
export const VISITOR_PRIVACY_NOTICE =
  'Website analytics. When you visit our website, we and our service providers automatically collect certain technical ' +
  'information, including your IP address, browser and device type (user agent), the pages you view, and the date and time ' +
  'of your visit. We use this information to understand how our website is used, to improve our content, and to learn which ' +
  'organizations are interested in our products and services. We may use third-party services to match IP addresses to ' +
  'publicly available business information, such as a company name, industry, and size, in order to identify the organization ' +
  'from which a visit originates. Depending on where you live, you may have rights to access, delete, or opt out of certain ' +
  'uses of your personal information; to exercise these rights, contact us at [email]. We retain this information for [period].';
