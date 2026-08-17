import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Cast until Supabase types are regenerated for the agent_audience_* tables.
// Same pattern as useAgent.ts.
const db = supabase as any;

/** Apollo request parameters, stored verbatim in agent_audiences.filters. */
export interface ApolloAudienceFilters {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[];
  q_keywords?: string;
}

export interface AgentAudience {
  id: string;
  user_id: string;
  agent_config_id: string;
  name: string;
  filters: ApolloAudienceFilters;
  filters_version: number;
  platform: 'smartlead' | 'reply.io';
  synced_campaign_id: string | null;
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
  platform: 'smartlead' | 'reply.io';
  synced_campaign_id: string | null;
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
 * and unless a campaign is linked. The client does NOT pre-check that — a
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
