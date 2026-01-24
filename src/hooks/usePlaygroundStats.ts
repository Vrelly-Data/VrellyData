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
      let totalReplies = 0;
      let totalContacts = 0;
      let activeCampaigns = 0;
      let totalPeopleFinished = 0;
      let totalPeopleCount = 0;

      campaigns?.forEach((campaign) => {
        const stats = campaign.stats as Record<string, number> | null;
        if (stats) {
          totalMessagesSent += stats.sent || stats.delivered || 0;
          totalReplies += stats.replies || 0;
          totalContacts += stats.peopleCount || 0;
          totalPeopleFinished += stats.peopleFinished || 0;
          totalPeopleCount += stats.peopleCount || 0;
        }
        if (campaign.status === 'active') {
          activeCampaigns++;
        }
      });

      // Calculate completion percentage based on people finished vs total people
      const completionPercentage = totalPeopleCount > 0 
        ? Math.round((totalPeopleFinished / totalPeopleCount) * 100) 
        : 0;

      return {
        totalMessagesSent,
        totalReplies,
        totalContacts,
        activeCampaigns,
        completionPercentage,
        campaignScore: null, // Placeholder - will be implemented later
      };
    },
  });
}
