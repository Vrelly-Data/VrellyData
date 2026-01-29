import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

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

      // Get user's team_id for creating new campaigns
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership?.team_id) throw new Error('No team found for user');

      // Try to find an existing integration (optional)
      const { data: integration } = await supabase
        .from('outbound_integrations')
        .select('id')
        .eq('team_id', membership.team_id)
        .eq('platform', 'reply')
        .maybeSingle();

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

      for (const stat of stats) {
        const linkedinStats = {
          linkedinMessagesSent: stat.linkedinMessagesSent,
          linkedinConnectionsSent: stat.linkedinConnectionsSent,
          linkedinReplies: stat.linkedinReplies,
          linkedinConnectionsAccepted: stat.linkedinConnectionsAccepted,
          linkedinDataSource: 'csv_upload',
          linkedinDataUploadedAt: new Date().toISOString(),
        };

        if (stat.matched && stat.campaignId) {
          // UPDATE existing campaign
          const { data: campaign, error: fetchError } = await supabase
            .from('synced_campaigns')
            .select('stats')
            .eq('id', stat.campaignId)
            .maybeSingle();

          if (fetchError) {
            console.error(`Error fetching campaign ${stat.campaignId}:`, fetchError);
            continue;
          }

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
          }
        } else {
          // CREATE new campaign from CSV data
          const { error: insertError } = await supabase
            .from('synced_campaigns')
            .insert({
              team_id: membership.team_id,
              integration_id: integration?.id || null,
              external_campaign_id: `csv_import_${Date.now()}_${stat.campaignName.replace(/\s+/g, '_')}`,
              name: stat.campaignName,
              status: 'imported',
              stats: linkedinStats,
            });

          if (insertError) {
            console.error(`Error creating campaign ${stat.campaignName}:`, insertError);
          } else {
            createdCount++;
          }
        }
      }

      return { updatedCount, createdCount, total: stats.length };
    },
    onSuccess: ({ updatedCount, createdCount, total }) => {
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      
      const parts = [];
      if (updatedCount > 0) parts.push(`Updated ${updatedCount}`);
      if (createdCount > 0) parts.push(`Created ${createdCount}`);
      
      toast({
        title: 'LinkedIn Stats Imported',
        description: parts.join(', ') + ` of ${total} campaigns`,
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
