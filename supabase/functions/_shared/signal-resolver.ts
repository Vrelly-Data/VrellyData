// Signal -> company -> people. Cheapest first:
//
//   a) VRELLY PROSPECTS (free) at the signal's company — by normalized domain,
//      or name + state when the signal has none (which also DERIVES a domain).
//      Every #107 guard applies. One SQL call for the whole batch:
//      signals_resolve_people.
//   b) THE SIGNAL'S OWN NAMED PERSON (free), when their title matches the
//      persona and they have an email (on the signal, or as a prospect). Same
//      SQL call.
//   c) APOLLO (paid), only for companies a) and b) found NOBODY at, and only
//      with a domain (the signal's or the derived one):
//        - signal_contacts first: a company already bought for this user in
//          the last 30 days is served from there, at no cost;
//        - a company Apollo had nobody for in the last 30 days is not searched
//          again (signal_company_lookups);
//        - api_search by organization domain + persona (FREE), titles re-checked
//          as whole words, people already pushed by Apollo id dropped;
//        - bulk_match enrichment through apollo-enrich (PAID; it keeps its own
//          per-user cache), never more than the remaining monthly budget.
//          Apollo's 422 "insufficient credits" or an exhausted budget stops the
//          fallback for the rest of the batch; what was bought is kept.
//      In PREVIEW mode nothing is enriched: Apollo candidates come back as
//      'pending' and are counted into estimated_credits.
//
// The resolver never decides visibility: the SQL drops signals the user may not
// see (counted in `refused`), and candidates come from
// signals_audience_candidates, which applies the same rule.
//
// All I/O is injected (ResolverDeps) so the order, the budget and the 422
// behaviour are unit-tested without a network.

import { publicTypeKey } from "./signal-catalog.ts";
import { normalizeDomain } from "./signals.ts";
import { normalizeEmailKey, normalizeLinkedInUrl } from "./lead-dedup.ts";
import type { ApolloEnrichedPerson, ApolloSearchPerson } from "./apollo.ts";
import { type CompiledSignalAudience, titleMatcher } from "./signal-audience.ts";

export type PersonSource = "vrelly" | "signal" | "apollo";

export interface ResolvedPerson {
  source: PersonSource;
  prospect_id?: string | null;
  apollo_person_id?: string | null;
  /** null only for a preview's not-yet-enriched Apollo candidate. */
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority?: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  /** Preview only: an Apollo candidate that would cost a credit to enrich. */
  pending?: boolean;
  /** Served from signal_contacts (bought earlier). */
  cached?: boolean;
}

/**
 * A signal as signals_audience_candidates returns it: CLIENT-SAFE. `type` is
 * the PUBLIC key (high_intent, never positive_response); there is no source
 * key, and a High Intent payload carries nothing about how it was found.
 */
export interface CandidateSignal {
  id: string;
  type: string;
  markets?: string[];
  occurred_at: string;
  title: string;
  url: string | null;
  score: number;
  company_name: string | null;
  company_domain: string | null;
  person_name: string | null;
  person_title: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  payload?: Record<string, unknown>;
}

export interface FreeResolution {
  signal_id: string;
  company_key: string | null;
  domain: string | null;
  derived_domain: string | null;
  people: ResolvedPerson[];
}

export type ApolloStatus =
  | "not_needed"        // a) or b) found people
  | "cached"            // served from signal_contacts, 0 credits
  | "enriched"          // bought now
  | "pending"           // preview: would be bought
  | "none_found"        // Apollo has nobody matching (now, or within 30 days)
  | "no_domain"         // no domain, not even a derived one
  | "disabled"          // the audience turned the paid fallback off
  | "persona_unsupported" // department-only persona: Apollo cannot honour it
  | "budget"            // monthly cap reached before this company
  | "insufficient_credits" // Apollo 422
  | "failed";           // Apollo error

export interface ResolvedSignal {
  signal: CandidateSignal;
  company_key: string | null;
  /** The domain people were matched on (the signal's, else derived). */
  domain: string | null;
  derived_domain: string | null;
  people: ResolvedPerson[];
  apollo: ApolloStatus;
  apollo_error?: string;
  /** Preview: credits enriching this company's Apollo candidates would cost (at most). */
  estimated_credits: number;
}

export interface CachedContact extends ResolvedPerson {
  company_key: string;
  resolved_at: string;
}

export interface EnrichResult {
  people: ApolloEnrichedPerson[];
  credits_spent: number;
  insufficient_credits: boolean;
  failed: number;
}

export interface ResolverDeps {
  /** signals_resolve_people. */
  resolveFree(signalIds: string[]): Promise<{ signals: FreeResolution[]; refused: number }>;
  /** Fresh (<= CACHE_TTL_DAYS) apollo rows in signal_contacts, by company_key. */
  readCache(companyKeys: string[]): Promise<Map<string, CachedContact[]>>;
  /** signal_company_lookups rows, by company_key. */
  readLookups(companyKeys: string[]): Promise<Map<string, { apollo_searched_at: string | null; apollo_candidates: number }>>;
  /** Free api_search; throws on HTTP failure. */
  apolloSearch(domain: string, persona: { person_titles: string[]; person_seniorities: string[] }, perPage: number): Promise<ApolloSearchPerson[]>;
  /** Paid bulk_match through apollo-enrich (<= 10 ids). */
  apolloEnrich(ids: string[]): Promise<EnrichResult>;
  /** Apollo ids this user already pushed. */
  pushedApolloIds(ids: string[]): Promise<Set<string>>;
  /** Emails / LinkedIn keys this user already pushed, has as leads or synced contacts. */
  knownContacts(emails: string[], linkedinKeys: string[]): Promise<{ emails: Set<string>; linkedins: Set<string> }>;
  writeCache(rows: Array<ResolvedPerson & { company_key: string; signal_id: string }>): Promise<void>;
  writeLookup(row: { company_key: string; domain: string; apollo_candidates: number; apollo_enriched: number }): Promise<void>;
}

export interface ResolveOptions {
  mode: "preview" | "run";
  compiled: CompiledSignalAudience;
  /** Credits this run may still spend (Infinity on a client's own key). */
  budget: number;
}

export interface ResolveOutcome {
  resolved: ResolvedSignal[];
  credits_spent: number;
  estimated_credits: number;
  stop_reason: "monthly_cap" | "apollo_insufficient_credits" | null;
  refused: number;
  apollo_calls: { search: number; enrich: number };
}

export const CACHE_TTL_DAYS = 30;
/** How many Apollo results to look through per company. */
export const APOLLO_SEARCH_PER_PAGE = 25;

const FOREIGN_TLD_OK = new Set(["us", "io", "co", "ai", "me", "tv", "ly", "so", "fm", "gg", "sh", "cc", "to", "ws", "la", "vc"]);
const US = new Set(["united states", "us", "usa", "united states of america", "u.s.", "u.s.a."]);

/** The email's domain is the company domain or a subdomain of it (#107). */
export function emailAtDomain(email: string | null | undefined, domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain);
  const at = String(email ?? "").toLowerCase().split("@")[1];
  if (!d || !at) return false;
  return at === d || at.endsWith(`.${d}`);
}

/** #107 US rules for one person: no foreign-ccTLD email, no non-US country. */
export function passesUsRules(email: string | null | undefined, country: string | null | undefined): boolean {
  const tld = String(email ?? "").toLowerCase().match(/\.([a-z]{2})$/)?.[1];
  if (tld && !FOREIGN_TLD_OK.has(tld)) return false;
  const c = String(country ?? "").trim().toLowerCase();
  return !c || US.has(c);
}

function fromEnriched(p: ApolloEnrichedPerson): ResolvedPerson {
  return {
    source: "apollo",
    apollo_person_id: p.apollo_person_id,
    email: p.email ? p.email.toLowerCase() : null,
    first_name: p.first_name, last_name: p.last_name, title: p.title,
    linkedin_url: p.linkedin_url,
    company_name: p.organization_name, company_domain: normalizeDomain(p.organization_domain),
    city: p.city, state: p.state, country: p.country,
  };
}

/** People a push would not skip: unknown email AND unknown LinkedIn. */
async function dropKnown(people: ResolvedPerson[], deps: ResolverDeps): Promise<ResolvedPerson[]> {
  const withEmail = people.filter((p) => p.email);
  if (!withEmail.length) return people;
  const known = await deps.knownContacts(
    withEmail.map((p) => normalizeEmailKey(p.email)).filter((e): e is string => !!e),
    withEmail.map((p) => normalizeLinkedInUrl(p.linkedin_url)).filter((l): l is string => !!l),
  );
  return people.filter((p) => {
    const e = normalizeEmailKey(p.email);
    const l = normalizeLinkedInUrl(p.linkedin_url);
    return !(e && known.emails.has(e)) && !(l && known.linkedins.has(l));
  });
}

export async function resolveSignals(
  signals: CandidateSignal[],
  opts: ResolveOptions,
  deps: ResolverDeps,
): Promise<ResolveOutcome> {
  const out: ResolveOutcome = {
    resolved: [], credits_spent: 0, estimated_credits: 0, stop_reason: null, refused: 0,
    apollo_calls: { search: 0, enrich: 0 },
  };
  if (!signals.length) return out;
  const c = opts.compiled;

  // ---- a) + b): free, one call -------------------------------------------
  const free = await deps.resolveFree(signals.map((s) => s.id));
  out.refused = free.refused;
  const byId = new Map(free.signals.map((r) => [r.signal_id, r]));

  const resolved: ResolvedSignal[] = [];
  for (const s of signals) {
    const f = byId.get(s.id);
    if (!f) continue; // not visible to this user — never resolved
    const domain = normalizeDomain(f.domain) ?? normalizeDomain(f.derived_domain);
    resolved.push({
      signal: s, company_key: f.company_key, domain, derived_domain: f.derived_domain,
      people: f.people.map((p) => ({ ...p, email: p.email ? p.email.toLowerCase() : null })),
      apollo: f.people.length ? "not_needed" : "none_found",
      estimated_credits: 0,
    });
  }
  out.resolved = resolved;

  // ---- c) Apollo, only where nobody was found ------------------------------
  const needs = resolved.filter((r) => r.people.length === 0);
  for (const r of needs) {
    if (!c.useApollo) r.apollo = "disabled";
    else if (!c.apollo) r.apollo = "persona_unsupported";
    else if (!r.domain || !r.company_key) r.apollo = "no_domain";
    else r.apollo = "pending"; // provisional: decided below
  }
  const apolloable = needs.filter((r) => r.apollo === "pending");
  if (!apolloable.length) return out;

  const keys = [...new Set(apolloable.map((r) => r.company_key!))];
  const [cache, lookups] = await Promise.all([deps.readCache(keys), deps.readLookups(keys)]);
  const titleOk = titleMatcher(c.filters.persona?.job_titles);
  const titleExcluded = titleMatcher(c.filters.persona?.exclude_job_titles);
  const now = Date.now();
  const ttl = CACHE_TTL_DAYS * 86_400_000;
  // Two signals at one company resolve once.
  const done = new Map<string, Pick<ResolvedSignal, "people" | "apollo" | "apollo_error" | "estimated_credits">>();

  for (const r of apolloable) {
    const key = r.company_key!;
    const prior = done.get(key);
    if (prior) {
      Object.assign(r, { ...prior, people: [...prior.people], estimated_credits: 0 });
      continue;
    }
    const settle = (v: Pick<ResolvedSignal, "people" | "apollo" | "apollo_error" | "estimated_credits">) => {
      Object.assign(r, v);
      done.set(key, v);
    };

    // Already bought for this user: free.
    const cached = (cache.get(key) ?? []).filter((p) => now - Date.parse(p.resolved_at) <= ttl);
    if (cached.length) {
      const people = (await dropKnown(cached.map((p) => ({ ...p, source: "apollo" as const, cached: true })), deps))
        .slice(0, c.perCompany);
      settle({ people, apollo: people.length ? "cached" : "none_found", estimated_credits: 0 });
      continue;
    }
    const lk = lookups.get(key);
    if (lk?.apollo_searched_at && lk.apollo_candidates === 0 && now - Date.parse(lk.apollo_searched_at) <= ttl) {
      settle({ people: [], apollo: "none_found", estimated_credits: 0 });
      continue;
    }
    if (out.stop_reason) {
      settle({ people: [], apollo: out.stop_reason === "monthly_cap" ? "budget" : "insufficient_credits", estimated_credits: 0 });
      continue;
    }
    if (opts.mode === "run" && opts.budget - out.credits_spent <= 0) {
      out.stop_reason = "monthly_cap";
      settle({ people: [], apollo: "budget", estimated_credits: 0 });
      continue;
    }

    // Free search.
    let found: ApolloSearchPerson[];
    try {
      out.apollo_calls.search++;
      found = await deps.apolloSearch(r.domain!, c.apollo!, APOLLO_SEARCH_PER_PAGE);
    } catch (e) {
      settle({ people: [], apollo: "failed", apollo_error: e instanceof Error ? e.message : String(e), estimated_credits: 0 });
      continue;
    }
    let picks = found.filter((p) =>
      p.has_email && (!titleOk || titleOk(p.title)) && !(titleExcluded && titleExcluded(p.title))
    );
    if (picks.length) {
      const pushed = await deps.pushedApolloIds(picks.map((p) => p.apollo_person_id));
      picks = picks.filter((p) => !pushed.has(p.apollo_person_id));
    }
    picks = picks.slice(0, c.perCompany);
    if (!picks.length) {
      if (opts.mode === "run") {
        await deps.writeLookup({ company_key: key, domain: r.domain!, apollo_candidates: 0, apollo_enriched: 0 });
      }
      settle({ people: [], apollo: "none_found", estimated_credits: 0 });
      continue;
    }

    if (opts.mode === "preview") {
      out.estimated_credits += picks.length;
      settle({
        people: picks.map((p) => ({
          source: "apollo", apollo_person_id: p.apollo_person_id, email: null, pending: true,
          first_name: p.first_name, last_name: p.last_name_obfuscated, title: p.title,
          linkedin_url: null, company_name: p.organization_name ?? r.signal.company_name, company_domain: r.domain,
          city: null, state: null, country: null,
        })),
        apollo: "pending",
        estimated_credits: picks.length,
      });
      continue;
    }

    // Paid enrichment, within budget.
    const room = opts.budget - out.credits_spent;
    const ids = picks.slice(0, Math.max(0, Math.min(picks.length, Number.isFinite(room) ? Math.floor(room) : picks.length)))
      .map((p) => p.apollo_person_id);
    out.apollo_calls.enrich++;
    let er: EnrichResult;
    try {
      er = await deps.apolloEnrich(ids);
    } catch (e) {
      settle({ people: [], apollo: "failed", apollo_error: e instanceof Error ? e.message : String(e), estimated_credits: 0 });
      continue;
    }
    out.credits_spent += er.credits_spent;
    if (er.insufficient_credits) out.stop_reason = "apollo_insufficient_credits";

    const usable = er.people.map(fromEnriched).filter((p) =>
      !!normalizeEmailKey(p.email) &&
      emailAtDomain(p.email, r.domain) &&
      (!titleOk || titleOk(p.title)) &&
      !(titleExcluded && titleExcluded(p.title)) &&
      (!c.usOnly || passesUsRules(p.email, p.country))
    ).map((p) => ({ ...p, company_domain: p.company_domain ?? r.domain }));

    if (usable.length) {
      await deps.writeCache(usable.map((p) => ({ ...p, company_key: key, signal_id: r.signal.id })));
    }
    await deps.writeLookup({ company_key: key, domain: r.domain!, apollo_candidates: picks.length, apollo_enriched: usable.length });
    const people = (await dropKnown(usable, deps)).slice(0, c.perCompany);
    settle({
      people,
      apollo: people.length ? "enriched" : er.insufficient_credits ? "insufficient_credits" : "none_found",
      estimated_credits: 0,
    });
    if (ids.length < picks.length && !out.stop_reason) out.stop_reason = "monthly_cap";
  }
  return out;
}

/**
 * Custom fields every pushed contact carries, so copy can reference the
 * signal. Client-facing (they land in the client's Reply.io / Smartlead):
 * signal_type is the PUBLIC key — "high_intent", never "positive_response".
 */
export function signalCustomFields(s: Pick<CandidateSignal, "type" | "title" | "occurred_at" | "url">): Record<string, string> {
  return {
    signal_type: publicTypeKey(s.type),
    signal_title: s.title.slice(0, 250),
    signal_date: String(s.occurred_at).slice(0, 10),
    signal_url: s.url ?? "",
  };
}
