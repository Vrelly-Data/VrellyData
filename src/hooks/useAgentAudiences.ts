import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  getAudienceSource, resolveEdgeFunctions, DEFAULT_SOURCE,
  type AudienceSourceId,
} from '@/lib/audienceSources';

// Cast until Supabase types are regenerated for the agent_audience_* tables.
// Same pattern as useAgent.ts.
const db = supabase as any;

/**
 * Apollo request parameters, stored verbatim in agent_audiences.filters.
 * Mirrors ApolloSearchFilters in supabase/functions/_shared/apollo.ts — every
 * one verified live against api_search, which silently ignores unknown keys.
 */
export interface ApolloAudienceFilters {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[];
  q_organization_domains_list?: string[];
  contact_email_status?: string[];
  q_organization_keyword_tags?: string[];
  person_department_or_subdepartments?: string[];
  revenue_range?: { min?: number; max?: number };
  q_keywords?: string;
}

export interface AgentAudience {
  id: string;
  user_id: string;
  agent_config_id: string;
  name: string;
  filters: ApolloAudienceFilters;
  filters_version: number;
  /**
   * Which data source this audience searches. Rows created before the source
   * column existed read as 'apollo', which is what they are.
   * See src/lib/audienceSources.ts.
   */
  source: AudienceSourceId;
  // DEFAULT destination, used only by scheduled runs. Manual pushes choose a
  // destination per push, so both may be null on a perfectly valid audience —
  // it simply cannot be armed until they are set.
  default_platform: 'smartlead' | 'reply.io' | null;
  default_synced_campaign_id: string | null;
  is_active: boolean;
  cadence: 'manual' | 'daily' | 'weekly';
  max_per_run: number;
  max_total: number | null;
  total_pushed: number;
  last_run_at: string | null;
  last_run_status: 'running' | 'success' | 'partial' | 'failed' | null;
  last_run_error: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

/** Joined for display — the campaign the audience pushes into. */
export interface AudienceCampaign {
  id: string;
  name: string;
  external_campaign_id: string;
  source: string;
  status: string | null;
}

// agent_audiences.platform and synced_campaigns.source spell the same thing
// differently. This is the ONLY place the mapping lives on the client; the
// server enforces it independently in add-contacts-to-sequence.
export const PLATFORM_TO_SOURCE: Record<string, string> = {
  smartlead: 'smartlead',
  'reply.io': 'reply_io',
};

export function useAgentAudiences() {
  return useQuery({
    queryKey: ['agent-audiences'],
    queryFn: async (): Promise<AgentAudience[]> => {
      const { data, error } = await db
        .from('agent_audiences')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentAudience[];
    },
  });
}

/** Campaigns available to link, for one platform. */
export function useAudienceCampaigns(platform: string | undefined) {
  return useQuery({
    queryKey: ['audience-campaigns', platform],
    enabled: !!platform,
    queryFn: async (): Promise<AudienceCampaign[]> => {
      const source = PLATFORM_TO_SOURCE[platform as string];
      if (!source) return [];
      const { data, error } = await db
        .from('synced_campaigns')
        .select('id, name, external_campaign_id, source, status')
        .eq('source', source)
        .order('name');
      if (error) throw error;
      return (data ?? []) as AudienceCampaign[];
    },
  });
}

export interface AudienceInput {
  name: string;
  // DEFAULT destination, used only by scheduled runs. Manual pushes choose a
  // destination per push, so both may be null on a perfectly valid audience —
  // it simply cannot be armed until they are set.
  default_platform: 'smartlead' | 'reply.io' | null;
  default_synced_campaign_id: string | null;
  cadence: 'manual' | 'daily' | 'weekly';
  max_per_run: number;
  max_total: number | null;
  filters: ApolloAudienceFilters;
  /** Omit to create an Apollo audience — the only source wired up today. */
  source?: AudienceSourceId;
}

export function useCreateAudience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AudienceInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // agent_config_id is NOT NULL. An audience belongs to the client's agent,
      // so it is derived rather than chosen.
      const { data: cfg } = await db
        .from('agent_configs')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (!cfg) throw new Error('No active agent config — set up the Agent first.');

      const { data, error } = await db
        .from('agent_audiences')
        .insert({ ...input, user_id: user.id, agent_config_id: cfg.id })
        .select()
        .single();
      if (error) throw error;
      return data as AgentAudience;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-audiences'] }),
  });
}

export function useUpdateAudience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AudienceInput> }) => {
      const { data, error } = await db
        .from('agent_audiences').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data as AgentAudience;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-audiences'] }),
  });
}

/**
 * Arm or disarm an audience.
 *
 * Activation is guarded IN THE DATABASE: agent_audiences_guard_activation
 * rejects false->true unless a run has already completed with status='success',
 * and unless a DEFAULT destination is set — a scheduled run has nobody to ask
 * which campaign to use. The client does NOT pre-check that — a
 * duplicated rule drifts. It surfaces the database's own message instead, which
 * names the reason.
 */
export function useToggleAudienceActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await db
        .from('agent_audiences').update({ is_active }).eq('id', id).select().single();
      if (error) throw error;
      return data as AgentAudience;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-audiences'] }),
  });
}

export function useDeleteAudience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('agent_audiences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-audiences'] }),
  });
}

/**
 * Invoke an edge function and surface the REAL failure message.
 *
 * functions.invoke() reports every non-2xx as the same opaque string ("Edge
 * Function returned a non-2xx status code") and puts the actual body on
 * error.context. That default is unusable here: run-agent-audience answers a
 * dead campaign with 409 + {error, detail}, where the detail is the only thing
 * that tells the operator WHY nothing was pushed ("no email accounts attached",
 * "0 steps"). Losing it would leave the run looking inexplicably broken.
 */
async function invokeFn<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let detail: string | null = null;
    const ctx = (error as unknown as { context?: Response })?.context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        detail = [j?.error, j?.detail].filter(Boolean).join(' — ') || null;
      } catch {
        // Body was not JSON; fall back to the generic message below.
      }
    }
    throw new Error(detail || error.message || `${name} failed`);
  }
  // Some functions answer 200 with an error payload.
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

/** One row of the preview table. Mirrors mapSearchPerson in _shared/apollo.ts. */
export interface ApolloPreviewPerson {
  apollo_person_id: string;
  first_name: string | null;
  last_name_obfuscated: string | null;
  title: string | null;
  organization_name: string | null;
  has_email: boolean;
  has_direct_phone: boolean;
  has_city: boolean;
  has_state: boolean;
  has_country: boolean;
  // Organisation availability flags + record freshness. api_search returns NO
  // organisation values beyond `name` (verified live 2026-08-30 across three
  // filter shapes), so these say what enrichment WILL yield rather than what it
  // already has. Optional because the mapper change and this deploy are two
  // steps: a response from the older apollo-search omits them, and every
  // consumer below treats undefined as "unknown" and simply renders nothing.
  org_has_industry?: boolean;
  org_has_employee_count?: boolean;
  org_has_revenue?: boolean;
  org_has_phone?: boolean;
  last_refreshed_at?: string | null;
}

export interface AudiencePreview {
  people: ApolloPreviewPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number | null;
    total_pages: number | null;
  };
  notice: string;
  credits_consumed: number;
  key_source: 'client' | 'shared';
}

/**
 * Preview an audience's filters against Apollo. FREE — api_search costs no
 * credits and returns no email or phone, with surnames masked. Enrichment is
 * the paid step, and it happens inside run-agent-audience at push time.
 */
export function usePreviewAudience() {
  return useMutation({
    mutationFn: async (
      { filters, page = 1, per_page = 25, source = DEFAULT_SOURCE }:
      {
        filters: ApolloAudienceFilters; page?: number; per_page?: number;
        source?: AudienceSourceId;
      },
    ): Promise<AudiencePreview> => {
      // Resolved through the registry rather than hardcoded, but Apollo still
      // resolves to 'apollo-search' with an identical body — this is a rename
      // of where the string lives, not a change to the request.
      const { search } = resolveEdgeFunctions(getAudienceSource(source));
      return invokeFn<AudiencePreview>(search, { filters, page, per_page });
    },
  });
}

/**
 * Which of these Apollo people has this client already pushed?
 *
 * run-agent-audience drops already-pushed ids BEFORE paying to enrich (its step
 * 5). Mirroring that here means the operator never spends a selection slot on
 * someone the server would silently skip. Dedup is client-wide by design, so
 * this is scoped by user and not by audience.
 */
export function useAlreadyPushed(apolloPersonIds: string[]) {
  const key = [...apolloPersonIds].sort().join(',');
  return useQuery({
    queryKey: ['audience-already-pushed', key],
    enabled: apolloPersonIds.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await db
        .from('agent_audience_pushes')
        .select('apollo_person_id')
        .eq('user_id', user.id)
        .in('apollo_person_id', apolloPersonIds);
      if (error) throw error;
      return new Set((data ?? []).map((r: { apollo_person_id: string }) => r.apollo_person_id));
    },
  });
}

/**
 * One person as Apollo returns them from ENRICHMENT — real surname, real email,
 * real location. Mirrors ApolloEnrichedPerson in _shared/apollo.ts.
 *
 * Everything here is paid-for data. The preview type above (ApolloPreviewPerson)
 * is its free counterpart and deliberately shares no fields beyond the id: the
 * two must never be confused at a call site, because one is safe to show for
 * free and the other cost money to obtain.
 */
export interface RevealedPerson {
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
  organization_industry: string | null;
  organization_employee_count: number | null;
  organization_revenue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  revealed_for_current_team: boolean | null;
  contact_id: string | null;
}

export interface RevealResult {
  people: RevealedPerson[];
  requested: number;
  /** How many came from apollo_enrichment_cache and therefore cost nothing. */
  served_from_cache: number;
  cache_ttl_days: number;
  /**
   * Ids Apollo has NO RECORD FOR — a permanent fact, free to learn, and safe to
   * act on by greying the row out for good. Chunks that failed at the HTTP
   * level are NOT in here (see apollo-enrich); they are in failed_chunks, where
   * the right response is to try again rather than to write the person off.
   */
  unmatched: string[];
  /** Transient failures. Retryable — these people may be perfectly reachable. */
  failed_chunks: Array<{ ids: string[]; status: number }>;
  credits_spent: number;
  already_revealed_for_team: number;
  key_source: 'client' | 'shared';
}

/**
 * Mirrors ENRICH_MAX_PER_CALL in _shared/apollo.ts.
 *
 * The server REFUSES a larger batch rather than truncating it, so this is not a
 * nicety — a bulk reveal of 25 selected people sent as one call would 400 and
 * reveal nobody. Chunking happens below.
 */
export const REVEAL_MAX_PER_CALL = 10;

/**
 * Reveal people — the paid step, made explicit.
 *
 * WHY THIS IS SAFE TO OFFER AS A BUTTON. apollo-enrich is a read-through cache
 * over apollo_enrichment_cache: a person revealed here is stored, and the push
 * that follows is served from that store rather than bought a second time. So
 * Reveal costs at most what the push would have cost anyway, and pressing it
 * twice costs nothing the second time. Without that cache this hook would
 * double the price of every push it preceded.
 *
 * Chunks are sent SEQUENTIALLY, not in parallel. Apollo rate-limits per account
 * and a 429 mid-reveal would leave the operator with a partial result they had
 * still been charged for.
 */
export function useRevealPeople() {
  return useMutation({
    mutationFn: async (
      { person_ids, refresh = false, source = DEFAULT_SOURCE }:
      { person_ids: string[]; refresh?: boolean; source?: AudienceSourceId },
    ): Promise<RevealResult> => {
      const src = getAudienceSource(source);
      // A source with nothing withheld has nothing to reveal. Refusing here
      // means a future caller cannot quietly bill an Apollo reveal against a
      // free source by passing the wrong id.
      if (!src.requiresReveal) {
        throw new Error(`${src.label} records are already complete — there is nothing to reveal.`);
      }
      const { reveal } = resolveEdgeFunctions(src);
      const ids = [...new Set(person_ids.filter(Boolean))];
      const merged: RevealResult = {
        people: [], requested: 0, served_from_cache: 0, cache_ttl_days: 0,
        unmatched: [], failed_chunks: [], credits_spent: 0,
        already_revealed_for_team: 0, key_source: 'shared',
      };

      for (let i = 0; i < ids.length; i += REVEAL_MAX_PER_CALL) {
        const chunk = ids.slice(i, i + REVEAL_MAX_PER_CALL);
        const r = await invokeFn<RevealResult>(reveal, {
          person_ids: chunk,
          ...(refresh ? { refresh: true } : {}),
        });
        merged.people.push(...(r.people ?? []));
        merged.requested += r.requested ?? chunk.length;
        merged.served_from_cache += r.served_from_cache ?? 0;
        merged.unmatched.push(...(r.unmatched ?? []));
        merged.failed_chunks.push(...(r.failed_chunks ?? []));
        merged.credits_spent += r.credits_spent ?? 0;
        merged.already_revealed_for_team += r.already_revealed_for_team ?? 0;
        merged.cache_ttl_days = r.cache_ttl_days ?? merged.cache_ttl_days;
        merged.key_source = r.key_source ?? merged.key_source;
      }
      return merged;
    },
  });
}

export interface AudienceRunResult {
  success?: boolean;
  run_id: string | null;
  status?: 'success' | 'partial' | 'failed';
  searched: number;
  enriched: number;
  credits_spent: number;
  pushed: number;
  skipped_duplicate: number;
  failed: number;
  note?: string;
}

/**
 * Run an audience against an explicit list of people.
 *
 * This is the MANUAL entry shape documented in run-agent-audience: passing
 * person_ids skips the search entirely and uses the ticked ids verbatim, so
 * what the operator saw in the preview is exactly what gets enriched and
 * pushed. Destination is per-run — passing it explicitly means a manual push
 * never depends on the audience having a default set.
 */
export function useRunAudience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      { audience_id, person_ids, platform, synced_campaign_id }: {
        audience_id: string;
        person_ids: string[];
        platform: string;
        synced_campaign_id: string;
      },
    ): Promise<AudienceRunResult> =>
      invokeFn<AudienceRunResult>('run-agent-audience', {
        audience_id, person_ids, platform, synced_campaign_id, trigger: 'manual',
      }),
    onSuccess: () => {
      // The run rewrites last_run_status/total_pushed, and a successful run is
      // what unlocks arming — so the list must refetch, not just the row.
      qc.invalidateQueries({ queryKey: ['agent-audiences'] });
      qc.invalidateQueries({ queryKey: ['audience-already-pushed'] });
    },
  });
}
