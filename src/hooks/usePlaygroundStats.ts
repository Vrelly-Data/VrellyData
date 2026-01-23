import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlaygroundStats {
  totalMessagesSent: number;
  totalReplies: number;
  totalContacts: number;
  activeCampaigns: number;
  completionPercentage: number;
  campaignScore: number | null; // Placeholder for proprietary scoring
}

export function usePlaygroundStats() {
  return useQuery({
    queryKey: ['playground-stats'],
    queryFn: async (): Promise<PlaygroundStats> => {
      // Fetch campaigns
      const { data: campaigns, error: campaignsError } = await supabase
        .from('synced_campaigns')
        .select('id, status, stats');

      if (campaignsError) throw campaignsError;

      // Fetch contacts
      const { data: contacts, error: contactsError } = await supabase
        .from('synced_contacts')
        .select('id, engagement_data');

      if (contactsError) throw contactsError;

      // Calculate stats from campaigns
      let totalMessagesSent = 0;
      let activeCampaigns = 0;
      let totalSent = 0;
      let totalDelivered = 0;

      campaigns?.forEach((campaign) => {
        const stats = campaign.stats as Record<string, number> | null;
        if (stats) {
          totalMessagesSent += stats.sent || 0;
          totalSent += stats.total || stats.sent || 0;
          totalDelivered += stats.delivered || stats.sent || 0;
        }
        if (campaign.status === 'active') {
          activeCampaigns++;
        }
      });

      // Calculate stats from contacts
      let totalReplies = 0;
      contacts?.forEach((contact) => {
        const engagement = contact.engagement_data as Record<string, boolean | number> | null;
        if (engagement?.replied) {
          totalReplies++;
        }
      });

      // Calculate completion percentage
      const completionPercentage = totalSent > 0 
        ? Math.round((totalDelivered / totalSent) * 100) 
        : 0;

      return {
        totalMessagesSent,
        totalReplies,
        totalContacts: contacts?.length ?? 0,
        activeCampaigns,
        completionPercentage,
        campaignScore: null, // Placeholder - will be implemented later
      };
    },
  });
}
