import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PlaygroundStats {
  totalMessagesSent: number;
  totalReplies: number;
  totalContacts: number;
  activeCampaigns: number;
  completionPercentage: number;
  outOfOfficeCount: number;
  campaignScore: number | null;
  // Separated metrics for Email vs LinkedIn breakdown
  emailDeliveries: number;
  emailReplies: number;
  linkedinCampaignCount: number;
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
      let outOfOfficeCount = 0;
      
      // Email-specific metrics (Reply.io only reports email deliveries at campaign level)
      let emailDeliveries = 0;
      let emailReplies = 0;
      let linkedinCampaignCount = 0;

      campaigns?.forEach((campaign) => {
        const stats = campaign.stats as Record<string, number> | null;
        if (stats) {
          const sent = stats.sent || stats.delivered || 0;
          const replies = stats.replies || 0;
          
          totalMessagesSent += sent;
          totalReplies += replies;
          totalContacts += stats.peopleCount || 0;
          totalPeopleFinished += stats.peopleFinished || 0;
          totalPeopleCount += stats.peopleCount || 0;
          outOfOfficeCount += stats.outOfOffice || 0;
          
          // Track email-specific metrics
          // deliveriesCount in Reply.io is email-only
          emailDeliveries += sent;
          emailReplies += replies;
          
          // Identify LinkedIn-focused campaigns (have people but no email deliveries)
          if (sent === 0 && (stats.peopleCount || 0) > 0) {
            linkedinCampaignCount++;
          }
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
        outOfOfficeCount,
        campaignScore: null,
        emailDeliveries,
        emailReplies,
        linkedinCampaignCount,
      };
    },
  });
}
