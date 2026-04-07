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

export interface LinkedInRepliedContact {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  linkedinUrl: string;
  actionDate: string;
  sequence: string;
}

export interface UploadLinkedInStatsParams {
  stats: LinkedInStatsRow[];
  mode: 'replace' | 'add';
  repliedContacts?: LinkedInRepliedContact[];
}

export function useLinkedInStatsUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ stats, mode, repliedContacts }: UploadLinkedInStatsParams) => {
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
          // No matching linked campaign found - skipping
        }
      }

      // Extract replied contacts into agent_leads (non-blocking)
      if (repliedContacts && repliedContacts.length > 0) {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const currentUserId = sessionData?.session?.user?.id;

          if (currentUserId) {
            // Check if user has an active agent config
            const { data: agentConfig } = await supabase
              .from('agent_configs')
              .select('id')
              .eq('user_id', currentUserId)
              .eq('is_active', true)
              .limit(1)
              .maybeSingle();

            if (agentConfig) {
              for (const contact of repliedContacts) {
                try {
                  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
                  // Try to extract company from email domain
                  let company = '';
                  if (contact.email && contact.email.includes('@')) {
                    const domain = contact.email.split('@')[1];
                    if (domain && !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com'].includes(domain.toLowerCase())) {
                      company = domain.split('.')[0];
                      company = company.charAt(0).toUpperCase() + company.slice(1);
                    }
                  }

                  // Parse action date
                  let lastReplyAt: string | null = null;
                  if (contact.actionDate) {
                    const parsed = new Date(contact.actionDate);
                    if (!isNaN(parsed.getTime())) {
                      lastReplyAt = parsed.toISOString();
                    }
                  }

                  // Try insert first; on conflict, update only if still pending
                  const { error: insertErr } = await supabase
                    .from('agent_leads')
                    .insert({
                      user_id: currentUserId,
                      agent_config_id: agentConfig.id,
                      external_id: contact.contactId,
                      full_name: fullName,
                      email: contact.email || null,
                      linkedin_url: contact.linkedinUrl || null,
                      company: company || null,
                      channel: 'linkedin',
                      pipeline_stage: 'replied',
                      inbox_status: 'pending',
                      last_reply_at: lastReplyAt,
                      last_reply_text: '',
                    });

                  if (insertErr && insertErr.code === '23505') {
                    // Duplicate — update only if inbox_status is still 'pending'
                    await supabase
                      .from('agent_leads')
                      .update({
                        full_name: fullName,
                        email: contact.email || null,
                        linkedin_url: contact.linkedinUrl || null,
                        company: company || null,
                        channel: 'linkedin',
                        pipeline_stage: 'replied',
                        last_reply_at: lastReplyAt,
                        last_reply_text: '',
                      })
                      .eq('user_id', currentUserId)
                      .eq('external_id', contact.contactId)
                      .eq('inbox_status', 'pending');
                  }

                  // Insert agent_activity record
                  await supabase
                    .from('agent_activity')
                    .insert({
                      agent_config_id: agentConfig.id,
                      activity_type: 'reply_received',
                      description: `LinkedIn reply synced from CSV for ${fullName}`,
                      metadata: {
                        channel: 'linkedin',
                        source: 'linkedin_csv_upload',
                        sequence: contact.sequence,
                      },
                    });
                } catch (contactErr) {
                  // Never break the existing upload flow
                  console.warn('Failed to insert agent_lead for contact:', contact.contactId, contactErr);
                }
              }
            }
          }
        } catch (agentErr) {
          // Never break the existing upload flow
          console.warn('Agent leads extraction failed (non-fatal):', agentErr);
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
