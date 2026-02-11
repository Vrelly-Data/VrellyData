import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { normalizeForMatch, findMatchingCampaign } from '@/hooks/useSyncedCampaigns';
import { generatePerformanceSnapshot } from '@/lib/performanceSnapshot';

export interface LinkedInStatsRow {
  campaignName: string;
  linkedinMessagesSent: number;
  linkedinConnectionsSent: number;
  linkedinReplies: number;
  linkedinConnectionsAccepted: number;
  matched: boolean;
  campaignId?: string;
}

export interface UploadLinkedInStatsParams {
  stats: LinkedInStatsRow[];
  mode: 'replace' | 'add';
}

export function useLinkedInStatsUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ stats, mode }: UploadLinkedInStatsParams) => {
      if (stats.length === 0) {
        throw new Error('No campaigns to import');
      }

      // Get user's team_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership?.team_id) throw new Error('No team found for user');

      // Fetch ALL linked campaigns for matching (not just the ones in preview)
      const { data: linkedCampaigns } = await supabase
        .from('synced_campaigns')
        .select('id, name, stats, is_linked')
        .eq('team_id', membership.team_id)
        .eq('is_linked', true);

      // For "replace" mode, first clear ALL LinkedIn stats from all team campaigns
      if (mode === 'replace') {
        const { data: allCampaigns } = await supabase
          .from('synced_campaigns')
          .select('id, stats')
          .eq('team_id', membership.team_id);

        if (allCampaigns) {
          for (const campaign of allCampaigns) {
            const existingStats = (campaign.stats as Record<string, unknown>) || {};
            const clearedStats = {
              ...existingStats,
              linkedinMessagesSent: 0,
              linkedinConnectionsSent: 0,
              linkedinReplies: 0,
              linkedinConnectionsAccepted: 0,
              linkedinDataSource: null,
              linkedinDataUploadedAt: null,
            };
            
            await supabase
              .from('synced_campaigns')
              .update({ stats: clearedStats, updated_at: new Date().toISOString() })
              .eq('id', campaign.id);
          }
        }
      }

      let updatedCount = 0;
      let createdCount = 0;
      const updatedCampaignIds: string[] = [];

      for (const stat of stats) {
        const linkedinStats = {
          linkedinMessagesSent: stat.linkedinMessagesSent,
          linkedinConnectionsSent: stat.linkedinConnectionsSent,
          linkedinReplies: stat.linkedinReplies,
          linkedinConnectionsAccepted: stat.linkedinConnectionsAccepted,
          linkedinDataSource: 'csv_upload',
          linkedinDataUploadedAt: new Date().toISOString(),
        };

        // Try to find a matching LINKED campaign by name (fuzzy match)
        const matchedLinkedCampaign = findMatchingCampaign(linkedCampaigns || [], stat.campaignName);

        if (matchedLinkedCampaign) {
          // UPDATE the linked campaign directly (not create a new row)
          const existingStats = (matchedLinkedCampaign.stats as Record<string, unknown>) || {};
          
          let newLinkedinMessagesSent = stat.linkedinMessagesSent;
          let newLinkedinConnectionsSent = stat.linkedinConnectionsSent;
          let newLinkedinReplies = stat.linkedinReplies;
          let newLinkedinConnectionsAccepted = stat.linkedinConnectionsAccepted;

          if (mode === 'add') {
            newLinkedinMessagesSent += (existingStats.linkedinMessagesSent as number) || 0;
            newLinkedinConnectionsSent += (existingStats.linkedinConnectionsSent as number) || 0;
            newLinkedinReplies += (existingStats.linkedinReplies as number) || 0;
            newLinkedinConnectionsAccepted += (existingStats.linkedinConnectionsAccepted as number) || 0;
          }

          const mergedStats = {
            ...existingStats,
            linkedinMessagesSent: newLinkedinMessagesSent,
            linkedinConnectionsSent: newLinkedinConnectionsSent,
            linkedinReplies: newLinkedinReplies,
            linkedinConnectionsAccepted: newLinkedinConnectionsAccepted,
            linkedinDataSource: 'csv_upload',
            linkedinDataUploadedAt: new Date().toISOString(),
          };

          const { error: updateError } = await supabase
            .from('synced_campaigns')
            .update({ 
              stats: mergedStats,
              updated_at: new Date().toISOString(),
            })
            .eq('id', matchedLinkedCampaign.id);

          if (updateError) {
            console.error(`Error updating campaign ${matchedLinkedCampaign.name}:`, updateError);
          } else {
            updatedCount++;
            updatedCampaignIds.push(matchedLinkedCampaign.id);
          }
        } else if (stat.matched && stat.campaignId) {
          // Fallback: use the campaignId from the dialog if it was pre-matched
          const { data: campaign } = await supabase
            .from('synced_campaigns')
            .select('stats')
            .eq('id', stat.campaignId)
            .maybeSingle();

          const existingStats = (campaign?.stats as Record<string, unknown>) || {};
          
          let newLinkedinMessagesSent = stat.linkedinMessagesSent;
          let newLinkedinConnectionsSent = stat.linkedinConnectionsSent;
          let newLinkedinReplies = stat.linkedinReplies;
          let newLinkedinConnectionsAccepted = stat.linkedinConnectionsAccepted;

          if (mode === 'add') {
            newLinkedinMessagesSent += (existingStats.linkedinMessagesSent as number) || 0;
            newLinkedinConnectionsSent += (existingStats.linkedinConnectionsSent as number) || 0;
            newLinkedinReplies += (existingStats.linkedinReplies as number) || 0;
            newLinkedinConnectionsAccepted += (existingStats.linkedinConnectionsAccepted as number) || 0;
          }

          const mergedStats = {
            ...existingStats,
            linkedinMessagesSent: newLinkedinMessagesSent,
            linkedinConnectionsSent: newLinkedinConnectionsSent,
            linkedinReplies: newLinkedinReplies,
            linkedinConnectionsAccepted: newLinkedinConnectionsAccepted,
            linkedinDataSource: 'csv_upload',
            linkedinDataUploadedAt: new Date().toISOString(),
          };

          const { error: updateError } = await supabase
            .from('synced_campaigns')
            .update({ 
              stats: mergedStats,
              updated_at: new Date().toISOString(),
            })
            .eq('id', stat.campaignId);

          if (updateError) {
            console.error(`Error updating campaign ${stat.campaignId}:`, updateError);
          } else {
            updatedCount++;
            if (stat.campaignId) updatedCampaignIds.push(stat.campaignId);
          }
        } else {
          // No matching linked campaign found - skip creating orphan rows
          // Log for debugging but don't create csv_import rows anymore
          console.log(`No matching linked campaign found for: ${stat.campaignName} - skipping`);
        }
      }

      return { updatedCount, createdCount, total: stats.length, updatedCampaignIds };
    },
    onSuccess: ({ updatedCount, createdCount, total, updatedCampaignIds }) => {
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });

      // Generate performance snapshots for updated campaigns
      for (const id of updatedCampaignIds) {
        generatePerformanceSnapshot(id).catch(console.error);
      }
      
      const parts = [];
      if (updatedCount > 0) parts.push(`Updated ${updatedCount}`);
      if (createdCount > 0) parts.push(`Created ${createdCount}`);
      
      const skipped = total - updatedCount - createdCount;
      if (skipped > 0) parts.push(`${skipped} skipped (no matching campaign)`);
      
      toast({
        title: 'LinkedIn Stats Imported',
        description: parts.join(', ') || 'No changes made',
      });
    },
    onError: (error) => {
      toast({
        title: 'Import Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
