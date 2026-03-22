import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { findMatchingCampaign } from '@/hooks/useSyncedCampaigns';
import { generatePerformanceSnapshot } from '@/lib/performanceSnapshot';
import type { Json } from '@/integrations/supabase/types';

export interface EmailStatsRow {
  campaignName: string;
  sequenceId: string | null;
  delivered: number;
  replies: number;
  opens: number;
  clicked: number;
  bounced: number;
  outOfOffice: number;
  optedOut: number;
  interested: number;
  notInterested: number;
  autoReplied: number;
  matched: boolean;
  campaignId?: string;
}

export interface UploadEmailStatsParams {
  stats: EmailStatsRow[];
  mode: 'replace' | 'add';
}

// Email stat keys that should be cleared in replace mode
const EMAIL_STAT_KEYS = [
  'sent', 'delivered', 'replies', 'opens', 'clicked', 'bounced',
  'outOfOffice', 'optedOut', 'interested', 'notInterested', 'autoReplied',
  'emailDataSource', 'emailDataUploadedAt',
] as const;

export function useEmailStatsUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ stats, mode }: UploadEmailStatsParams) => {
      if (stats.length === 0) throw new Error('No campaigns to import');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership?.team_id) throw new Error('No team found for user');

      // Fetch all linked campaigns for matching
      const { data: linkedCampaigns } = await supabase
        .from('synced_campaigns')
        .select('id, name, stats, is_linked, external_campaign_id')
        .eq('team_id', membership.team_id)
        .eq('is_linked', true);

      // Replace mode: clear email stats from ALL team campaigns (preserve LinkedIn)
      if (mode === 'replace') {
        const { data: allCampaigns } = await supabase
          .from('synced_campaigns')
          .select('id, stats')
          .eq('team_id', membership.team_id);

        if (allCampaigns) {
          for (const campaign of allCampaigns) {
            const existingStats = (campaign.stats as Record<string, unknown>) || {};
            const clearedStats: Record<string, unknown> = { ...existingStats };
            for (const key of EMAIL_STAT_KEYS) {
              if (key === 'emailDataSource' || key === 'emailDataUploadedAt') {
                clearedStats[key] = null;
              } else {
                clearedStats[key] = 0;
              }
            }
            await supabase
              .from('synced_campaigns')
              .update({ stats: clearedStats as unknown as Json, updated_at: new Date().toISOString() })
              .eq('id', campaign.id);
          }
        }
      }

      // Aggregate rows by campaignId to handle contact-level CSVs
      const aggregated = new Map<string, EmailStatsRow>();
      for (const stat of stats) {
        const key = stat.campaignId || `unmatched:${stat.campaignName}`;
        const existing = aggregated.get(key);
        if (existing) {
          existing.delivered += stat.delivered;
          existing.replies += stat.replies;
          existing.opens += stat.opens;
          existing.clicked += stat.clicked;
          existing.bounced += stat.bounced;
          existing.outOfOffice += stat.outOfOffice;
          existing.optedOut += stat.optedOut;
          existing.interested += stat.interested;
          existing.notInterested += stat.notInterested;
          existing.autoReplied += stat.autoReplied;
        } else {
          aggregated.set(key, { ...stat });
        }
      }

      let updatedCount = 0;
      const updatedCampaignIds: string[] = [];
      const aggregatedStats = Array.from(aggregated.values());

      for (const stat of aggregatedStats) {
        const emailStats: Record<string, unknown> = {
          sent: stat.delivered,
          delivered: stat.delivered,
          replies: stat.replies,
          opens: stat.opens,
          clicked: stat.clicked,
          bounced: stat.bounced,
          outOfOffice: stat.outOfOffice,
          optedOut: stat.optedOut,
          interested: stat.interested,
          notInterested: stat.notInterested,
          autoReplied: stat.autoReplied,
          emailDataSource: 'csv_upload',
          emailDataUploadedAt: new Date().toISOString(),
        };

        // Match by sequence ID first, then by name
        let matchedCampaign = stat.sequenceId
          ? (linkedCampaigns || []).find(c => c.external_campaign_id === stat.sequenceId)
          : null;

        if (!matchedCampaign) {
          matchedCampaign = findMatchingCampaign(linkedCampaigns || [], stat.campaignName);
        }

        if (matchedCampaign) {
          const existingStats = (matchedCampaign.stats as Record<string, unknown>) || {};

          if (mode === 'add') {
            for (const key of EMAIL_STAT_KEYS) {
              if (key === 'emailDataSource' || key === 'emailDataUploadedAt') continue;
              emailStats[key] = ((emailStats[key] as number) || 0) + ((existingStats[key] as number) || 0);
            }
          }

          const mergedStats: Record<string, unknown> = { ...existingStats, ...emailStats };

          const { error } = await supabase
            .from('synced_campaigns')
            .update({ stats: mergedStats as unknown as Json, updated_at: new Date().toISOString() })
            .eq('id', matchedCampaign.id);

          if (!error) {
            updatedCount++;
            updatedCampaignIds.push(matchedCampaign.id);
          } else console.error(`Error updating campaign ${matchedCampaign.name}:`, error);
        } else if (stat.matched && stat.campaignId) {
          const { data: campaign } = await supabase
            .from('synced_campaigns')
            .select('stats')
            .eq('id', stat.campaignId)
            .maybeSingle();

          const existingStats = (campaign?.stats as Record<string, unknown>) || {};

          if (mode === 'add') {
            for (const key of EMAIL_STAT_KEYS) {
              if (key === 'emailDataSource' || key === 'emailDataUploadedAt') continue;
              emailStats[key] = ((emailStats[key] as number) || 0) + ((existingStats[key] as number) || 0);
            }
          }

          const mergedStats: Record<string, unknown> = { ...existingStats, ...emailStats };

          const { error } = await supabase
            .from('synced_campaigns')
            .update({ stats: mergedStats as unknown as Json, updated_at: new Date().toISOString() })
            .eq('id', stat.campaignId);

          if (!error) {
            updatedCount++;
            if (stat.campaignId) updatedCampaignIds.push(stat.campaignId);
          }
        } else {
          // No matching linked campaign found - skipping
        }
      }

      return { updatedCount, total: aggregatedStats.length, updatedCampaignIds };
    },
    onSuccess: ({ updatedCount, total, updatedCampaignIds }) => {
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });

      // Generate performance snapshots for updated campaigns
      for (const id of updatedCampaignIds) {
        generatePerformanceSnapshot(id).catch(console.error);
      }

      const skipped = total - updatedCount;
      const parts = [`Updated ${updatedCount} result(s)`];
      if (skipped > 0) parts.push(`${skipped} skipped (no match)`);

      toast({
        title: 'Email Stats Imported',
        description: parts.join(', '),
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
