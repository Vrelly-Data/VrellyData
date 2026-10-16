// Signal Inputs: the filter shape of each input family, normalized and
// bounded. Everything a team types goes through here before it reaches an
// upstream query, on save (UI) and again on every run (this function).

export type InputFamily = "hiring" | "github" | "medical";

export interface HiringLocation { country?: string | null; state?: string | null; city?: string | null }

export interface HiringFilters {
  job_titles: string[];
  locations: HiringLocation[];
  industries: string[];
  /** Apollo employee ranges, "min,max" ("10001," = 10,001+). */
  company_sizes: string[];
  posted_within_days: number;
}

export interface GithubFilters {
  keywords: string[];
  topics: string[];
  orgs: string[];
  min_stars: number;
  /** created = new repositories; pushed = repositories with recent commits. */
  activity: "created" | "pushed";
  /** org = repositories owned by an organization (companies), not personal accounts. */
  owner: "any" | "org";
  within_days: number;
}

export const MEDICAL_SOURCES = ["510k", "pma", "denovo", "recalls", "registrations", "clinical_trials", "breakthrough"] as const;
export type MedicalSource = typeof MEDICAL_SOURCES[number];

export interface MedicalFilters {
  sources: MedicalSource[];
  product_codes: string[];
  device_keywords: string[];
  /** FDA review panel / medical specialty, e.g. "Orthopedic", "Cardiovascular". */
  specialties: string[];
  companies: string[];
  /** ClinicalTrials.gov: only trials whose lead sponsor is a company (class INDUSTRY). */
  industry_sponsors_only: boolean;
  within_days: number;
}

export const COMPANY_SIZES = ["1,10", "11,50", "51,200", "201,500", "501,1000", "1001,5000", "5001,10000", "10001,"] as const;

/** The writer signal_sources row per family / medical sub-source. */
export const MEDICAL_WRITER: Record<MedicalSource, string> = {
  "510k": "input_fda_clearance",
  pma: "input_fda_clearance",
  denovo: "input_fda_clearance",
  breakthrough: "input_fda_clearance",
  recalls: "input_fda_recall",
  registrations: "input_fda_registration",
  clinical_trials: "input_clinical_trial",
};
export const WRITERS: Record<InputFamily, string[]> = {
  hiring: ["input_hiring"],
  github: ["input_github"],
  medical: ["input_fda_clearance", "input_fda_recall", "input_fda_registration", "input_clinical_trial"],
};
export function familyOfWriter(writer: string): InputFamily | null {
  for (const [f, ws] of Object.entries(WRITERS)) if (ws.includes(writer)) return f as InputFamily;
  return null;
}

const clean = (v: unknown, max = 80): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
function list(v: unknown, maxItems: number, maxLen = 80): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [];
  const out: string[] = [];
  for (const x of arr) {
    const s = clean(x, maxLen);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
const days = (v: unknown, dflt: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : dflt;
};

export function normalizeHiring(f: Record<string, unknown>): HiringFilters {
  const locs: HiringLocation[] = [];
  for (const l of Array.isArray(f.locations) ? f.locations.slice(0, 10) : []) {
    const loc = typeof l === "string" ? { state: l } : (l ?? {}) as Record<string, unknown>;
    const o = { country: clean(loc.country, 60), state: clean(loc.state, 60), city: clean(loc.city, 60) };
    if (o.country || o.state || o.city) locs.push(o);
  }
  return {
    job_titles: list(f.job_titles, 10),
    locations: locs,
    industries: list(f.industries, 10),
    company_sizes: list(f.company_sizes, 8).filter((s) => (COMPANY_SIZES as readonly string[]).includes(s)),
    posted_within_days: days(f.posted_within_days, 30, 90),
  };
}

export function normalizeGithub(f: Record<string, unknown>): GithubFilters {
  const stars = Math.round(Number(f.min_stars));
  return {
    keywords: list(f.keywords, 5, 60),
    topics: list(f.topics, 5, 50).map((t) => t.toLowerCase().replace(/\s+/g, "-")).filter((t) => /^[a-z0-9][a-z0-9-]*$/.test(t)),
    orgs: list(f.orgs, 10, 39).filter((o) => /^[A-Za-z0-9-]+$/.test(o)),
    min_stars: Number.isFinite(stars) && stars > 0 ? Math.min(stars, 1_000_000) : 0,
    activity: f.activity === "pushed" ? "pushed" : "created",
    owner: f.owner === "org" ? "org" : "any",
    within_days: days(f.within_days, 30, 365),
  };
}

export function normalizeMedical(f: Record<string, unknown>): MedicalFilters {
  const sources = list(f.sources, MEDICAL_SOURCES.length).filter((s): s is MedicalSource =>
    (MEDICAL_SOURCES as readonly string[]).includes(s)
  );
  return {
    sources: sources.length ? sources : ["510k"],
    product_codes: list(f.product_codes, 20, 10).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)),
    device_keywords: list(f.device_keywords, 10, 60),
    specialties: list(f.specialties, 5, 60),
    companies: list(f.companies, 10, 80),
    industry_sponsors_only: f.industry_sponsors_only !== false,
    within_days: days(f.within_days, 30, 365),
  };
}

export function normalizeFilters(family: InputFamily, f: unknown): HiringFilters | GithubFilters | MedicalFilters {
  const o = (f && typeof f === "object" && !Array.isArray(f) ? f : {}) as Record<string, unknown>;
  return family === "hiring" ? normalizeHiring(o) : family === "github" ? normalizeGithub(o) : normalizeMedical(o);
}

/** Why an input cannot run yet (null = it can). */
export function missingFilters(family: InputFamily, f: HiringFilters | GithubFilters | MedicalFilters): string | null {
  if (family === "hiring") return (f as HiringFilters).job_titles.length ? null : "add at least one job title";
  if (family === "github") {
    const g = f as GithubFilters;
    return g.keywords.length || g.topics.length || g.orgs.length ? null : "add a keyword, topic or org";
  }
  return null;
}
