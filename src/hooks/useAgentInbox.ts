import { useState, useEffect, useCallback } from 'react';
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

export interface AgentCounts {
  total: number;
  by_stage: Record<string, number>;
  needs_attention: number;
  auto_handled: number;
  by_intent: Record<string, number>;
}

interface AgentInboxResponse {
  leads: AgentLead[];
  counts: AgentCounts;
}

async function fetchAgentInbox(view: 'inbox' | 'pipeline'): Promise<AgentInboxResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-agent-inbox?view=${view}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch agent inbox: ${response.status}`);
  }

  return response.json();
}

export function useAgentInbox(view: 'inbox' | 'pipeline' = 'inbox') {
  return useQuery<AgentInboxResponse>({
    queryKey: ['agent-inbox', view],
    queryFn: () => fetchAgentInbox(view),
    refetchInterval: 30000, // Poll every 30 seconds
  });
}

// Convenience accessors
export function useAgentInboxData(view: 'inbox' | 'pipeline' = 'inbox') {
  const query = useAgentInbox(view);
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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const params = new URLSearchParams({ view: 'activity' });
  if (filters.type) params.set('type', filters.type);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', filters.limit.toString());

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-agent-inbox?${params}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch agent activity: ${response.status}`);
  }

  return response.json();
}

export function useAgentActivity(filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: ['agent-activity', filters],
    queryFn: () => fetchAgentActivity(filters),
    refetchInterval: 30000,
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
