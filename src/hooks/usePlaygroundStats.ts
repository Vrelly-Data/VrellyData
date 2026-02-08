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
  // LinkedIn-specific metrics from webhooks
  linkedinMessagesSent: number;
  linkedinConnectionsSent: number;
  linkedinConnectionsAccepted: number;
  linkedinReplies: number;
}

interface EngagementData {
  delivered?: boolean;
  sent?: boolean;
  replied?: boolean;
  opened?: boolean;
  clicked?: boolean;
  bounced?: boolean;
  finished?: boolean;
  optedOut?: boolean;
}

export function usePlaygroundStats() {
  return useQuery({
    queryKey: ['playground-stats'],
    queryFn: async (): Promise<PlaygroundStats> => {
      // Fetch campaigns - only linked ones (excludes CSV import duplicates)
      const { data: campaigns, error: campaignsError } = await supabase
        .from('synced_campaigns')
        .select('id, status, stats')
        .eq('is_linked', true);

      if (campaignsError) throw campaignsError;

      // Fetch contacts to calculate stats from engagement data
      const { data: contacts, error: contactsError } = await supabase
        .from('synced_contacts')
        .select('id, engagement_data, campaign_id');

      if (contactsError) throw contactsError;

      // Calculate stats from campaigns
      let totalMessagesSent = 0;
      let totalReplies = 0;
      let totalContacts = 0;
      let activeCampaigns = 0;
      let totalPeopleFinished = 0;
      let totalPeopleCount = 0;
      let outOfOfficeCount = 0;
      
      // Email-specific metrics
      let emailDeliveries = 0;
      let emailReplies = 0;
      let linkedinCampaignCount = 0;
      
      // LinkedIn metrics from webhooks
      let linkedinMessagesSent = 0;
      let linkedinConnectionsSent = 0;
      let linkedinConnectionsAccepted = 0;
      let linkedinReplies = 0;

      // First pass: collect campaign stats
      campaigns?.forEach((campaign) => {
        const stats = campaign.stats as Record<string, number> | null;
        if (stats) {
          // Use sent/delivered from campaign stats (populated by V3 API)
          const sent = stats.sent || stats.delivered || 0;
          const replies = stats.replies || 0;
          
          totalContacts += stats.peopleCount || 0;
          totalPeopleFinished += stats.peopleFinished || 0;
          totalPeopleCount += stats.peopleCount || 0;
          outOfOfficeCount += stats.outOfOffice || 0;
          
          // Track email-specific metrics from campaign stats
          emailDeliveries += sent;
          emailReplies += replies;
          
          // LinkedIn metrics from webhooks/CSV
          linkedinMessagesSent += stats.linkedinMessagesSent || 0;
          linkedinConnectionsSent += stats.linkedinConnectionsSent || 0;
          linkedinConnectionsAccepted += stats.linkedinConnectionsAccepted || 0;
          linkedinReplies += stats.linkedinReplies || 0;
          
          // Identify LinkedIn-focused campaigns (have people but no email deliveries)
          if (sent === 0 && (stats.peopleCount || 0) > 0) {
            linkedinCampaignCount++;
          }
        }
        // Count campaigns that are still running (active or paused)
        const runningStatuses = ['active', 'paused'];
        if (runningStatuses.includes(campaign.status?.toLowerCase() || '')) {
          activeCampaigns++;
        }
      });

      // If campaign stats show 0 deliveries, calculate from contact engagement data
      // This is a fallback when V3 Statistics API fails but contacts are synced
      if (emailDeliveries === 0 && contacts && contacts.length > 0) {
        let contactsWithEngagement = 0;
        let contactReplies = 0;
        
        contacts.forEach((contact) => {
          const engagement = contact.engagement_data as EngagementData | null;
          if (engagement) {
            // Count contacts with delivered flag or any engagement
            if (engagement.delivered || engagement.sent || engagement.opened || 
                engagement.replied || engagement.clicked || engagement.bounced || 
                engagement.finished) {
              contactsWithEngagement++;
            }
            if (engagement.replied) {
              contactReplies++;
            }
          }
        });
        
        // Use contact engagement data as fallback for email metrics
        if (contactsWithEngagement > 0) {
          emailDeliveries = contactsWithEngagement;
          emailReplies = contactReplies;
        }
      }
      
      // Calculate totals
      totalMessagesSent = emailDeliveries + linkedinMessagesSent + linkedinConnectionsSent;
      totalReplies = emailReplies + linkedinReplies;

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
        linkedinMessagesSent,
        linkedinConnectionsSent,
        linkedinConnectionsAccepted,
        linkedinReplies,
      };
    },
  });
}
