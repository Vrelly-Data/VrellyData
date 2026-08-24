import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
      { filters, page = 1, per_page = 25 }:
      { filters: ApolloAudienceFilters; page?: number; per_page?: number },
    ): Promise<AudiencePreview> =>
      invokeFn<AudiencePreview>('apollo-search', { filters, page, per_page }),
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
