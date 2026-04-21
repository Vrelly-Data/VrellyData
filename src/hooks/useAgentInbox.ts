import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface AgentLead {
  id: string;
  full_name: string;
  company: string;
  job_title: string;
  email: string;
  linkedin_url: string;
  channel: 'email' | 'linkedin';
  pipeline_stage: string;
  inbox_status: string;
  intent: string;
  intent_confidence: number;
  draft_response: string;
  draft_approved: boolean;
  last_reply_at: string;
  last_reply_text: string;
  reply_thread: Array<{
    role: string;
    content: string;
    timestamp: string;
    channel: string;
  }>;
  auto_handled: boolean;
  notes: string;
}

export type InboxStatusGroup = 'pending_approval' | 'total_inbox';

export interface AgentCounts {
  total: number;
  by_stage: Record<string, number>;
  needs_attention: number;
  auto_handled: number;
  by_intent: Record<string, number>;
  by_status_group?: {
    pending_approval: number;
    total_inbox: number;
  };
}

interface AgentInboxResponse {
  leads: AgentLead[];
  counts: AgentCounts;
}

async function fetchAgentInbox(
  view: 'inbox' | 'pipeline',
  statusGroup?: InboxStatusGroup,
): Promise<AgentInboxResponse> {
  const { data, error } = await supabase.functions.invoke('get-agent-inbox', {
    body: { view, ...(statusGroup && { statusGroup }) },
  });

  if (error) throw new Error(`Failed to fetch agent inbox: ${error.message}`);
  return data;
}

export function useAgentInbox(
  view: 'inbox' | 'pipeline' = 'inbox',
  statusGroup?: InboxStatusGroup,
) {
  return useQuery<AgentInboxResponse>({
    queryKey: ['agent-inbox', view, statusGroup ?? 'pending_approval'],
    queryFn: () => fetchAgentInbox(view, statusGroup),
    refetchInterval: 30000, // Poll every 30 seconds
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

// Convenience accessors
export function useAgentInboxData(
  view: 'inbox' | 'pipeline' = 'inbox',
  statusGroup?: InboxStatusGroup,
) {
  const query = useAgentInbox(view, statusGroup);
  return {
    leads: query.data?.leads ?? [],
    counts: query.data?.counts ?? {
      total: 0,
      by_stage: {},
      needs_attention: 0,
      auto_handled: 0,
      by_intent: {},
    },
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

// Activity hook
export interface AgentActivityItem {
  id: string;
  activity_type: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_company: string | null;
  description: string;
  metadata: Record<string, any>;
  created_at: string;
}

interface ActivityFilters {
  type?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
}

async function fetchAgentActivity(filters: ActivityFilters): Promise<{
  leads: AgentActivityItem[];
  counts: AgentCounts;
}> {
  const { data, error } = await supabase.functions.invoke('get-agent-inbox', {
    body: {
      view: 'activity',
      ...(filters.type && { type: filters.type }),
      ...(filters.from && { from: filters.from }),
      ...(filters.to && { to: filters.to }),
      ...(filters.search && { search: filters.search }),
      ...(filters.limit && { limit: filters.limit }),
    },
  });

  if (error) throw new Error(`Failed to fetch agent activity: ${error.message}`);
  return data;
}

export function useAgentActivity(filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: ['agent-activity', filters],
    queryFn: () => fetchAgentActivity(filters),
    refetchInterval: 30000,
  });
}

// Live single-lead query (polls every 5s while leadId is set)
export function useLiveLead(leadId: string | null) {
  return useQuery<AgentLead | null>({
    queryKey: ['agent-lead', leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data, error } = await db
        .from('agent_leads')
        .select('*')
        .eq('id', leadId)
        .single();
      if (error) throw error;
      return data as AgentLead;
    },
    enabled: !!leadId,
    refetchInterval: 5000,
    staleTime: 0,
  });
}

// Classify a lead via the classify-reply edge function (JWT auth)
export function useClassifyLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lead,
      agentConfig,
    }: {
      lead: AgentLead;
      agentConfig: {
        offer_description: string;
        desired_action: string | null;
        outcome_delivered: string | null;
        target_icp: string | null;
        sender_name: string;
        sender_title: string | null;
        sender_bio: string | null;
        company_name: string;
        company_url: string | null;
        communication_style: string | null;
        avoid_phrases: string[] | null;
        sample_message: string | null;
      };
    }) => {
      const replyText = lead.last_reply_text
        || lead.reply_thread?.find((m) => m.role === 'prospect')?.content
        || '';
      const { data, error } = await supabase.functions.invoke('classify-reply', {
        body: {
          reply_text: replyText || 'No reply text available',
          thread_history: lead.reply_thread || [],
          lead_id: lead.id,
          agent_context: {
            offer_description: agentConfig.offer_description,
            desired_action: agentConfig.desired_action,
            outcome_delivered: agentConfig.outcome_delivered,
            target_icp: agentConfig.target_icp,
            sender_name: agentConfig.sender_name,
            sender_title: agentConfig.sender_title,
            sender_bio: agentConfig.sender_bio,
            company_name: agentConfig.company_name,
            company_url: agentConfig.company_url,
            communication_style: agentConfig.communication_style,
            avoid_phrases: agentConfig.avoid_phrases || [],
            sample_message: agentConfig.sample_message || '',
          },
          channel: lead.channel,
        },
      });
      if (error) throw new Error(error.message || 'Classification failed');
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-lead', variables.lead.id] });
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['agent-activity'] });
    },
  });
}

// Update lead mutation
export function useUpdateAgentLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leadId,
      updates,
      logStageChange,
    }: {
      leadId: string;
      updates: Record<string, any>;
      logStageChange?: { oldStage: string; newStage: string; leadName: string; leadCompany: string };
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await db
        .from('agent_leads')
        .update(updates)
        .eq('id', leadId);

      if (error) throw error;

      // Log stage change to agent_activity
      if (logStageChange) {
        const { data: lead } = await db
          .from('agent_leads')
          .select('agent_config_id')
          .eq('id', leadId)
          .single();

        await db.from('agent_activity').insert({
          user_id: user.id,
          agent_config_id: lead?.agent_config_id,
          lead_id: leadId,
          lead_name: logStageChange.leadName,
          lead_company: logStageChange.leadCompany,
          activity_type: 'lead_stage_changed',
          description: `${logStageChange.leadName} moved from ${logStageChange.oldStage} to ${logStageChange.newStage}`,
          metadata: {
            old_stage: logStageChange.oldStage,
            new_stage: logStageChange.newStage,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['agent-activity'] });
    },
  });
}

// Approve draft mutation
export function useApproveDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leadId,
      editedDraft,
    }: {
      leadId: string;
      editedDraft?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const updates: Record<string, any> = {
        inbox_status: 'approved',
        draft_approved: true,
      };
      if (editedDraft !== undefined) {
        updates.draft_response = editedDraft;
      }

      const { error } = await db
        .from('agent_leads')
        .update(updates)
        .eq('id', leadId);

      if (error) throw error;

      // Get lead info for activity log
      const { data: lead } = await db
        .from('agent_leads')
        .select('agent_config_id, full_name, company')
        .eq('id', leadId)
        .single();

      await db.from('agent_activity').insert({
        user_id: user.id,
        agent_config_id: lead?.agent_config_id,
        lead_id: leadId,
        lead_name: lead?.full_name,
        lead_company: lead?.company,
        activity_type: 'message_approved',
        description: `Response approved for ${lead?.full_name || 'Unknown'}${lead?.company ? ' at ' + lead.company : ''}`,
        metadata: { edited: editedDraft !== undefined },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['agent-activity'] });
    },
  });
}
