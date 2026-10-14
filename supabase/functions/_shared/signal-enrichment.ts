// High Intent auto-enrichment: fill a signal's missing firmographics, free
// sources first, Apollo (paid) last and only when the owning team opted in.
//
// FIELDS: industry, person_title, seniority, location (city/state/country),
// company_size. A field the signal already has is never overwritten.
//
// ORDER (each step only fills what is still empty):
//   1. Vrelly prospects matched by the person's EMAIL       (person + company)
//   2. Vrelly prospects matched by the COMPANY DOMAIN       (company only:
//      industry, size — the most common value among the domain's prospects;
//      a personal-mail domain is never used)
//   3. existing INFERENCE data for the same person (other inference_events
//      rows, their metadata: employees, company keywords)
//   4. APOLLO people/bulk_match — only when teams.signals_apollo_enrich is on
//      for the signal's team, only while that team's monthly budget lasts
//      (agent_configs.apollo_monthly_credit_cap on the shared key, the same
//      ledger as audiences), and it stops for the run on Apollo's 422
//      "insufficient credits". Admin-only signals (no team) never use Apollo.
//
// RESULT: stored on the signal (columns + enrichment provenance) and written
// back to the backing inference_events rows' EMPTY fields only (the deps do
// both; the SQL refuses to overwrite a non-empty value).
//
// Pure: all I/O is in EnrichDeps, so the order is unit-tested.

import { assignMarkets } from "./signal-markets.ts";
import { highIntentTitle } from "./signal-catalog.ts";

export const ENRICH_FIELDS = ["industry", "person_title", "seniority", "city", "state", "country", "company_size"] as const;
export type EnrichField = typeof ENRICH_FIELDS[number];
export type FieldValues = Partial<Record<EnrichField, string | null>>;
export type Provenance = "signal" | "prospects_email" | "prospects_domain" | "inference" | "apollo";

/** Apollo bulk_match takes 10 records per call (Apollo's limit). */
export const APOLLO_CHUNK = 10;
/** Most Apollo records one run may try to buy, across all teams. */
export const APOLLO_MAX_PER_RUN = 50;
/** Signals per signals_hi_free_lookups call; a failed chunk is retried next run. */
export const FREE_LOOKUP_CHUNK = 250;

export const PERSONAL_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net",
  "verizon.net", "bellsouth.net", "cox.net", "charter.net", "protonmail.com", "proton.me", "gmx.com", "mail.com",
  "zoho.com", "yandex.com", "earthlink.net", "optonline.net", "frontier.com", "q.com", "rocketmail.com",
]);

export interface EnrichTarget {
  signal_id: string;
  team_id: string | null;
  person_key: string;
  person_name: string | null;
  company_name: string | null;
  company_domain: string | null;
  email: string | null;
  linkedin: string | null;
  team_default_market: string | null;
  /** The signal's current values. */
  current: FieldValues;
  /** Apollo already tried for this signal (any outcome). */
  apollo_done: boolean;
  /** Free steps already done (a later run only revisits Apollo). */
  free_done: boolean;
  /** Company keywords etc. already known, for market assignment. */
  keywords?: string[] | null;
}

export interface FreeLookups {
  /** By lower-cased email. */
  byEmail: Map<string, FieldValues>;
  /** By company domain (lower-cased, no www). */
  byDomain: Map<string, FieldValues & { keywords?: string | null }>;
  /** By signal_id: what the person's other inference rows know. */
  inference: Map<string, FieldValues & { keywords?: string[] | null }>;
}

export interface TeamApollo {
  enabled: boolean;
  user_id: string | null;
  agent_config_id: string | null;
}

export interface ApolloBudgetView {
  key: string;
  keySource: "client" | "shared";
  remaining: number;
}

export interface ApolloMatchDetail {
  email?: string;
  name?: string;
  domain?: string;
  organization_name?: string;
  linkedin_url?: string;
}

export interface ApolloMatchResult {
  /** Same order and length as the request; null = no match. */
  matches: Array<FieldValues | null>;
  credits: number;
  insufficient: boolean;
  error?: string | null;
}

export interface EnrichResult {
  signal_id: string;
  team_id: string | null;
  person_key: string;
  /** Final values (current + newly filled). */
  values: FieldValues;
  /** Only the fields this run filled, with where each came from. */
  filled: Partial<Record<EnrichField, Provenance>>;
  markets: string[];
  title: string;
  free_done: boolean;
  apollo_status: ApolloStatus | null;
}

/**
 * not_needed / matched / no_match / no_identifier are final; the rest are
 * retried on a later dispatch (a team that turns Apollo on later, a new month's
 * budget, credits topped up, a transient error).
 */
export type ApolloStatus =
  | "not_needed" | "matched" | "no_match" | "no_identifier"
  | "disabled" | "budget" | "insufficient_credits" | "error" | "deferred";
export const APOLLO_FINAL: readonly ApolloStatus[] = ["not_needed", "matched", "no_match", "no_identifier"];

export interface EnrichDeps {
  freeLookups(targets: EnrichTarget[]): Promise<FreeLookups>;
  teamApollo(teamIds: string[]): Promise<Map<string, TeamApollo>>;
  /** null = Apollo not configured for this user. Throws when the budget cannot be read. */
  apolloBudget(userId: string, agentConfigId: string): Promise<ApolloBudgetView | null>;
  apolloMatch(key: string, details: ApolloMatchDetail[]): Promise<ApolloMatchResult>;
  recordSpend(row: { team_id: string; user_id: string; agent_config_id: string; credits: number; key_source: string; records: number }): Promise<void>;
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

export function emailDomain(email: string | null | undefined): string | null {
  const m = /@([^@\s]+)$/.exec(String(email ?? "").trim().toLowerCase());
  return m ? m[1].replace(/^www\./, "") : null;
}

/** The company domain to look up: the signal's own, else the email's unless it is personal mail. */
export function lookupDomain(t: Pick<EnrichTarget, "company_domain" | "email">): string | null {
  const own = (t.company_domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (own) return PERSONAL_MAIL_DOMAINS.has(own) ? null : own;
  const d = emailDomain(t.email);
  return d && !PERSONAL_MAIL_DOMAINS.has(d) ? d : null;
}

/** Numbers of employees → the bucket inference_events uses; "251 to 500" → "251-500". */
export function normalizeCompanySize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n <= 10) return "1-10";
    if (n <= 50) return "11-50";
    if (n <= 200) return "51-200";
    if (n <= 500) return "201-500";
    if (n <= 1000) return "501-1000";
    if (n <= 5000) return "1001-5000";
    return "5001+";
  }
  const s = String(v).trim().replace(/\s+to\s+/i, "-");
  return s || null;
}

export function normalizeSeniority(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return s || null;
}

/** Fields still empty in `values`. Location counts as missing only when state AND country are unknown. */
export function missingFields(values: FieldValues): EnrichField[] {
  const out: EnrichField[] = [];
  for (const f of ["industry", "person_title", "seniority", "company_size"] as const) if (blank(values[f])) out.push(f);
  if (blank(values.state) && blank(values.country)) out.push("city", "state", "country");
  else for (const f of ["city", "state", "country"] as const) if (blank(values[f])) out.push(f);
  return out;
}

/** Does this signal still need Apollo? Only for the fields that matter for targeting (city alone does not). */
export function needsApollo(values: FieldValues): boolean {
  const m = new Set(missingFields(values));
  return ["industry", "person_title", "seniority", "company_size", "country"].some((f) => m.has(f as EnrichField));
}

/** Fill empty fields of `values` from `src`; record provenance. Never overwrites. */
export function fillFrom(
  values: FieldValues,
  filled: Partial<Record<EnrichField, Provenance>>,
  src: FieldValues | null | undefined,
  prov: Provenance,
  only?: readonly EnrichField[],
): void {
  if (!src) return;
  for (const f of only ?? ENRICH_FIELDS) {
    if (!blank(values[f]) || blank(src[f])) continue;
    let v = String(src[f]).trim();
    if (f === "company_size") v = normalizeCompanySize(v) ?? v;
    if (f === "seniority") v = normalizeSeniority(v) ?? v;
    values[f] = v;
    filled[f] = prov;
  }
}

const COMPANY_FIELDS: readonly EnrichField[] = ["industry", "company_size"];

/** Steps 1–3 for one target, given the lookups. */
export function applyFree(t: EnrichTarget, lk: FreeLookups): { values: FieldValues; filled: Partial<Record<EnrichField, Provenance>>; keywords: string[] } {
  const values: FieldValues = { ...t.current };
  const filled: Partial<Record<EnrichField, Provenance>> = {};
  const email = (t.email ?? "").trim().toLowerCase();
  if (email) fillFrom(values, filled, lk.byEmail.get(email), "prospects_email");
  const domain = lookupDomain(t);
  const dom = domain ? lk.byDomain.get(domain) : undefined;
  fillFrom(values, filled, dom, "prospects_domain", COMPANY_FIELDS);
  const inf = lk.inference.get(t.signal_id);
  fillFrom(values, filled, inf, "inference");
  const keywords = [...(t.keywords ?? []), ...(inf?.keywords ?? []), ...(dom?.keywords ? [dom.keywords] : [])];
  return { values, filled, keywords };
}

function finish(
  t: EnrichTarget, values: FieldValues, filled: Partial<Record<EnrichField, Provenance>>, keywords: string[],
  apollo: ApolloStatus | null,
): EnrichResult {
  return {
    signal_id: t.signal_id,
    team_id: t.team_id,
    person_key: t.person_key,
    values,
    filled,
    markets: assignMarkets({
      signal_type: "positive_response", industry: values.industry ?? null, keywords, team_default_market: t.team_default_market,
    }),
    title: highIntentTitle({ name: t.person_name, title: values.person_title ?? null, company: t.company_name }),
    free_done: true,
    apollo_status: apollo,
  };
}

export interface EnrichSummary {
  results: EnrichResult[];
  free_filled: number;
  apollo_records: number;
  apollo_matched: number;
  credits_spent: number;
  insufficient_credits: boolean;
  /** Free-lookup chunks that failed; their signals are left out of `results` (still queued). */
  free_chunks_failed: number;
  errors: string[];
}

/** The whole enrichment pass over a queue of targets. */
export async function enrichHighIntent(
  targets: EnrichTarget[],
  deps: EnrichDeps,
  opts: { apolloMaxPerRun?: number; freeChunk?: number } = {},
): Promise<EnrichSummary> {
  const errors: string[] = [];
  const summary: EnrichSummary = {
    results: [], free_filled: 0, apollo_records: 0, apollo_matched: 0, credits_spent: 0, insufficient_credits: false,
    free_chunks_failed: 0, errors,
  };
  if (!targets.length) return summary;

  // ---- 1–3: free, for everyone, in chunks of lookups. A failed chunk is
  // logged and skipped (its signals stay queued for the next run); the rest go on.
  const size = Math.max(1, opts.freeChunk ?? FREE_LOOKUP_CHUNK);
  const chunks = Math.ceil(targets.length / size);
  const staged: Array<{ t: EnrichTarget } & ReturnType<typeof applyFree>> = [];
  for (let c = 0; c < chunks; c++) {
    const part = targets.slice(c * size, (c + 1) * size);
    let lk: FreeLookups;
    try {
      lk = await deps.freeLookups(part);
    } catch (e) {
      const msg = `free lookups chunk ${c + 1}/${chunks} (${part.length} signals): ${e instanceof Error ? e.message : e}`;
      console.error(`[signal-enrichment] ${msg}`);
      errors.push(msg);
      summary.free_chunks_failed++;
      continue;
    }
    for (const t of part) {
      const r = applyFree(t, lk);
      summary.free_filled += Object.keys(r.filled).length;
      staged.push({ t, ...r });
    }
  }

  // ---- 4: Apollo, only where still needed and the team opted in
  const teamIds = [...new Set(staged.filter((s) => s.t.team_id && !s.t.apollo_done && needsApollo(s.values)).map((s) => s.t.team_id!))];
  const teams = teamIds.length ? await deps.teamApollo(teamIds) : new Map<string, TeamApollo>();
  const status = new Map<string, ApolloStatus>();
  let runLeft = opts.apolloMaxPerRun ?? APOLLO_MAX_PER_RUN;

  for (const teamId of teamIds) {
    const team = teams.get(teamId);
    const mine = staged.filter((s) => s.t.team_id === teamId && !s.t.apollo_done && needsApollo(s.values));
    if (!team?.enabled || !team.user_id || !team.agent_config_id) {
      for (const s of mine) status.set(s.t.signal_id, "disabled");
      continue;
    }
    if (summary.insufficient_credits || runLeft <= 0) {
      for (const s of mine) status.set(s.t.signal_id, "deferred");
      continue;
    }
    let budget: ApolloBudgetView | null;
    try {
      budget = await deps.apolloBudget(team.user_id, team.agent_config_id);
    } catch (e) {
      // An unknown budget is not permission to spend.
      errors.push(`apollo budget (team ${teamId}): ${e instanceof Error ? e.message : e}`);
      for (const s of mine) status.set(s.t.signal_id, "deferred");
      continue;
    }
    if (!budget) {
      for (const s of mine) status.set(s.t.signal_id, "disabled");
      continue;
    }
    const withId = mine.filter((s) => s.t.email || s.t.linkedin || (s.t.person_name && lookupDomain(s.t)));
    for (const s of mine) if (!withId.includes(s)) status.set(s.t.signal_id, "no_identifier");

    let teamLeft = budget.remaining;
    for (let i = 0, n = 0; i < withId.length; i += n) {
      n = Math.min(APOLLO_CHUNK, runLeft, Math.floor(teamLeft));
      if (summary.insufficient_credits || n <= 0) {
        for (const s of withId.slice(i)) status.set(s.t.signal_id, teamLeft < 1 ? "budget" : "deferred");
        break;
      }
      const chunk = withId.slice(i, i + n);
      const details: ApolloMatchDetail[] = chunk.map((s) => {
        const d: ApolloMatchDetail = {};
        if (s.t.email) d.email = s.t.email;
        if (s.t.linkedin) d.linkedin_url = s.t.linkedin;
        if (s.t.person_name) d.name = s.t.person_name;
        const dom = lookupDomain(s.t);
        if (dom) d.domain = dom;
        if (s.t.company_name) d.organization_name = s.t.company_name;
        return d;
      });
      let res: ApolloMatchResult;
      try {
        res = await deps.apolloMatch(budget.key, details);
      } catch (e) {
        errors.push(`apollo match: ${e instanceof Error ? e.message : e}`);
        for (const s of chunk) status.set(s.t.signal_id, "error");
        continue;
      }
      summary.apollo_records += chunk.length;
      runLeft -= chunk.length;
      teamLeft -= res.credits;
      summary.credits_spent += res.credits;
      // Every call is ledgered (0 credits included), so spend reconciles with Apollo.
      try {
        await deps.recordSpend({
          team_id: teamId, user_id: team.user_id, agent_config_id: team.agent_config_id,
          credits: res.credits, key_source: budget.keySource, records: chunk.length,
        });
      } catch (e) {
        errors.push(`apollo spend ledger: ${e instanceof Error ? e.message : e}`);
      }
      if (res.insufficient) {
        // Apollo's 422: stop cleanly for this run; nothing in this chunk was bought.
        summary.insufficient_credits = true;
        for (const s of withId.slice(i)) status.set(s.t.signal_id, "insufficient_credits");
        break;
      }
      if (res.error) {
        errors.push(`apollo match: ${res.error}`);
        for (const s of chunk) status.set(s.t.signal_id, "error");
        continue;
      }
      chunk.forEach((s, k) => {
        const m = res.matches[k] ?? null;
        if (m) {
          summary.apollo_matched++;
          fillFrom(s.values, s.filled, m, "apollo");
          status.set(s.t.signal_id, "matched");
        } else {
          status.set(s.t.signal_id, "no_match");
        }
      });
    }
  }

  for (const s of staged) {
    const st = status.get(s.t.signal_id) ?? (s.t.apollo_done ? null : needsApollo(s.values) ? "disabled" : "not_needed");
    summary.results.push(finish(s.t, s.values, s.filled, s.keywords, st));
  }
  return summary;
}
