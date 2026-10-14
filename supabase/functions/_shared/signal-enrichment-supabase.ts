// Real I/O for _shared/signal-enrichment.ts.
//
//   free lookups   signals_hi_free_lookups (prospects by email, by domain;
//                  the person's other inference rows) — one call per chunk of
//                  FREE_LOOKUP_CHUNK signals (the caller chunks)
//   team opt-in    signals_hi_team_apollo (teams.signals_apollo_enrich + the
//                  team's agent config / user)
//   budget         readApolloBudget — the same monthly cap and ledger the
//                  audiences use (it now counts this enrichment's spend too)
//   Apollo         people/bulk_match, ≤10 records per call, never personal
//                  emails or phones; 422 "credits" = insufficient
//   ledger         signal_enrichment_spend, one row per Apollo call

import { APOLLO_BASE, apolloHeaders } from "./apollo.ts";
import { readApolloBudget } from "./signal-resolver-supabase.ts";
import {
  type ApolloMatchDetail, type ApolloMatchResult, APOLLO_CHUNK, type EnrichDeps, type FieldValues, type FreeLookups,
  normalizeCompanySize, normalizeSeniority, type TeamApollo,
} from "./signal-enrichment.ts";
import { lookupDomain } from "./signal-enrichment.ts";

/** Apollo's out-of-credits refusal (same rule as apollo-enrich). */
export function isInsufficientCredits(status: number, body: string): boolean {
  return status === 422 && /credit/i.test(body);
}

// deno-lint-ignore no-explicit-any
export function apolloPersonToFields(raw: any): FieldValues | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const org = raw.organization ?? {};
  return {
    person_title: raw.title ?? null,
    seniority: normalizeSeniority(raw.seniority),
    city: raw.city ?? null,
    state: raw.state ?? null,
    country: raw.country ?? null,
    industry: org.industry ?? null,
    company_size: normalizeCompanySize(org.estimated_num_employees ?? null),
  };
}

/** One bulk_match call. Never throws on an HTTP error: it is reported in the result. */
export async function apolloBulkMatch(fetchFn: typeof fetch, key: string, details: ApolloMatchDetail[]): Promise<ApolloMatchResult> {
  if (details.length > APOLLO_CHUNK) throw new Error(`bulk_match takes at most ${APOLLO_CHUNK} records`);
  const res = await fetchFn(`${APOLLO_BASE}/people/bulk_match`, {
    method: "POST",
    headers: apolloHeaders(key),
    // Never personal emails or phones: firmographics only.
    body: JSON.stringify({ reveal_personal_emails: false, reveal_phone_number: false, details }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    return {
      matches: details.map(() => null), credits: 0,
      insufficient: isInsufficientCredits(res.status, body),
      error: isInsufficientCredits(res.status, body) ? null : `bulk_match HTTP ${res.status}`,
    };
  }
  const j = await res.json().catch(() => null);
  const raw: unknown[] = Array.isArray(j?.matches) ? j.matches : [];
  const matches = details.map((_, i) => apolloPersonToFields(raw[i]));
  // Apollo's own figure wins; the count of matches is only a fallback.
  const credits = typeof j?.credits_consumed === "number" ? j.credits_consumed : matches.filter(Boolean).length;
  return { matches, credits, insufficient: false, error: null };
}

// deno-lint-ignore no-explicit-any
export function supabaseEnrichDeps(supabase: any, fetchFn: typeof fetch = fetch): EnrichDeps {
  return {
    async freeLookups(targets): Promise<FreeLookups> {
      const emails = [...new Set(targets.map((t) => (t.email ?? "").trim().toLowerCase()).filter(Boolean))];
      const domains = [...new Set(targets.map((t) => lookupDomain(t)).filter((d): d is string => !!d))];
      const { data, error } = await supabase.rpc("signals_hi_free_lookups", {
        p_emails: emails, p_domains: domains, p_signal_ids: targets.map((t) => t.signal_id),
      });
      if (error) throw new Error(`signals_hi_free_lookups: ${error.message}`);
      const byEmail = new Map<string, FieldValues>();
      for (const r of data?.by_email ?? []) byEmail.set(String(r.email).toLowerCase(), r);
      const byDomain = new Map<string, FieldValues & { keywords?: string | null }>();
      for (const r of data?.by_domain ?? []) byDomain.set(String(r.domain).toLowerCase(), r);
      const inference = new Map<string, FieldValues & { keywords?: string[] | null }>();
      for (const r of data?.inference ?? []) {
        inference.set(String(r.signal_id), { ...r, keywords: r.keywords ? [String(r.keywords)] : null });
      }
      return { byEmail, byDomain, inference };
    },

    async teamApollo(teamIds) {
      const { data, error } = await supabase.rpc("signals_hi_team_apollo", { p_team_ids: teamIds });
      if (error) throw new Error(`signals_hi_team_apollo: ${error.message}`);
      return new Map<string, TeamApollo>((data ?? []).map((r: { team_id: string } & TeamApollo) => [r.team_id, r]));
    },

    async apolloBudget(userId, agentConfigId) {
      const b = await readApolloBudget(supabase, userId, agentConfigId);
      return b ? { key: b.key, keySource: b.keySource, remaining: b.remaining } : null;
    },

    apolloMatch: (key, details) => apolloBulkMatch(fetchFn, key, details),

    async recordSpend(row) {
      const { error } = await supabase.from("signal_enrichment_spend").insert(row);
      if (error) throw new Error(error.message);
    },
  };
}
