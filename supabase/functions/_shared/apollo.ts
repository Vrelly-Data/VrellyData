// Shared Apollo API surface: endpoints, limits, and the request/response
// mapping used by apollo-search and apollo-enrich.
//
// Everything here is from the live docs, verified 2026-08-16, not assumed.
//
// TWO ENDPOINTS, AND THE SPLIT MATTERS:
//
//   mixed_people/api_search  — 0 CREDITS. Returns NO email and NO phone, and
//     obfuscates the surname (`last_name_obfuscated`). You get id, first_name,
//     title, org name, and has_* booleans. Free to call as often as the rate
//     limit allows. Use `api_search`, NOT `search` — the latter 403s on lower
//     plans. Display cap 50,000 records (100/page, 500 pages).
//
//   people/bulk_match        — COSTS REAL MONEY. 1 credit per record where
//     credit-consuming data is FOUND (0 when nothing is found), max 10 records
//     per call. This is where email and linkedin_url actually come from.
//
// Because search returns no contact data, a search result CANNOT be pushed to a
// sequence. The flow is always: search (free) → user selects → enrich (paid) →
// push. Anything that enriches without an explicit, bounded list of ids is a
// bug that spends money.
//
// PHONE NUMBERS ARE NEVER REQUESTED. reveal_phone_number costs up to 8 credits
// per record and requires a webhook_url; no sequence we push to needs a phone.

export const APOLLO_BASE = "https://api.apollo.io/api/v1";

/** api_search: 100 per page, 500 pages, 50k display cap. */
export const SEARCH_MAX_PER_PAGE = 100;
export const SEARCH_MAX_PAGE = 500;

/** bulk_match hard limit: 10 records per request. Not ours — Apollo's. */
export const ENRICH_CHUNK_SIZE = 10;

/**
 * Ceiling on a single apollo-enrich call, in records.
 *
 * Apollo has NO test mode — dev and prod hit the same account and the same real
 * credit balance. A careless loop over a full search page would be a 100-credit
 * mistake with no undo. Held at one chunk until manual mode is proven end to
 * end; raise deliberately, not incidentally.
 */
export const ENRICH_MAX_PER_CALL = 10;

/**
 * How long an apollo_enrichment_cache row may be served before we pay again.
 *
 * The cache exists so Reveal-then-push does not buy the same person twice (see
 * the migration header). This number is where that saving stops: past it, the
 * row is re-fetched at full price.
 *
 * 30 days is chosen against the failure mode, not the saving. A cached email
 * that has gone dead does not announce itself — it is spent as a real send into
 * a real sequence, and the bounce lands on the client's sending domain. That is
 * a reputational cost with no undo, and it dwarfs one Apollo credit. Apollo's
 * own `last_refreshed_at` (surfaced in the preview table) shows records
 * routinely months old, so a long TTL here would be compounding staleness on
 * top of staleness.
 *
 * If refresh_count across the table climbs steeply, this is too short for how
 * the account actually works and should be raised deliberately — not widened by
 * accident.
 */
export const ENRICH_CACHE_TTL_DAYS = 30;

export function apolloHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "x-api-key": apiKey,
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * The filter subset we expose. Names are Apollo's, verbatim.
 *
 * EVERY ONE OF THESE WAS VERIFIED LIVE (2026-08-17) by checking that adding it
 * MOVES total_entries. That matters because api_search silently ignores unknown
 * keys — a control param of pure nonsense returns the baseline count unchanged,
 * so "no error" proves nothing. Several documented filters turned out not to
 * exist, and several undocumented ones do.
 *
 * DELIBERATELY ABSENT:
 *   organization_latest_funding_stage_cd — the VALUE is ignored. 'series_a' and
 *     'TOTAL_GARBAGE_VALUE_XYZ' both return the identical count, so only the
 *     parameter's presence filters (to "has funding data"). Exposing it would
 *     let an operator pick a stage and silently get something else.
 *   person_schools / education — genuinely unsupported; identical to the
 *     nonsense control.
 *   organization_industry_tag_ids, currently_using_*_technology_uids — real,
 *     but keyed by Apollo IDs we have no resolver for. q_organization_keyword_tags
 *     covers most of the industry intent with free text.
 */
export interface ApolloSearchFilters {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[]; // "1,10"
  q_organization_domains_list?: string[];
  /**
   * Only 'verified' | 'guessed' | 'unavailable' are real. Verified as the
   * COMPLETE set: their counts sum to exactly the unfiltered baseline
   * (937,949 + 44,534 + 761,787 = 1,744,270). The documented 'unverified' and
   * 'likely_to_engage' are silently ignored.
   */
  contact_email_status?: string[];
  /** Free text; the practical stand-in for an industry filter. */
  q_organization_keyword_tags?: string[];
  /** OR union across values — sales + marketing returns their union. */
  person_department_or_subdepartments?: string[];
  /** Nested ints, not an array. Either bound may be omitted. */
  revenue_range?: { min?: number; max?: number };
  q_keywords?: string;
  include_similar_titles?: boolean;
}

const ARRAY_FILTERS = [
  "person_titles",
  "person_seniorities",
  "person_locations",
  "organization_locations",
  "organization_num_employees_ranges",
  "q_organization_domains_list",
  "contact_email_status",
  "q_organization_keyword_tags",
  "person_department_or_subdepartments",
] as const;

/**
 * Ceiling on how many terms one Keywords box may fan out into.
 *
 * Each term is a separate api_search round trip, so this is a latency and
 * rate-limit budget, not a taste judgement. Five covers every realistic
 * "finance, loans, mortgages" case; beyond it the operator is describing a
 * segment, not a keyword, and should use a different filter.
 */
export const KEYWORD_MAX_TERMS = 5;

/**
 * Split the Keywords box into the terms to OR together.
 *
 * WHY THIS EXISTS. Apollo's q_keywords is ONE AND-ed phrase and has no OR in
 * any syntax — verified against live api_search on 2026-09-02 with
 * person_titles ["CEO"], where the terms finance / loans / mortgages match
 * 4,266 / 280 / 65 records alone:
 *
 *   "finance OR loans OR mortgages"        -> 0   (OR is just another token)
 *   "\"finance\" OR \"loans\""              -> 0
 *   "(finance OR loans OR mortgages)"      -> 0
 *   "finance|loans|mortgages"              -> 4   (punctuation ignored -> AND)
 *   "finance,loans,mortgages"              -> 4   (same)
 *   ["finance","loans","mortgages"]        -> HTTP 500 (array is not accepted)
 *
 * So a comma-separated list cannot be expressed as one Apollo query at all.
 * OR has to be built by asking Apollo once per term and merging, which is what
 * the caller does with this list.
 *
 * Splitting on commas and semicolons ONLY — never on whitespace. A multi-word
 * term is a real thing ("private equity"), and breaking it into "private" and
 * "equity" would silently widen the search into nonsense.
 */
export function splitKeywordTerms(q: string | null | undefined): string[] {
  if (!q) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of q.split(/[,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    // Case-insensitive dedup so "Finance, finance" is one round trip, but keep
    // the operator's own casing for the query itself.
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    terms.push(t);
    if (terms.length >= KEYWORD_MAX_TERMS) break;
  }
  return terms;
}

/**
 * Build the api_search body, dropping empty values.
 *
 * Empty arrays are STRIPPED rather than sent: Apollo treats an empty array as a
 * filter that matches nothing on some fields, which silently returns zero
 * results and looks like "no matches" rather than "you sent a bad filter".
 */
export function buildSearchBody(
  filters: ApolloSearchFilters,
  page: number,
  perPage: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    page: Math.max(1, Math.min(SEARCH_MAX_PAGE, Math.floor(page) || 1)),
    per_page: Math.max(1, Math.min(SEARCH_MAX_PER_PAGE, Math.floor(perPage) || 25)),
  };
  for (const f of ARRAY_FILTERS) {
    const v = filters[f];
    if (Array.isArray(v)) {
      const cleaned = v.map((s) => String(s).trim()).filter(Boolean);
      if (cleaned.length > 0) body[f] = cleaned;
    }
  }
  if (filters.q_keywords && filters.q_keywords.trim()) {
    body.q_keywords = filters.q_keywords.trim();
  }
  if (typeof filters.include_similar_titles === "boolean") {
    body.include_similar_titles = filters.include_similar_titles;
  }
  // revenue_range is a nested object, not an array. Send only the bounds that
  // are real numbers, and omit the key entirely when neither is — an empty
  // object would read as "has revenue data" and silently narrow the search,
  // which is the same class of trap that got funding-stage dropped.
  if (filters.revenue_range) {
    const rr: Record<string, number> = {};
    if (Number.isFinite(filters.revenue_range.min)) rr.min = Number(filters.revenue_range.min);
    if (Number.isFinite(filters.revenue_range.max)) rr.max = Number(filters.revenue_range.max);
    if (Object.keys(rr).length > 0) body.revenue_range = rr;
  }
  return body;
}

/**
 * Apollo's presence flags are NOT consistently typed. Verified against the live
 * api_search response 2026-08-16, over 25 records:
 *
 *   has_email, has_city, has_state, has_country  -> real booleans
 *   has_direct_phone                             -> the STRING "Yes"
 *
 * A `=== true` test therefore reports every prospect as having no phone. Coerce
 * both shapes, and treat anything unrecognised as false.
 */
export function truthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") return /^(yes|true|1)$/i.test(v.trim());
  return false;
}

/**
 * What we hand the UI. Deliberately does NOT invent contact fields.
 *
 * api_search returns NO city/state/country strings — only has_city / has_state
 * / has_country booleans. The location itself arrives with enrichment. These
 * flags are still worth surfacing: they tell the operator whether enriching
 * this person will yield a location, before paying for it.
 */
export interface ApolloSearchPerson {
  apollo_person_id: string;
  first_name: string | null;
  /** Apollo obfuscates this on search ("Lo***n"). Real value needs enrich. */
  last_name_obfuscated: string | null;
  title: string | null;
  organization_name: string | null;
  has_email: boolean;
  has_direct_phone: boolean;
  has_city: boolean;
  has_state: boolean;
  has_country: boolean;
  /**
   * ORGANISATION availability flags. Apollo applies the same has_* pattern to
   * the nested organization object that it applies to the person, and returns
   * NO organisation values at search beyond `name` — verified live on
   * 2026-08-30 across three unrelated filter shapes (a 1-10 headcount query, a
   * 10001-50000 one, and a free-text q_keywords one). The org key set was
   * byte-identical every time:
   *
   *   name, has_industry, has_employee_count, has_revenue, has_phone,
   *   has_city, has_state, has_country, has_zip_code
   *
   * So industry, headcount, revenue and location are all enrich-only, and
   * linkedin_url / primary_domain / keywords are absent at search ENTIRELY —
   * not even as a flag. Do not add a preview column for those three: there is
   * nothing to populate it with, and a column of dashes reads as "this person
   * has no LinkedIn" rather than "we have not paid to look".
   *
   * THE DOMAIN QUESTION, settled adversarially on 2026-08-30 — it comes up
   * every time someone reads this table, because organization.primary_domain
   * plainly exists on the ENRICH side (see mapEnrichedPerson). It is not
   * merely missing from the searches we happened to run: a search filtered BY
   * domain (q_organization_domains_list: ['stripe.com']) — where Apollo knows
   * the exact domain it matched on — still returns
   *   {"name":"Stripe", has_industry, has_phone, has_city, has_state,
   *    has_country, has_zip_code, has_revenue, has_employee_count}
   * and nothing more. The whole organization object was dumped verbatim and
   * every key on both person and organization scanned against
   * /domain|website|url|site|www|href|link/ — no hit, across 7 searches. It is
   * a paywall, not an omission. Re-probing it will not change the answer.
   *
   * These flags are worth surfacing for the same reason has_email is: they say
   * what enrichment will actually yield for THIS person before any credits are
   * spent. A record with has_industry=false and has_employee_count=false is a
   * materially worse buy than one with both true.
   */
  org_has_industry: boolean;
  org_has_employee_count: boolean;
  org_has_revenue: boolean;
  org_has_phone: boolean;
  /**
   * When Apollo last refreshed this record. A REAL value, not a flag — the one
   * genuinely new datum the free search carries. Stale records enrich into
   * stale contact data, so this is a quality signal worth showing.
   */
  last_refreshed_at: string | null;
}

// deno-lint-ignore no-explicit-any
export function mapSearchPerson(raw: any): ApolloSearchPerson | null {
  const id = raw?.id ? String(raw.id) : null;
  if (!id) return null;
  return {
    apollo_person_id: id,
    first_name: raw.first_name ?? null,
    last_name_obfuscated: raw.last_name_obfuscated ?? raw.last_name ?? null,
    title: raw.title ?? null,
    organization_name: raw.organization?.name ?? raw.organization_name ?? null,
    has_email: truthyFlag(raw.has_email),
    has_direct_phone: truthyFlag(raw.has_direct_phone),
    has_city: truthyFlag(raw.has_city),
    has_state: truthyFlag(raw.has_state),
    has_country: truthyFlag(raw.has_country),
    // Read through truthyFlag like the person-level flags: these were observed
    // as real booleans, but has_direct_phone taught us Apollo will hand back
    // the STRING "Yes" for a flag without warning, and a `=== true` test on
    // that reports every record as missing the field.
    org_has_industry: truthyFlag(raw.organization?.has_industry),
    org_has_employee_count: truthyFlag(raw.organization?.has_employee_count),
    org_has_revenue: truthyFlag(raw.organization?.has_revenue),
    org_has_phone: truthyFlag(raw.organization?.has_phone),
    last_refreshed_at: raw.last_refreshed_at ?? null,
  };
}

/**
 * Total matching records.
 *
 * api_search returns `total_entries` at the TOP LEVEL and has no `pagination`
 * object at all — confirmed live, `'pagination' in data === false`. Reading
 * data.pagination.total_entries (as the docs imply) yields null and leaves the
 * UI unable to page. The pagination fallback is kept only in case the shape
 * ever changes back.
 */
// deno-lint-ignore no-explicit-any
export function readTotalEntries(data: any): number | null {
  const t = data?.total_entries ?? data?.pagination?.total_entries;
  return typeof t === "number" ? t : null;
}

// ---------------------------------------------------------------------------
// Enrich
// ---------------------------------------------------------------------------

export interface ApolloEnrichedPerson {
  apollo_person_id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  organization_name: string | null;
  organization_domain: string | null;
  /**
   * Firmographics. These are already inside the bulk_match payload we have
   * paid for, so mapping them costs nothing extra — and once Reveal exists they
   * stop being optional. The preview table advertises "Industry / Headcount /
   * Revenue available after enrichment" from the org has_* flags; if the reveal
   * that follows showed only an email, the promise on the row would be a lie.
   *
   * industry and estimated_num_employees were both observed live on the enrich
   * response (see probe_apollo_reenrich_cost.mjs, which prints them). Revenue is
   * read through a fallback chain because Apollo exposes it under more than one
   * name depending on plan — a missing value renders as absent, never as a
   * wrong number.
   */
  organization_industry: string | null;
  organization_employee_count: number | null;
  organization_revenue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  /** Apollo's own "we already revealed this to your team" marker. */
  revealed_for_current_team: boolean | null;
  /** Non-null when this person is already a saved Contact in the account. */
  contact_id: string | null;
}

// deno-lint-ignore no-explicit-any
export function mapEnrichedPerson(raw: any): ApolloEnrichedPerson | null {
  const id = raw?.id ? String(raw.id) : null;
  if (!id) return null;
  return {
    apollo_person_id: id,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    name: raw.name ?? null,
    title: raw.title ?? null,
    email: raw.email ?? null,
    email_status: raw.email_status ?? null,
    linkedin_url: raw.linkedin_url ?? null,
    organization_name: raw.organization?.name ?? null,
    organization_domain: raw.organization?.primary_domain ?? raw.organization?.website_url ?? null,
    organization_industry: raw.organization?.industry ?? null,
    organization_employee_count: typeof raw.organization?.estimated_num_employees === "number"
      ? raw.organization.estimated_num_employees
      : null,
    // BOTH KEYS VERIFIED LIVE 2026-08-30 by dumping the raw organization object
    // from bulk_match for a record whose org_has_revenue flag was true:
    //   organization_revenue_printed = "450M"   (string, display-ready)
    //   organization_revenue         = 450000000 (number)
    //
    // Note the `organization_` prefix ON A FIELD THAT IS ALREADY INSIDE the
    // organization object — organization.organization_revenue, not
    // organization.revenue. An earlier version of this mapper guessed
    // `annual_revenue` / `annual_revenue_printed`, which do not exist in the
    // payload at all, and so returned null for every company on earth while the
    // preview table cheerfully advertised "Revenue available after enrichment"
    // from the org_has_revenue flag. That combination — a flag promising data
    // and a mapper that cannot produce it — is worse than not offering the
    // field, which is why the names here are copied from an observed response
    // rather than from the docs or from memory.
    //
    // Prefer the preformatted string; fall back to the raw number. Never
    // compute or round one ourselves — a revenue figure the operator cannot
    // trace back to Apollo is worse than a blank.
    organization_revenue: typeof raw.organization?.organization_revenue_printed === "string"
      ? raw.organization.organization_revenue_printed
      : typeof raw.organization?.organization_revenue === "number"
      ? String(raw.organization.organization_revenue)
      : null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    country: raw.country ?? null,
    revealed_for_current_team: typeof raw.revealed_for_current_team === "boolean"
      ? raw.revealed_for_current_team
      : null,
    contact_id: raw.contact_id ? String(raw.contact_id) : null,
  };
}

/** Split ids into Apollo-sized chunks (10). */
export function chunkIds(ids: string[], size = ENRICH_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * bulk_match response envelope.
 *
 * Verified live 2026-08-16. The response carries, at top level:
 *   status, error_code, error_message, total_requested_enrichments,
 *   matches, unique_enriched_records, missing_records, credits_consumed,
 *   request_id
 *
 * `credits_consumed` MATTERS: Apollo states what it charged. An earlier version
 * of this code inferred spend by counting records that came back with an email,
 * which is a guess dressed as a number — and agent_audience_runs.credits_spent
 * is meant to be auditable against the Apollo dashboard. Always prefer the
 * reported value; the count is only a fallback for a malformed response.
 */
export interface ApolloEnrichEnvelope {
  people: ApolloEnrichedPerson[];
  /** Apollo's own figure. null when the field is absent (then use the fallback). */
  creditsConsumed: number | null;
  totalRequested: number | null;
  uniqueEnriched: number | null;
  missingRecords: number | null;
  errorCode: unknown;
  errorMessage: string | null;
}

// deno-lint-ignore no-explicit-any
export function readEnrichEnvelope(data: any): ApolloEnrichEnvelope {
  const arr: unknown[] = Array.isArray(data?.matches)
    ? data.matches
    : Array.isArray(data?.people)
    ? data.people
    : [];
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    people: arr.map(mapEnrichedPerson).filter((p): p is ApolloEnrichedPerson => p !== null),
    creditsConsumed: num(data?.credits_consumed),
    totalRequested: num(data?.total_requested_enrichments),
    uniqueEnriched: num(data?.unique_enriched_records),
    missingRecords: num(data?.missing_records),
    errorCode: data?.error_code ?? null,
    errorMessage: typeof data?.error_message === "string" ? data.error_message : null,
  };
}
