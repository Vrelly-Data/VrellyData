// Signals audience source — filter vocabulary and compiler.
//
// agent_audiences.filters for source='signals' holds a SignalAudienceFilters
// object, filters_version = 3. Used by the preview (signal-audience-preview)
// and the runner (run-agent-audience) alike, so a scheduled run reads saved
// filters exactly as the preview did.
//
// TWO HALVES:
//   * WHICH SIGNALS — verticals/types, recency, minimum score and per-vertical
//     filters. Compiled to signals_audience_candidates' p_query. Visibility is
//     not a filter here: the SQL applies the signals RLS rule for the user, so
//     a client can never select an admin-only or another team's signal.
//   * WHO TO REACH at each signal's company — the target persona (job titles
//     as whole words, seniority, department) and max people per company.
//     Compiled to signals_resolve_people's p_persona, and to the Apollo
//     fallback's search terms.
//
// Unknown keys are REJECTED, as in vrelly-audience.ts: a mistyped key would
// otherwise silently widen the audience.

import { containsPattern, expandStates, VRELLY_SENIORITIES, wordRegex } from "./vrelly-audience.ts";

export const SIGNALS_FILTERS_VERSION = 3;

export interface SignalPersona {
  /** Whole words, any of. */
  job_titles?: string[];
  /** Whole words, none of. */
  exclude_job_titles?: string[];
  /** Keys of VRELLY_SENIORITIES. */
  seniorities?: string[];
  /** Contains, any of. */
  departments?: string[];
}

export interface SignalAudienceFilters {
  /** signal_sources.vertical values; empty = every vertical the user can see. */
  verticals?: string[];
  signal_types?: string[];
  /** Signals that happened in the last N days. Default 30. */
  recency_days?: number;
  /** 0-100. Default 0. */
  min_score?: number;
  /** medical_device only. */
  fda?: { product_codes?: string[]; device_keywords?: string[]; states?: string[] };
  /** saas_hiring only: whole words in the posted job title. */
  hiring?: { role_keywords?: string[] };
  /** github only: repo topics, any of. */
  github?: { topics?: string[] };
  persona?: SignalPersona;
  /** People per company. Default 2, at most 10. */
  max_per_company?: number;
  /** Fall back to Apollo (paid) for companies nobody was found at. Default true. */
  use_apollo?: boolean;
  /** Apply the US rules (#107). Default true. */
  us_only?: boolean;
}

export const SIGNAL_VERTICALS = ["medical_device", "saas_hiring", "github", "web_visitors", "private_equity"] as const;
export const DEFAULT_RECENCY_DAYS = 30;
export const MAX_RECENCY_DAYS = 365;
export const DEFAULT_PER_COMPANY = 2;
export const MAX_PER_COMPANY = 10;
const MAX_VALUES = 25;
const MAX_LEN = 100;

/** Apollo's person_seniorities for each Vrelly seniority key. */
export const APOLLO_SENIORITY: Readonly<Record<string, readonly string[]>> = {
  cxo: ["c_suite", "owner", "founder"],
  vp: ["vp"],
  head: ["head"],
  director: ["director"],
  manager: ["manager"],
  senior: ["senior"],
  staff: ["entry"],
  intern: ["intern"],
};

export class SignalFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignalFilterError";
  }
}

function list(key: string, v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new SignalFilterError(`${key} must be a list`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") throw new SignalFilterError(`${key} values must be text`);
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    if (s.length > MAX_LEN) throw new SignalFilterError(`${key}: "${s.slice(0, 20)}…" is longer than ${MAX_LEN} characters`);
    if (seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  if (out.length > MAX_VALUES) throw new SignalFilterError(`${key} allows at most ${MAX_VALUES} values (got ${out.length})`);
  return out;
}

function obj(key: string, v: unknown, allowed: string[]): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new SignalFilterError(`${key} must be an object`);
  for (const k of Object.keys(v as object)) {
    if (!allowed.includes(k)) throw new SignalFilterError(`Unknown ${key} filter "${k}"`);
  }
  return v as Record<string, unknown>;
}

function int(key: string, v: unknown, def: number, min: number, max: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new SignalFilterError(`${key} must be a whole number from ${min} to ${max}`);
  return n;
}

const TOP_KEYS = [
  "verticals", "signal_types", "recency_days", "min_score", "fda", "hiring", "github",
  "persona", "max_per_company", "use_apollo", "us_only",
];

/** Validate into the canonical stored form (defaults filled in). */
export function normalizeSignalFilters(raw: unknown): Required<Pick<SignalAudienceFilters,
  "recency_days" | "min_score" | "max_per_company" | "use_apollo" | "us_only">> & SignalAudienceFilters {
  const o = obj("signals", raw ?? {}, TOP_KEYS);
  const verticals = list("verticals", o.verticals).map((s) => s.toLowerCase());
  for (const v of verticals) {
    if (!(SIGNAL_VERTICALS as readonly string[]).includes(v)) throw new SignalFilterError(`Unknown vertical "${v}"`);
  }
  const types = list("signal_types", o.signal_types).map((s) => s.toLowerCase());
  for (const t of types) if (!/^[a-z0-9][a-z0-9_]{1,62}$/.test(t)) throw new SignalFilterError(`Invalid signal type "${t}"`);

  const fda = obj("fda", o.fda, ["product_codes", "device_keywords", "states"]);
  const hiring = obj("hiring", o.hiring, ["role_keywords"]);
  const github = obj("github", o.github, ["topics"]);
  const persona = obj("persona", o.persona, ["job_titles", "exclude_job_titles", "seniorities", "departments"]);

  const codes = list("fda.product_codes", fda.product_codes).map((s) => s.toUpperCase());
  for (const c of codes) if (!/^[A-Z]{3}$/.test(c)) throw new SignalFilterError(`FDA product codes are three letters ("${c}")`);
  const seniorities = list("persona.seniorities", persona.seniorities).map((s) => s.toLowerCase());
  for (const s of seniorities) {
    if (!VRELLY_SENIORITIES[s]) throw new SignalFilterError(`Unknown seniority "${s}" (use ${Object.keys(VRELLY_SENIORITIES).join(", ")})`);
  }

  const out: ReturnType<typeof normalizeSignalFilters> = {
    recency_days: int("recency_days", o.recency_days, DEFAULT_RECENCY_DAYS, 1, MAX_RECENCY_DAYS),
    min_score: int("min_score", o.min_score, 0, 0, 100),
    max_per_company: int("max_per_company", o.max_per_company, DEFAULT_PER_COMPANY, 1, MAX_PER_COMPANY),
    use_apollo: o.use_apollo === undefined ? true : o.use_apollo === true,
    us_only: o.us_only === undefined ? true : o.us_only === true,
  };
  if (verticals.length) out.verticals = verticals;
  if (types.length) out.signal_types = types;
  const f = {
    product_codes: codes,
    device_keywords: list("fda.device_keywords", fda.device_keywords),
    states: list("fda.states", fda.states),
  };
  if (f.product_codes.length || f.device_keywords.length || f.states.length) {
    out.fda = Object.fromEntries(Object.entries(f).filter(([, v]) => v.length));
  }
  const roles = list("hiring.role_keywords", hiring.role_keywords);
  if (roles.length) out.hiring = { role_keywords: roles };
  const topics = list("github.topics", github.topics).map((s) => s.toLowerCase());
  if (topics.length) out.github = { topics };
  const p: SignalPersona = {};
  const titles = list("persona.job_titles", persona.job_titles);
  const xtitles = list("persona.exclude_job_titles", persona.exclude_job_titles);
  const depts = list("persona.departments", persona.departments);
  if (titles.length) p.job_titles = titles;
  if (xtitles.length) p.exclude_job_titles = xtitles;
  if (seniorities.length) p.seniorities = seniorities;
  if (depts.length) p.departments = depts;
  if (Object.keys(p).length) out.persona = p;
  return out;
}

export function hasPersona(p: SignalPersona | undefined): boolean {
  return !!p && !!((p.job_titles?.length) || (p.seniorities?.length) || (p.departments?.length));
}

/** signals_audience_candidates' p_query. */
export interface CompiledCandidateQuery {
  verticals: string[] | null;
  signal_types: string[] | null;
  since: string;
  min_score: number;
  fda_product_codes: string[] | null;
  fda_device_regexes: string[] | null;
  fda_state_keys: string[] | null;
  hiring_role_regexes: string[] | null;
  github_topics: string[] | null;
}

/** signals_resolve_people's p_persona. */
export interface CompiledPersona {
  title_regexes: string[] | null;
  exclude_title_regexes: string[] | null;
  seniorities: string[] | null;
  department_patterns: string[] | null;
}

export interface CompiledSignalAudience {
  filters: ReturnType<typeof normalizeSignalFilters>;
  candidates: CompiledCandidateQuery;
  persona: CompiledPersona;
  perCompany: number;
  useApollo: boolean;
  usOnly: boolean;
  /** Apollo api_search terms for the fallback; null = Apollo cannot honour this persona. */
  apollo: { person_titles: string[]; person_seniorities: string[] } | null;
}

const nn = <T>(xs: T[] | undefined): T[] | null => (xs && xs.length ? xs : null);

/** Throws SignalFilterError when the audience has no target persona. */
export function compileSignalAudience(raw: unknown, now = Date.now()): CompiledSignalAudience {
  const f = normalizeSignalFilters(raw);
  if (!hasPersona(f.persona)) {
    throw new SignalFilterError("Choose who to reach: at least one job title, seniority or department");
  }
  const p = f.persona!;
  const titles = p.job_titles ?? [];
  const seniorities = p.seniorities ?? [];
  return {
    filters: f,
    candidates: {
      verticals: nn(f.verticals),
      signal_types: nn(f.signal_types),
      since: new Date(now - f.recency_days * 86_400_000).toISOString(),
      min_score: f.min_score,
      fda_product_codes: nn(f.fda?.product_codes),
      fda_device_regexes: nn(f.fda?.device_keywords?.map(wordRegex)),
      fda_state_keys: nn(f.fda?.states ? expandStates(f.fda.states) : undefined),
      hiring_role_regexes: nn(f.hiring?.role_keywords?.map(wordRegex)),
      github_topics: nn(f.github?.topics),
    },
    persona: {
      title_regexes: nn(titles.map(wordRegex)),
      exclude_title_regexes: nn(p.exclude_job_titles?.map(wordRegex)),
      seniorities: nn([...new Set(seniorities.flatMap((s) => VRELLY_SENIORITIES[s]))]),
      department_patterns: nn(p.departments?.map(containsPattern)),
    },
    perCompany: f.max_per_company,
    useApollo: f.use_apollo,
    usOnly: f.us_only,
    // Apollo has no department vocabulary we can map to, and its search result
    // carries no department to check; a department-only persona would buy
    // whoever Apollo returns. So the fallback needs titles or seniority.
    apollo: titles.length || seniorities.length
      ? {
        person_titles: titles,
        person_seniorities: [...new Set(seniorities.flatMap((s) => APOLLO_SENIORITY[s] ?? []))],
      }
      : null,
  };
}

/**
 * The JS twin of the SQL whole-word title match (wordRegex's \m / \M), for
 * titles Apollo returns: its own title matching is fuzzy ("Sales" finds
 * "Salesforce Admin"), so results are re-checked before anyone is enriched.
 */
export function titleMatcher(terms: string[] | undefined): ((title: string | null | undefined) => boolean) | null {
  if (!terms || !terms.length) return null;
  const res = terms.map((t) => {
    const body = t.trim().split(/\s+/).map((w) => w.replace(/[\\^$.|?*+()[\]{}]/g, (c) => `\\${c}`)).join("\\s+");
    const start = /^[\p{L}\p{N}]/u.test(t.trim()) ? "(?<![\\p{L}\\p{N}])" : "";
    const end = /[\p{L}\p{N}]$/u.test(t.trim()) ? "(?![\\p{L}\\p{N}])" : "";
    return new RegExp(`${start}${body}${end}`, "iu");
  });
  return (title) => !!title && res.some((r) => r.test(title));
}
