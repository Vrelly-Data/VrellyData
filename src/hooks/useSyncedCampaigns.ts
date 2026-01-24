import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SyncedCampaign {
  id: string;
  name: string;
  status: string | null;
  stats: {
    peopleCount?: number;
    sent?: number;
    delivered?: number;
    replies?: number;
    opens?: number;
    peopleFinished?: number;
  } | null;
  updated_at: string;
  external_campaign_id: string;
}

export function useSyncedCampaigns() {
  return useQuery({
    queryKey: ['synced-campaigns'],
    queryFn: async (): Promise<SyncedCampaign[]> => {
      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, status, stats, updated_at, external_campaign_id')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(campaign => ({
        ...campaign,
        stats: campaign.stats as SyncedCampaign['stats'],
      }));
    },
  });
}
