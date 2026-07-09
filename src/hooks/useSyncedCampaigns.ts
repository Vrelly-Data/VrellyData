import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SyncedCampaign {
  id: string;
  name: string;
  status: string | null;
  // Platform tag: 'heyreach' | 'smartlead' | 'reply_io'. Used for grouping
  // and "where did this row come from" — but NOT for channel determination
  // (Reply.io is multichannel). Use `channel` for that.
  source: string | null;
  // Channel: 'linkedin' | 'email' | 'multichannel' | null. Written at sync
  // time by each sync function — HR/SL hardcode it (single-channel
  // platforms); sync-reply-campaigns derives it per-sequence from the
  // step types. Drives the channel badge in CampaignsTable. NULL on
  // Reply.io rows that haven't been re-synced since the 20260619130000
  // migration, or on sequences with neither email nor linkedIn steps.
  channel: string | null;
  stats: {
    peopleCount?: number;
    sent?: number;
    delivered?: number;
    replies?: number;
    opens?: number;
    clicks?: number;
    peopleFinished?: number;
    // LinkedIn (Reply.io) — stored by sync-reply-campaigns' formatLinkedinStats.
    // The Opens/Connections column falls back to these for LinkedIn campaigns.
    linkedinConnectionsSent?: number;
    linkedinConnectionsAccepted?: number;
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
        .select('id, name, status, source, channel, stats, updated_at, external_campaign_id, is_linked');

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
