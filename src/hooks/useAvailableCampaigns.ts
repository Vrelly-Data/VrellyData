import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AvailableCampaign {
  id: string;
  name: string;
  status: string;
  peopleCount: number;
  isLinked: boolean;
}

export function useAvailableCampaigns(integrationId: string | null) {
  const queryClient = useQueryClient();

  const fetchCampaigns = useQuery({
    queryKey: ['available-campaigns', integrationId],
    queryFn: async (): Promise<AvailableCampaign[]> => {
      if (!integrationId) return [];

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('fetch-available-campaigns', {
        body: { integrationId },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch campaigns');
      }

      return response.data.campaigns || [];
    },
    enabled: !!integrationId,
    staleTime: 30000, // 30 seconds
  });

  const updateLinkedCampaigns = useMutation({
    mutationFn: async ({ campaignIds, isLinked }: { campaignIds: string[], isLinked: boolean }) => {
      if (!integrationId) throw new Error('No integration selected');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Get team_id from integration
      const { data: integration } = await supabase
        .from('outbound_integrations')
        .select('team_id')
        .eq('id', integrationId)
        .single();

      if (!integration) throw new Error('Integration not found');

      // Update is_linked status for selected campaigns
      const { error } = await supabase
        .from('synced_campaigns')
        .update({ is_linked: isLinked })
        .eq('team_id', integration.team_id)
        .in('external_campaign_id', campaignIds);

      if (error) throw error;

      return { campaignIds, isLinked };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-campaigns', integrationId] });
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      toast.success('Campaign links updated');
    },
    onError: (error) => {
      toast.error(`Failed to update campaigns: ${error.message}`);
    },
  });

  const linkCampaigns = (campaignIds: string[]) => {
    updateLinkedCampaigns.mutate({ campaignIds, isLinked: true });
  };

  const unlinkCampaigns = (campaignIds: string[]) => {
    updateLinkedCampaigns.mutate({ campaignIds, isLinked: false });
  };

  const bulkUpdateLinks = async (updates: { id: string; isLinked: boolean }[]) => {
    if (!integrationId) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    // Get team_id from integration
    const { data: integration } = await supabase
      .from('outbound_integrations')
      .select('team_id')
      .eq('id', integrationId)
      .single();

    if (!integration) throw new Error('Integration not found');

    // Process updates in batches
    const toLink = updates.filter(u => u.isLinked).map(u => u.id);
    const toUnlink = updates.filter(u => !u.isLinked).map(u => u.id);

    const promises = [];

    if (toLink.length > 0) {
      promises.push(
        supabase
          .from('synced_campaigns')
          .update({ is_linked: true })
          .eq('team_id', integration.team_id)
          .in('external_campaign_id', toLink)
      );
    }

    if (toUnlink.length > 0) {
      promises.push(
        supabase
          .from('synced_campaigns')
          .update({ is_linked: false })
          .eq('team_id', integration.team_id)
          .in('external_campaign_id', toUnlink)
      );
    }

    await Promise.all(promises);

    queryClient.invalidateQueries({ queryKey: ['available-campaigns', integrationId] });
    queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
    
    toast.success(`Updated ${updates.length} campaigns`);
  };

  return {
    campaigns: fetchCampaigns.data || [],
    isLoading: fetchCampaigns.isLoading,
    error: fetchCampaigns.error,
    refetch: fetchCampaigns.refetch,
    linkCampaigns,
    unlinkCampaigns,
    bulkUpdateLinks,
    isUpdating: updateLinkedCampaigns.isPending,
  };
}
