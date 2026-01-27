import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface LinkedInStatsRow {
  campaignName: string;
  linkedinMessagesSent: number;
  linkedinConnectionsSent: number;
  linkedinReplies: number;
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
      const matchedStats = stats.filter(s => s.matched && s.campaignId);
      
      if (matchedStats.length === 0) {
        throw new Error('No campaigns matched to update');
      }

      let updatedCount = 0;

      for (const stat of matchedStats) {
        // First fetch current stats
        const { data: campaign, error: fetchError } = await supabase
          .from('synced_campaigns')
          .select('stats')
          .eq('id', stat.campaignId!)
          .maybeSingle();

        if (fetchError) {
          console.error(`Error fetching campaign ${stat.campaignId}:`, fetchError);
          continue;
        }

        const existingStats = (campaign?.stats as Record<string, unknown>) || {};
        
        let newLinkedinMessagesSent = stat.linkedinMessagesSent;
        let newLinkedinConnectionsSent = stat.linkedinConnectionsSent;
        let newLinkedinReplies = stat.linkedinReplies;

        if (mode === 'add') {
          newLinkedinMessagesSent += (existingStats.linkedinMessagesSent as number) || 0;
          newLinkedinConnectionsSent += (existingStats.linkedinConnectionsSent as number) || 0;
          newLinkedinReplies += (existingStats.linkedinReplies as number) || 0;
        }

        const mergedStats = {
          ...existingStats,
          linkedinMessagesSent: newLinkedinMessagesSent,
          linkedinConnectionsSent: newLinkedinConnectionsSent,
          linkedinReplies: newLinkedinReplies,
          linkedinDataSource: 'csv_upload',
          linkedinDataUploadedAt: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
          .from('synced_campaigns')
          .update({ 
            stats: mergedStats,
            updated_at: new Date().toISOString(),
          })
          .eq('id', stat.campaignId!);

        if (updateError) {
          console.error(`Error updating campaign ${stat.campaignId}:`, updateError);
        } else {
          updatedCount++;
        }
      }

      return { updatedCount, totalMatched: matchedStats.length };
    },
    onSuccess: ({ updatedCount, totalMatched }) => {
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      toast({
        title: 'LinkedIn Stats Imported',
        description: `Updated ${updatedCount} of ${totalMatched} campaigns`,
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
