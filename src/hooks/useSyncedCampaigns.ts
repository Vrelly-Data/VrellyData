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
  is_linked: boolean;
}

export function useSyncedCampaigns(onlyLinked: boolean = true) {
  return useQuery({
    queryKey: ['synced-campaigns', onlyLinked],
    queryFn: async (): Promise<SyncedCampaign[]> => {
      let query = supabase
        .from('synced_campaigns')
        .select('id, name, status, stats, updated_at, external_campaign_id, is_linked');

      // Filter to only linked campaigns if requested
      if (onlyLinked) {
        query = query.eq('is_linked', true);
      }

      const { data, error } = await query.order('updated_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(campaign => ({
        ...campaign,
        stats: campaign.stats as SyncedCampaign['stats'],
      }));
    },
  });
}

// Helper function to normalize campaign names for fuzzy matching
export function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')           // Normalize multiple spaces to single
    .replace(/li\s?\+\s?email/gi, 'linkedin email')  // Normalize "LI + Email" variations
    .replace(/[^\w\s]/g, '');       // Remove special characters
}

// Find best matching campaign using fuzzy matching
export function findMatchingCampaign<T extends { name: string }>(
  campaigns: T[],
  csvCampaignName: string
): T | undefined {
  const normalizedCsv = normalizeForMatch(csvCampaignName);
  
  // First try exact normalized match
  const exactMatch = campaigns.find(c => normalizeForMatch(c.name) === normalizedCsv);
  if (exactMatch) return exactMatch;
  
  // Then try partial match (CSV name contains campaign name or vice versa)
  const partialMatch = campaigns.find(c => {
    const normalizedCampaign = normalizeForMatch(c.name);
    return normalizedCsv.includes(normalizedCampaign) || normalizedCampaign.includes(normalizedCsv);
  });
  
  return partialMatch;
}
