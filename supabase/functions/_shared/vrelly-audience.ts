// Vrelly audience source — filter vocabulary, compiler and search call.
//
// One module, used by BOTH the preview (vrelly-audience-search) and the runner
// (run-agent-audience), so a scheduled run can never interpret saved filters
// differently from the preview the operator approved.
//
// THE VOCABULARY IS VRELLY'S OWN. agent_audiences.filters for source='vrelly'
// holds a VrellyAudienceFilters object, written with filters_version = 2
// (Apollo audiences are version 1). The two vocabularies are never translated
// into each other — see 20260831120000_agent_audiences_source.sql for why.
//
// WHAT "COMPILE" MEANS. compileVrellyFilters turns operator-facing values into
// exactly what the SQL compares against, and nothing else happens to them in
// the database:
//   * job titles match WHOLE WORDS (case-insensitive regex with word
//     boundaries): "CTO" must not match "Director", nor "Owner"
//     "Homeownership" — measured on prod 2026-10-08, substring "cto" hit
//     204,950 titles vs 9,938 as a word. Operator text is regex-escaped;
//   * industries and departments stay contains-matches (ILIKE patterns with
//     the operator's own %, _ and \ escaped, so "100%" is a literal);
//   * equality matches (seniority, size band, locations) become lower-case
//     lists, with synonyms expanded where prod data uses two spellings for one
//     thing (country 'US' vs 'United States'; state 'TX' vs 'Texas');
//   * keywords stay terms: Postgres stems them (plainto_tsquery, english) because
//     only it knows the dictionary the index was built with. Terms are OR-ed;
//     the words inside one term are AND-ed, as in the Apollo keyword box.
// public.vrelly_audience_search ANDs every non-null list and ORs within a list.
//
// Prod value profile this is written against (measured 2026-10-08, 3% sample of
// 1.91M rows): seniority is Cxo / Manager / Staff / Vp / Director / Head /
// Senior / Intern / 'C suite'; company size lives in `company_size` as bands
// like '26 to 50' (company_size_range is 0% populated); country is 'US' for
// audience_lab rows and 'United States' for apollo rows; person and company
// state are mostly two-letter codes; company_country is only 4% populated.

export const VRELLY_FILTERS_VERSION = 2;

/** Stored verbatim in agent_audiences.filters for source='vrelly'. */
export interface VrellyAudienceFilters {
  /** Whole words, any of. "CEO" matches "CEO & Founder", "Owner" does not match "Homeownership". */
  job_titles?: string[];
  /**
   * Whole words, none of — removes e.g. "Product Owner" from an "Owner" search.
   * Not a filter on its own: an audience still needs at least one positive one.
   */
  exclude_job_titles?: string[];
  /** Keys of VRELLY_SENIORITIES. */
  seniorities?: string[];
  /** Contains, any of — prod stores multi-valued "C-Suite, Marketing". */
  departments?: string[];
  /** Contains, any of. */
  industries?: string[];
  /** Exact band labels from VRELLY_COMPANY_SIZES. */
  company_sizes?: string[];
  person_countries?: string[];
  person_states?: string[];
  company_countries?: string[];
  company_states?: string[];
  /** Company description / keywords. Any term matches; every word inside one term must appear. */
  keywords?: string[];
}

/** Seniority options shown in the form → the stored values they cover. */
export const VRELLY_SENIORITIES: Readonly<Record<string, readonly string[]>> = {
  cxo: ["cxo", "c suite"],
  vp: ["vp"],
  head: ["head"],
  director: ["director"],
  manager: ["manager"],
  senior: ["senior"],
  staff: ["staff"],
  intern: ["intern"],
};

/** The band labels prod actually stores in prospects.company_size. */
export const VRELLY_COMPANY_SIZES: readonly string[] = [
  "1 to 10", "11 to 25", "26 to 50", "51 to 100", "101 to 250", "251 to 500",
  "501 to 1000", "1001 to 5000", "5001 to 10000", "10000+",
];

export const VRELLY_MAX_VALUES_PER_FILTER = 25;
export const VRELLY_MAX_KEYWORDS = 10;
const MAX_VALUE_LENGTH = 100;

const COUNTRY_SYNONYMS: readonly (readonly string[])[] = [
  ["united states", "us", "usa", "united states of america", "u.s.", "u.s.a."],
  ["united kingdom", "uk", "gb", "great britain", "u.k."],
  ["united arab emirates", "uae"],
];

const US_STATES: Readonly<Record<string, string>> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
  connecticut: "ct", delaware: "de", "district of columbia": "dc", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky",
  louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn",
  mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh",
  "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd",
  ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};
const US_STATE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(US_STATES).map(([name, code]) => [code, name]),
);

/** Exactly what public.vrelly_audience_search receives as p_query. */
export interface CompiledVrellyQuery {
  /** Case-insensitive POSIX regexes (whole words), matched with ~*. */
  title_regexes: string[] | null;
  exclude_title_regexes: string[] | null;
  seniorities: string[] | null;
  department_patterns: string[] | null;
  industry_patterns: string[] | null;
  company_sizes: string[] | null;
  person_countries: string[] | null;
  person_states: string[] | null;
  company_countries: string[] | null;
  company_states: string[] | null;
  keywords: string[] | null;
}

export class VrellyFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VrellyFilterError";
  }
}

/** Trim, drop blanks, dedupe case-insensitively, keep the first spelling. */
function cleanList(key: string, v: unknown, max = VRELLY_MAX_VALUES_PER_FILTER): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new VrellyFilterError(`${key} must be a list`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") throw new VrellyFilterError(`${key} values must be text`);
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    if (s.length > MAX_VALUE_LENGTH) throw new VrellyFilterError(`${key}: "${s.slice(0, 20)}…" is longer than ${MAX_VALUE_LENGTH} characters`);
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  if (out.length > max) throw new VrellyFilterError(`${key} allows at most ${max} values (got ${out.length})`);
  return out;
}

/**
 * Whole-word, case-insensitive regex for a title term. Word boundaries (\m, \M)
 * are only added on a side that starts/ends with a letter or digit, so "C++" or
 * "(Interim)" still match; inner whitespace matches any run of whitespace.
 */
export function wordRegex(term: string): string {
  const body = term.trim().split(/\s+/)
    .map((w) => w.replace(/[\\^$.|?*+()[\]{}]/g, (c) => `\\${c}`))
    .join("\\s+");
  const start = /^[\p{L}\p{N}]/u.test(term.trim()) ? "\\m" : "";
  const end = /[\p{L}\p{N}]$/u.test(term.trim()) ? "\\M" : "";
  return `${start}${body}${end}`;
}

/** ILIKE pattern for "contains", with the operator's wildcards made literal. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function expandCountries(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const l = v.toLowerCase();
    const group = COUNTRY_SYNONYMS.find((g) => g.includes(l));
    for (const s of group ?? [l]) out.add(s);
  }
  return [...out];
}

function expandStates(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const l = v.toLowerCase();
    out.add(l);
    if (US_STATES[l]) out.add(US_STATES[l]);
    if (US_STATE_NAMES[l]) out.add(US_STATE_NAMES[l]);
  }
  return [...out];
}

const KNOWN_KEYS = new Set<keyof VrellyAudienceFilters>([
  "job_titles", "exclude_job_titles", "seniorities", "departments", "industries", "company_sizes",
  "person_countries", "person_states", "company_countries", "company_states", "keywords",
]);

/**
 * Validate stored/submitted filters into their canonical stored form.
 *
 * Unknown keys are REJECTED, not ignored: an Apollo-shaped filter object saved
 * under source 'vrelly' would otherwise compile to "no filters" and match the
 * whole database.
 */
export function normalizeVrellyFilters(raw: unknown): VrellyAudienceFilters {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new VrellyFilterError("filters must be an object");
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(k as keyof VrellyAudienceFilters)) {
      throw new VrellyFilterError(`Unknown Vrelly filter "${k}"`);
    }
  }
  const f: VrellyAudienceFilters = {};
  const put = (k: keyof VrellyAudienceFilters, v: string[]) => { if (v.length) f[k] = v; };

  put("job_titles", cleanList("job_titles", obj.job_titles));
  put("exclude_job_titles", cleanList("exclude_job_titles", obj.exclude_job_titles));
  const sen = cleanList("seniorities", obj.seniorities).map((s) => s.toLowerCase());
  for (const s of sen) {
    if (!VRELLY_SENIORITIES[s]) {
      throw new VrellyFilterError(`Unknown seniority "${s}" (use ${Object.keys(VRELLY_SENIORITIES).join(", ")})`);
    }
  }
  put("seniorities", sen);
  put("departments", cleanList("departments", obj.departments));
  put("industries", cleanList("industries", obj.industries));
  const sizes = cleanList("company_sizes", obj.company_sizes);
  for (const s of sizes) {
    if (!VRELLY_COMPANY_SIZES.includes(s)) {
      throw new VrellyFilterError(`Unknown company size "${s}" (use ${VRELLY_COMPANY_SIZES.join(" | ")})`);
    }
  }
  put("company_sizes", sizes);
  put("person_countries", cleanList("person_countries", obj.person_countries));
  put("person_states", cleanList("person_states", obj.person_states));
  put("company_countries", cleanList("company_countries", obj.company_countries));
  put("company_states", cleanList("company_states", obj.company_states));
  put("keywords", cleanList("keywords", obj.keywords, VRELLY_MAX_KEYWORDS));
  return f;
}

/** A positive filter — exclusions alone would still match the whole database. */
export function hasAnyVrellyFilter(f: VrellyAudienceFilters): boolean {
  return Object.entries(f).some(([k, v]) => k !== "exclude_job_titles" && Array.isArray(v) && v.length > 0);
}

/**
 * Filters → the exact comparison values the SQL uses. Throws on an empty
 * filter set: an unfiltered audience would walk the whole database.
 */
export function compileVrellyFilters(raw: unknown): CompiledVrellyQuery {
  const f = normalizeVrellyFilters(raw);
  if (!hasAnyVrellyFilter(f)) throw new VrellyFilterError("At least one filter is required");
  const or = (xs: string[] | undefined | null, map: (xs: string[]) => string[]) =>
    xs && xs.length ? map(xs) : null;
  return {
    title_regexes: or(f.job_titles, (xs) => xs.map(wordRegex)),
    exclude_title_regexes: or(f.exclude_job_titles, (xs) => xs.map(wordRegex)),
    seniorities: or(f.seniorities, (xs) => [...new Set(xs.flatMap((s) => VRELLY_SENIORITIES[s]))]),
    department_patterns: or(f.departments, (xs) => xs.map(containsPattern)),
    industry_patterns: or(f.industries, (xs) => xs.map(containsPattern)),
    company_sizes: or(f.company_sizes, (xs) => xs.map((s) => s.toLowerCase())),
    person_countries: or(f.person_countries, expandCountries),
    person_states: or(f.person_states, expandStates),
    company_countries: or(f.company_countries, expandCountries),
    company_states: or(f.company_states, expandStates),
    keywords: or(f.keywords, (xs) => xs.map((s) => s.toLowerCase())),
  };
}

/** One prospect as the search returns it — complete, nothing withheld. */
export interface VrellyPerson {
  prospect_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_size: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface VrellySearchResult {
  people: VrellyPerson[];
  /** Matching people not yet pushed / not already a lead or contact. null when not counted. */
  total: number | null;
  /** True when the count stopped at the cap; total is then a floor. */
  total_capped: boolean;
  /** True when a keyword filter's share was sampled rather than counted row by row. */
  total_is_estimate: boolean;
  count_cap: number;
}

export const VRELLY_COUNT_CAP = 100_000;

/**
 * Run the search for one user. Exclusions (already pushed by this user, already
 * an agent_lead, already a synced contact of the user's teams) are applied in
 * the database on lower(email) AND normalized LinkedIn, so paging and counts
 * never include anyone a run would skip.
 */
export async function searchVrelly(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    userId: string;
    query: CompiledVrellyQuery;
    limit: number;
    offset?: number;
    count?: boolean;
    prospectIds?: string[] | null;
  },
): Promise<VrellySearchResult> {
  const { data, error } = await supabase.rpc("vrelly_audience_search", {
    p_user_id: args.userId,
    p_query: args.query,
    p_limit: Math.max(0, Math.min(500, Math.floor(args.limit))),
    p_offset: Math.max(0, Math.floor(args.offset ?? 0)),
    p_count: args.count === true,
    p_count_cap: VRELLY_COUNT_CAP,
    p_prospect_ids: args.prospectIds && args.prospectIds.length ? args.prospectIds : null,
  });
  if (error) throw new Error(`vrelly_audience_search failed: ${error.message}`);
  return {
    people: Array.isArray(data?.people) ? data.people : [],
    total: typeof data?.total === "number" ? data.total : null,
    total_capped: data?.total_capped === true,
    total_is_estimate: data?.total_is_estimate === true,
    count_cap: VRELLY_COUNT_CAP,
  };
}
