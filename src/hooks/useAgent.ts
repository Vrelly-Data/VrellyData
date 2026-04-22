import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRequireSubscription } from './useSubscription';

// Cast to any until types are regenerated after migration is applied
const db = supabase as any;

export interface AgentConfig {
  id: string;
  user_id: string;
  company_name: string;
  company_url: string | null;
  sender_name: string;
  sender_title: string | null;
  sender_linkedin: string | null;
  sender_bio: string | null;
  offer_description: string;
  target_icp: string | null;
  outcome_delivered: string | null;
  desired_action: string | null;
  saved_audience_id: string | null;
  communication_style: string | null;
  avoid_phrases: string[] | null;
  sample_message: string | null;
  reply_api_key: string | null;
  managed_campaigns: string[] | null;
  mode: string | null;
  is_active: boolean | null;
  onboarding_complete: boolean | null;
  onboarding_step: number | null;
  created_at: string;
  updated_at: string;
}

export function useAgentConfig() {
  return useQuery<AgentConfig | null>({
    queryKey: ['agent-config'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await db
        .from('agent_configs')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return data as AgentConfig | null;
    },
  });
}

export function useAgentAccess() {
  const { plan, isLoading } = useRequireSubscription();

  return {
    hasAccess: plan === 'agent',
    isLoading,
  };
}

export interface AgentConfigInput {
  company_name: string;
  company_url?: string;
  sender_name: string;
  sender_title?: string;
  sender_linkedin?: string;
  sender_bio?: string;
  offer_description: string;
  target_icp?: string;
  outcome_delivered?: string;
  desired_action?: string;
  communication_style?: string;
  avoid_phrases?: string[];
  sample_message?: string;
  reply_api_key?: string;
  mode?: string;
  is_active?: boolean;
  onboarding_complete?: boolean;
  onboarding_step?: number;
}

export interface ReplyIntegration {
  id: string;
  platform: string;
  name: string;
  sync_status: string | null;
  reply_team_id: string | null;
  last_synced_at: string | null;
}

export function useReplyIntegration() {
  return useQuery<{ integration: ReplyIntegration | null; hasIntegration: boolean }>({
    queryKey: ['reply-integration'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return { integration: null, hasIntegration: false };

      const { data, error } = await db
        .from('outbound_integrations')
        .select('id, platform, name, sync_status, reply_team_id, last_synced_at')
        .eq('created_by', session.user.id)
        .eq('platform', 'reply.io')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const integration = data as ReplyIntegration | null;
      return { integration, hasIntegration: !!integration };
    },
  });
}

export interface HeyReachIntegration {
  id: string;
  platform: string;
  name: string;
  sync_status: string | null;
  last_synced_at: string | null;
}

export function useHeyReachIntegration() {
  return useQuery<{ integration: HeyReachIntegration | null; hasIntegration: boolean }>({
    queryKey: ['heyreach-integration'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return { integration: null, hasIntegration: false };

      const { data, error } = await db
        .from('outbound_integrations')
        .select('id, platform, name, sync_status, last_synced_at')
        .eq('created_by', session.user.id)
        .eq('platform', 'heyreach')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const integration = data as HeyReachIntegration | null;
      return { integration, hasIntegration: !!integration };
    },
  });
}

// Platform-agnostic: every active outbound_integrations row for the user,
// regardless of platform. Consumers display a list (connection badges,
// campaign source tags, etc).
export interface ConnectedIntegration {
  id: string;
  platform: string;
  name: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
}

export function useConnectedIntegrations() {
  return useQuery<ConnectedIntegration[]>({
    queryKey: ['connected-integrations'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const { data, error } = await db
        .from('outbound_integrations')
        .select('id, platform, name, sync_status, last_synced_at')
        .eq('created_by', session.user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ConnectedIntegration[];
    },
  });
}

export function useUpsertAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AgentConfigInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await db
        .from('agent_configs')
        .upsert(
          { user_id: user.id, ...input },
          { onConflict: 'user_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config'] });
    },
  });
}
