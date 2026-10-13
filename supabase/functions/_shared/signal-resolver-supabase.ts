// Real I/O for _shared/signal-resolver.ts: the database through the service
// client, Apollo search directly (free), Apollo enrichment through the
// apollo-enrich function (paid — it owns the per-user enrichment cache and the
// 422 handling, so this path spends exactly the way an Apollo audience does).

import { APOLLO_BASE, apolloHeaders, buildSearchBody, mapSearchPerson, type ApolloSearchPerson } from "./apollo.ts";
import { getApolloKeyForUser, ApolloKeyMissingError, type ApolloKeySource } from "./apollo-key.ts";
import type { CompiledSignalAudience } from "./signal-audience.ts";
import { CACHE_TTL_DAYS, type CachedContact, type FreeResolution, type ResolverDeps } from "./signal-resolver.ts";

/** First instant of the current calendar month, UTC. */
export function monthStartUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Shared-key Apollo credits spent this month on High Intent enrichment
 * (signal_enrichment_spend). Counted against the same monthly cap as the
 * audiences, so the two paths together never exceed it. Throws on a read
 * error: an unknown spend is not permission to spend.
 */
export async function enrichmentCreditsThisMonth(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  since = monthStartUtc(),
): Promise<number> {
  const { data, error } = await supabase.from("signal_enrichment_spend")
    .select("credits").eq("user_id", userId).eq("key_source", "shared").gte("created_at", since);
  if (error) throw new Error(`Could not read the enrichment credit ledger: ${error.message}`);
  return (data ?? []).reduce((n: number, r: { credits: number }) => n + Number(r.credits ?? 0), 0);
}

export interface ApolloBudget {
  keySource: ApolloKeySource;
  key: string;
  /** Credits this client may still spend this month (Infinity on their own key). */
  remaining: number;
  cap: number | null;
  used: number;
}

/**
 * The monthly Apollo budget, by the same rule as the Apollo source in
 * run-agent-audience: on the SHARED key a client may spend at most
 * agent_configs.apollo_monthly_credit_cap per calendar month (UTC), counted
 * from agent_audience_runs plus High Intent enrichment (signal_enrichment_spend);
 * a client's own key is not ours to cap. Returns null
 * when Apollo is not configured. Throws when the budget cannot be read — an
 * unknown budget is not permission to spend.
 */
export async function readApolloBudget(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  agentConfigId: string,
): Promise<ApolloBudget | null> {
  let k;
  try {
    k = await getApolloKeyForUser(supabase, userId);
  } catch (e) {
    if (e instanceof ApolloKeyMissingError) return null;
    throw e;
  }
  if (k.source === "client") return { keySource: "client", key: k.key, remaining: Number.POSITIVE_INFINITY, cap: null, used: 0 };
  const { data: cfg, error: cfgErr } = await supabase
    .from("agent_configs").select("apollo_monthly_credit_cap").eq("id", agentConfigId).maybeSingle();
  const { data: rows, error: spentErr } = await supabase
    .from("agent_audience_runs").select("credits_spent")
    .eq("user_id", userId)
    .or("apollo_key_source.eq.shared,apollo_key_source.is.null")
    .gte("started_at", monthStartUtc());
  if (cfgErr || spentErr) throw new Error(`Could not read the Apollo credit budget: ${(cfgErr ?? spentErr).message}`);
  const cap = Number(cfg?.apollo_monthly_credit_cap ?? 200);
  const used = (rows ?? []).reduce((n: number, r: { credits_spent: number }) => n + Number(r.credits_spent ?? 0), 0) +
    await enrichmentCreditsThisMonth(supabase, userId);
  return { keySource: "shared", key: k.key, remaining: Math.max(0, cap - used), cap, used };
}

export function supabaseResolverDeps(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    userId: string;
    compiled: CompiledSignalAudience;
    apolloKey: string | null;
    supabaseUrl: string;
    agentApiKey: string;
    fetchFn?: typeof fetch;
  },
): ResolverDeps {
  const f = args.fetchFn ?? fetch;
  const { userId, compiled } = args;
  return {
    async resolveFree(ids) {
      const { data, error } = await supabase.rpc("signals_resolve_people", {
        p_user_id: userId, p_signal_ids: ids, p_persona: compiled.persona,
        p_per_company: compiled.perCompany, p_us_only: compiled.usOnly,
      });
      if (error) throw new Error(`signals_resolve_people failed: ${error.message}`);
      return { signals: (data?.signals ?? []) as FreeResolution[], refused: Number(data?.refused ?? 0) };
    },

    async readCache(keys) {
      const since = new Date(Date.now() - CACHE_TTL_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase.from("signal_contacts")
        .select("company_key, source, apollo_person_id, email, linkedin, first_name, last_name, title, company_name, company_domain, city, state, country, resolved_at")
        .eq("user_id", userId).eq("source", "apollo").in("company_key", keys).gte("resolved_at", since);
      if (error) throw new Error(`signal_contacts read failed: ${error.message}`);
      const m = new Map<string, CachedContact[]>();
      for (const r of data ?? []) {
        const list = m.get(r.company_key) ?? [];
        list.push({ ...r, linkedin_url: r.linkedin, source: "apollo" });
        m.set(r.company_key, list);
      }
      return m;
    },

    async readLookups(keys) {
      const { data, error } = await supabase.from("signal_company_lookups")
        .select("company_key, apollo_searched_at, apollo_candidates").eq("user_id", userId).in("company_key", keys);
      if (error) throw new Error(`signal_company_lookups read failed: ${error.message}`);
      return new Map((data ?? []).map((r: { company_key: string; apollo_searched_at: string | null; apollo_candidates: number }) => [r.company_key, r]));
    },

    async apolloSearch(domain, persona, perPage): Promise<ApolloSearchPerson[]> {
      if (!args.apolloKey) throw new Error("Apollo is not configured for this account");
      const res = await f(`${APOLLO_BASE}/mixed_people/api_search`, {
        method: "POST",
        headers: apolloHeaders(args.apolloKey),
        body: JSON.stringify(buildSearchBody({
          q_organization_domains_list: [domain],
          person_titles: persona.person_titles,
          person_seniorities: persona.person_seniorities,
        }, 1, perPage)),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Apollo search HTTP ${res.status}`);
      const j = await res.json();
      return (j?.people ?? []).map(mapSearchPerson).filter((p: ApolloSearchPerson | null): p is ApolloSearchPerson => p !== null);
    },

    async apolloEnrich(ids) {
      const res = await f(`${args.supabaseUrl}/functions/v1/apollo-enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": args.agentApiKey },
        body: JSON.stringify({ user_id: userId, person_ids: ids }),
      });
      if (!res.ok) throw new Error(`apollo-enrich HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const j = await res.json();
      return {
        people: j.people ?? [],
        credits_spent: Number(j.credits_spent ?? 0),
        insufficient_credits: j.insufficient_credits === true,
        failed: (j.failed_chunks ?? []).reduce((n: number, c: { ids: string[] }) => n + c.ids.length, 0),
      };
    },

    async pushedApolloIds(ids) {
      if (!ids.length) return new Set();
      const { data, error } = await supabase.from("agent_audience_pushes")
        .select("apollo_person_id").eq("user_id", userId).in("apollo_person_id", ids);
      // Fail closed: an unanswerable check must not lead to paying for a duplicate.
      if (error) throw new Error(`push ledger read failed: ${error.message}`);
      return new Set((data ?? []).map((r: { apollo_person_id: string }) => r.apollo_person_id));
    },

    async knownContacts(emails, linkedinKeys) {
      const { data, error } = await supabase.rpc("audience_known_contacts", {
        p_user_id: userId, p_emails: emails, p_linkedin_keys: linkedinKeys,
      });
      if (error) throw new Error(`audience_known_contacts failed: ${error.message}`);
      return { emails: new Set<string>(data?.emails ?? []), linkedins: new Set<string>(data?.linkedin_keys ?? []) };
    },

    async writeCache(rows) {
      const { error } = await supabase.from("signal_contacts").upsert(rows.map((p) => ({
        user_id: userId, company_key: p.company_key, signal_id: p.signal_id, source: p.source,
        prospect_id: p.prospect_id ?? null, apollo_person_id: p.apollo_person_id ?? null,
        email: p.email, linkedin: p.linkedin_url, first_name: p.first_name, last_name: p.last_name,
        title: p.title, company_name: p.company_name, company_domain: p.company_domain,
        city: p.city, state: p.state, country: p.country, resolved_at: new Date().toISOString(),
      })), { onConflict: "user_id,company_key,person_key" });
      // Never fatal: the credits are spent either way; a lost cache row only
      // means a later run may pay apollo-enrich's own cache instead.
      if (error) console.error(`[signal-resolver] signal_contacts write failed: ${error.message}`);
    },

    async writeLookup(row) {
      const { error } = await supabase.from("signal_company_lookups").upsert({
        user_id: userId, company_key: row.company_key, domain: row.domain,
        apollo_searched_at: new Date().toISOString(), apollo_candidates: row.apollo_candidates,
        apollo_enriched: row.apollo_enriched, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_key" });
      if (error) console.error(`[signal-resolver] signal_company_lookups write failed: ${error.message}`);
    },
  };
}
