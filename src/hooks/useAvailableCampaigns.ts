import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useCallback } from 'react';

export interface AvailableCampaign {
  id: string;
  name: string;
  status: string;
  peopleCount: number;
  isLinked: boolean;
  replyTeamId: string | null;
}

export interface CampaignFetchResult {
  campaigns: AvailableCampaign[];
  teamFiltered: boolean;
  teamId: string | null;
  teamsCount: number;
  discoveredTeamIds?: string[];
  discoveredTeamsCount?: number;
}

export function useAvailableCampaigns(integrationId: string | null) {
  const queryClient = useQueryClient();
  const [skipTeamFilter, setSkipTeamFilter] = useState(false);

  const fetchCampaigns = useQuery({
    queryKey: ['available-campaigns', integrationId, skipTeamFilter],
    queryFn: async (): Promise<CampaignFetchResult> => {
      if (!integrationId) return { campaigns: [], teamFiltered: false, teamId: null, teamsCount: 0 };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('fetch-available-campaigns', {
        body: { integrationId, skipTeamFilter },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch campaigns');
      }

      return {
        campaigns: response.data.campaigns || [],
        teamFiltered: response.data.teamFiltered ?? false,
        teamId: response.data.teamId ?? null,
        teamsCount: response.data.teamsCount ?? 1,
        discoveredTeamIds: response.data.discoveredTeamIds,
        discoveredTeamsCount: response.data.discoveredTeamsCount,
      };
    },
    enabled: !!integrationId,
    staleTime: 30000, // 30 seconds
  });

  const toggleTeamFilter = useCallback(() => {
    setSkipTeamFilter(prev => !prev);
  }, []);

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
    campaigns: fetchCampaigns.data?.campaigns || [],
    teamFiltered: fetchCampaigns.data?.teamFiltered ?? false,
    teamId: fetchCampaigns.data?.teamId ?? null,
    teamsCount: fetchCampaigns.data?.teamsCount ?? 1,
    discoveredTeamIds: fetchCampaigns.data?.discoveredTeamIds,
    discoveredTeamsCount: fetchCampaigns.data?.discoveredTeamsCount,
    skipTeamFilter,
    toggleTeamFilter,
    isLoading: fetchCampaigns.isLoading,
    error: fetchCampaigns.error,
    refetch: fetchCampaigns.refetch,
    linkCampaigns,
    unlinkCampaigns,
    bulkUpdateLinks,
    isUpdating: updateLinkedCampaigns.isPending,
  };
}
