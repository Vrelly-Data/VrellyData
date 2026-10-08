/**
 * Vrelly audience filter vocabulary — the client half.
 *
 * The server half, which validates and compiles these into SQL, is
 * supabase/functions/_shared/vrelly-audience.ts. The constants below MUST
 * match it: the server rejects any seniority key or size band it does not
 * know, so a drift here shows up as a 400 on save-and-preview, never as a
 * silently wrong search.
 */

/** agent_audiences.filters for source='vrelly' (filters_version 2). */
export interface VrellyAudienceFilters {
  job_titles?: string[];
  seniorities?: string[];
  departments?: string[];
  industries?: string[];
  company_sizes?: string[];
  person_countries?: string[];
  person_states?: string[];
  company_countries?: string[];
  company_states?: string[];
  keywords?: string[];
}

/** Keys of VRELLY_SENIORITIES on the server; labels are display only. */
export const VRELLY_SENIORITY_OPTIONS = [
  { value: 'cxo', label: 'C-level' },
  { value: 'vp', label: 'VP' },
  { value: 'head', label: 'Head' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'staff', label: 'Staff' },
  { value: 'intern', label: 'Intern' },
];

/** The company-size bands prod stores, verbatim. */
export const VRELLY_COMPANY_SIZE_OPTIONS = [
  '1 to 10', '11 to 25', '26 to 50', '51 to 100', '101 to 250', '251 to 500',
  '501 to 1000', '1001 to 5000', '5001 to 10000', '10000+',
].map((v) => ({ value: v, label: v.replace(' to ', '–') }));

/** Departments as prod spells them (matched as "contains"). */
export const VRELLY_DEPARTMENT_OPTIONS = [
  'Executive', 'C-Suite', 'Finance', 'Operations', 'Sales', 'Marketing', 'Engineering',
  'Information Technology', 'Human Resources', 'Product Management', 'Legal', 'Education',
  'Health Services', 'Administrative', 'Customer Service', 'Media And Communications',
];

export function hasVrellyFilter(f: VrellyAudienceFilters | null | undefined): boolean {
  return !!f && Object.values(f).some((v) => Array.isArray(v) && v.some((x) => String(x).trim() !== ''));
}
