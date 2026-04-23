import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface HeyReachCampaign {
  id: string;
  name: string;
  status: string | null;
  external_campaign_id: string;
}

export function useHeyReachCampaigns() {
  return useQuery({
    queryKey: ['heyreach-campaigns'],
    queryFn: async (): Promise<HeyReachCampaign[]> => {
      // Get heyreach integration IDs first
      const { data: integrations, error: intError } = await supabase
        .from('outbound_integrations')
        .select('id')
        .eq('platform', 'heyreach');

      if (intError) throw intError;
      if (!integrations?.length) return [];

      const integrationIds = integrations.map(i => i.id);

      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, status, external_campaign_id')
        .in('integration_id', integrationIds)
        .order('name', { ascending: true });

      if (error) throw error;
      return (data || []) as HeyReachCampaign[];
    },
  });
}

type LeadCacheShape = { reply_thread?: unknown[] } & Record<string, unknown>;

/**
 * Full React Query optimistic update pattern. Prevents the race where the
 * 5s useLiveLead refetch fires mid-mutation and overwrites the optimistic
 * append with stale server data. onMutate cancels in-flight queries,
 * snapshots previous state for rollback, and applies the optimistic edit.
 * onSettled invalidates to pull fresh server truth (send-heyreach-message
 * writes to reply_thread server-side, so the refetch matches).
 */
export function useSendHeyReachMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lead_id, message }: { lead_id: string; message: string }) => {
      const { data, error } = await supabase.functions.invoke('send-heyreach-message', {
        body: { lead_id, message },
      });

      if (error) throw new Error(error.message || 'Failed to send message');
      if (!data?.success) throw new Error(data?.error || 'Failed to send message');
      return data;
    },
    onMutate: async (variables) => {
      // Cancel any in-flight refetch so it can't overwrite our optimistic append.
      await queryClient.cancelQueries({ queryKey: ['agent-lead', variables.lead_id] });

      const previous = queryClient.getQueryData<LeadCacheShape>([
        'agent-lead',
        variables.lead_id,
      ]);

      const newMessage = {
        role: 'sender',
        content: variables.message,
        timestamp: new Date().toISOString(),
        channel: 'linkedin',
      };

      queryClient.setQueryData(
        ['agent-lead', variables.lead_id],
        (old: LeadCacheShape | undefined) => ({
          ...(old ?? { id: variables.lead_id }),
          reply_thread: [...(old?.reply_thread ?? []), newMessage],
        }),
      );

      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['agent-lead', variables.lead_id], context.previous);
      }
      toast.error(`Failed to send message: ${error.message}`);
    },
    onSuccess: () => {
      toast.success('Message sent');
    },
    onSettled: (_data, _error, variables) => {
      // Pull fresh server state for all views. send-heyreach-message now
      // appends to reply_thread in the DB, so the refetched data will match
      // (or be a superset of) our optimistic append — no flash-and-vanish.
      queryClient.invalidateQueries({ queryKey: ['agent-lead', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['agent-leads'] });
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
    },
  });
}

export function useAddToHeyReachCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lead_id,
      campaign_id,
      message,
    }: {
      lead_id: string;
      campaign_id: string;
      message: string;
      // campaign_name is accepted so the onMutate optimistic message can
      // label which campaign was just added — it's NOT sent to the edge
      // function (the edge function looks it up from synced_campaigns).
      campaign_name?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('add-to-heyreach-campaign', {
        body: { lead_id, campaign_id, message },
      });

      if (error) throw new Error(error.message || 'Failed to add to campaign');
      if (!data?.success) throw new Error(data?.error || 'Failed to add to campaign');
      return data as { success: true; addedLeadsCount: number; updatedLeadsCount: number; failedLeadsCount: number };
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['agent-lead', variables.lead_id] });

      const previous = queryClient.getQueryData<LeadCacheShape>([
        'agent-lead',
        variables.lead_id,
      ]);

      const systemMessage = {
        role: 'system',
        content: `Added to campaign: ${variables.campaign_name ?? 'Unknown'}`,
        timestamp: new Date().toISOString(),
        channel: 'linkedin',
      };

      queryClient.setQueryData(
        ['agent-lead', variables.lead_id],
        (old: LeadCacheShape | undefined) => ({
          ...(old ?? { id: variables.lead_id }),
          reply_thread: [...(old?.reply_thread ?? []), systemMessage],
        }),
      );

      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['agent-lead', variables.lead_id], context.previous);
      }
      toast.error(`Failed to add to campaign: ${error.message}`);
    },
    onSuccess: (data) => {
      toast.success(`${data.addedLeadsCount} lead${data.addedLeadsCount !== 1 ? 's' : ''} added to campaign`);
    },
    onSettled: (_data, _error, variables) => {
      // add-to-heyreach-campaign appends the system message to reply_thread
      // server-side (see that function) so the refetched data will include it.
      queryClient.invalidateQueries({ queryKey: ['agent-lead', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['agent-leads'] });
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
    },
  });
}
