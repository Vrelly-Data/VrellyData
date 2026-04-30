import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SmartleadCampaign {
  id: string;
  name: string;
  status: string | null;
  external_campaign_id: string;
}

export function useSmartleadCampaigns() {
  return useQuery({
    queryKey: ['smartlead-campaigns'],
    queryFn: async (): Promise<SmartleadCampaign[]> => {
      const { data: integrations, error: intError } = await supabase
        .from('outbound_integrations')
        .select('id')
        .eq('platform', 'smartlead');

      if (intError) throw intError;
      if (!integrations?.length) return [];

      const integrationIds = integrations.map((i) => i.id);

      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, status, external_campaign_id')
        .in('integration_id', integrationIds)
        .order('name', { ascending: true });

      if (error) throw error;
      return (data || []) as SmartleadCampaign[];
    },
  });
}

type LeadCacheShape = { reply_thread?: unknown[] } & Record<string, unknown>;

export function useAddToSmartleadCampaign() {
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
      // campaign_name powers the optimistic system message + success toast;
      // the edge function looks the name up server-side from synced_campaigns
      // for last_campaign_name persistence and does NOT consume this field.
      campaign_name?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('add-to-smartlead-campaign', {
        body: { lead_id, campaign_id, message },
      });

      if (error) throw new Error(error.message || 'Failed to add to campaign');
      if (!data?.success) throw new Error(data?.error || 'Failed to add to campaign');
      return data as { success: true; campaignName: string | null; campaignId: string };
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
        channel: 'email',
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
    onSuccess: (data, variables) => {
      const name = data.campaignName ?? variables.campaign_name ?? 'Unknown';
      // Smartlead silently drops the personalized message unless the campaign
      // template references {{first_touch_message}} — surface that in the toast
      // so the user can verify before the sequence fires.
      toast.success(
        `Added to campaign "${name}" ✓ Make sure {{first_touch_message}} is referenced in the Smartlead campaign template.`,
      );
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-lead', variables.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['agent-leads'] });
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
    },
  });
}
