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
    onSuccess: (_data, variables) => {
      // Optimistic append to the cached lead so the conversation thread in
      // LeadDetailPanel shows the sent message instantly. useLiveLead reads
      // ['agent-lead', leadId] so mutating that cache re-renders the panel.
      const newMessage = {
        role: 'me',
        content: variables.message,
        timestamp: new Date().toISOString(),
        channel: 'linkedin',
      };
      queryClient.setQueryData(
        ['agent-lead', variables.lead_id],
        (old: { reply_thread?: unknown[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            reply_thread: [...(old.reply_thread ?? []), newMessage],
          };
        },
      );

      // Refresh list-level queries in the background. Intentionally NOT
      // invalidating ['agent-lead', lead_id] — that would trigger a refetch
      // and immediately overwrite the optimistic append before the webhook
      // has a chance to ingest the sent message server-side.
      queryClient.invalidateQueries({ queryKey: ['agent-leads'] });
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });

      toast.success('Message sent');
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });
}

export function useAddToHeyReachCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lead_id, campaign_id, message }: { lead_id: string; campaign_id: string; message: string }) => {
      const { data, error } = await supabase.functions.invoke('add-to-heyreach-campaign', {
        body: { lead_id, campaign_id, message },
      });

      if (error) throw new Error(error.message || 'Failed to add to campaign');
      if (!data?.success) throw new Error(data?.error || 'Failed to add to campaign');
      return data as { success: true; addedLeadsCount: number; updatedLeadsCount: number; failedLeadsCount: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-leads'] });
      toast.success(`${data.addedLeadsCount} lead${data.addedLeadsCount !== 1 ? 's' : ''} added to campaign`);
    },
    onError: (error) => {
      toast.error(`Failed to add to campaign: ${error.message}`);
    },
  });
}
