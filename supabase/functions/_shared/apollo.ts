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

/** The filter subset we expose. Names are Apollo's, verbatim. */
export interface ApolloSearchFilters {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[]; // "1,10"
  q_organization_domains_list?: string[];
  contact_email_status?: string[];
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
] as const;

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
