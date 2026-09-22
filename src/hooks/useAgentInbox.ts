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
  // Source platform — positive identifier set at every agent_leads
  // creation site (heyreach-webhook / poll-heyreach-inbox → 'heyreach';
  // smartlead-webhook → 'smartlead'; reply-webhook / poll-reply-inbox /
  // sync-reply-contacts → 'reply_io'). Backfilled on pre-existing rows
  // by the 20260620120000 migration. Optional in the type because the
  // backfill+forward-write deploy is two steps; any row that escapes
  // both is exposed as undefined to the UI (LeadDetailPanel's
  // discriminators all evaluate false in that case → safe fallthrough
  // to "no send handler", never a wrong-channel send).
  source?: 'heyreach' | 'smartlead' | 'reply_io' | string | null;
  pipeline_stage: string;
  // Operator's disposition tag (display label + opted_out flag). pipeline_stage
  // holds the CHECK-valid mapped value; this holds the raw tag. Null → fall back
  // to pipeline_stage (identical for the six original tags).
  disposition_tag?: string | null;
  inbox_status: string;
  intent: string;
  intent_confidence: number;
  prospect_read?: {
    seniority?: string;
    buying_role?: string;
    matched_persona?: string | null;
    suggested_angle?: string;
  } | null;
  draft_response: string;
  draft_approved: boolean;
  last_reply_at: string;
  // Newest message in EITHER direction — MAX over reply_thread[] (excluding
  // role:'system'), floored by last_reply_at/created_at, maintained DB-side by
  // the zz_agent_leads_set_last_message_at trigger. Drives Total Inbox ordering
  // and the row timestamp. Optional in the type because the migration and this
  // deploy are two steps; a row that escapes the backfill falls back to
  // last_reply_at, which is the pre-existing behaviour.
  last_message_at?: string | null;
  last_reply_text: string;
  reply_thread: Array<{
    role: string;
    content: string;
    timestamp: string;
    channel: string;
    fromName?: string | null;
  }>;
  auto_handled: boolean;
  notes: string;
  last_campaign_name?: string | null;
  // Campaign IDs the lead was captured from. Populated at ingest even where
  // last_campaign_name is not (smartlead-webhook only copies a name when the
  // vendor payload carries one; the HeyReach paths never write one), so the
  // inbox resolves these to a name via useCampaignNames when the stored name is
  // missing. Both are TEXT and both match synced_campaigns.external_campaign_id.
  // get-agent-inbox already select('*')s them — this only declares them to TS.
  smartlead_campaign_id?: string | null;
  campaign_external_id?: string | null;
  // HeyReach LinkedIn sender account that owns this conversation. Written by
  // poll-heyreach-inbox; null for every other source. get-agent-inbox already
  // select('*')s it — this only declares it to TS. Resolved to a display name
  // via useHeyReachAccountNames, because HeyReach's ingest writes no
  // reply_thread fromName for the inbox's usual sender derivation to read.
  heyreach_account_id?: number | null;
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
  by_pipeline_category?: {
    replied: number;
    in_progress: number;
    sent_proposal: number;
    call_scheduled: number;
    no_show: number;
    closed_won: number;
    closed_lost: number;
  };
}

interface AgentInboxResponse {
  leads: AgentLead[];
  counts: AgentCounts;
  // Present on the 'inbox' view only: whether the group holds more rows than
  // this page returned, and the group's full size. Reported independently of
  // the server's page ceiling, so a caller at the cap can still tell there is
  // more behind it rather than silently believing it has everything.
  hasMore?: boolean;
  total?: number;
}

// Page size for the inbox list. The caller grows `limit` rather than walking
// offsets: the list refetches every 30s, and under a live-updating result set
// an accumulating offset walk duplicates or skips rows as new leads land at the
// top. Refetching a growing window is idempotent and always self-consistent.
export const INBOX_PAGE_SIZE = 50;

async function fetchAgentInbox(
  view: 'inbox' | 'pipeline',
  statusGroup?: InboxStatusGroup,
  limit?: number,
): Promise<AgentInboxResponse> {
  const { data, error } = await supabase.functions.invoke('get-agent-inbox', {
    body: { view, ...(statusGroup && { statusGroup }), ...(limit && { limit }) },
  });

  if (error) throw new Error(`Failed to fetch agent inbox: ${error.message}`);
  return data;
}

export function useAgentInbox(
  view: 'inbox' | 'pipeline' = 'inbox',
  statusGroup?: InboxStatusGroup,
  limit: number = INBOX_PAGE_SIZE,
) {
  return useQuery<AgentInboxResponse>({
    queryKey: ['agent-inbox', view, statusGroup ?? 'pending_approval', limit],
    queryFn: () => fetchAgentInbox(view, statusGroup, limit),
    refetchInterval: 30000, // Poll every 30 seconds
    staleTime: 0,
    refetchOnWindowFocus: true,
    // Growing `limit` changes the queryKey, which would otherwise drop the
    // cached page and flash the whole list back to its loading spinner on every
    // "Load more". Keep showing the current rows while the larger page loads.
    placeholderData: (previous) => previous,
  });
}

// Convenience accessors
export function useAgentInboxData(
  view: 'inbox' | 'pipeline' = 'inbox',
  statusGroup?: InboxStatusGroup,
  limit: number = INBOX_PAGE_SIZE,
) {
  const query = useAgentInbox(view, statusGroup, limit);
  return {
    leads: query.data?.leads ?? [],
    counts: query.data?.counts ?? {
      total: 0,
      by_stage: {},
      needs_attention: 0,
      auto_handled: 0,
      by_intent: {},
    },
    hasMore: query.data?.hasMore ?? false,
    total: query.data?.total ?? 0,
    // isFetching (not isLoading) stays true across a placeholder-backed refetch,
    // which is what the "Load more" button needs to show its pending state.
    isFetching: query.isFetching,
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
        sender_linkedin: string | null;
        sender_bio: string | null;
        company_name: string;
        company_url: string | null;
        communication_style: string | null;
        avoid_phrases: string[] | null;
        sample_message: string | null;
        calendar_link: string | null;
        pricing_summary: string | null;
        case_studies: string | null;
        disqualification_criteria: string | null;
        objection_handling_notes: string | null;
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
            sender_linkedin: agentConfig.sender_linkedin || '',
            sender_bio: agentConfig.sender_bio,
            company_name: agentConfig.company_name,
            company_url: agentConfig.company_url,
            communication_style: agentConfig.communication_style,
            avoid_phrases: agentConfig.avoid_phrases || [],
            sample_message: agentConfig.sample_message || '',
            calendar_link: agentConfig.calendar_link || '',
            pricing_summary: agentConfig.pricing_summary || '',
            case_studies: agentConfig.case_studies || '',
            disqualification_criteria: agentConfig.disqualification_criteria || '',
            objection_handling_notes: agentConfig.objection_handling_notes || '',
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
