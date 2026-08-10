import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Single source of truth for the "active" status bucket on the Data
// Playground dashboard. Used here to compute the Active Campaigns count
// AND by CampaignListDialog to filter the drill-down list, so the card
// number and the modal list can't disagree.
//
// Why a set, not a single value: each sync function normalises its
// platform's status field differently (HeyReach writes 'in_progress',
// Reply.io writes 'active', Smartlead writes 'in_progress' too, etc.).
// "Running but not yet finished" is the operator's mental model — and
// that's a set of lowercased status values, not a single literal.
export const ACTIVE_STATUSES: readonly string[] = [
  'active',
  'paused',
  'in_progress',
  'starting',
  'scheduled',
];

export interface PlaygroundStats {
  totalMessagesSent: number;
  totalReplies: number;
  totalContacts: number;
  activeCampaigns: number;
  completionPercentage: number;
  outOfOfficeCount: number;
  campaignScore: number | null;
  emailDeliveries: number;
  emailReplies: number;
  emailOpens: number;
  emailBounced: number;
  emailClicked: number;
  linkedinCampaignCount: number;
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
      // Fetch campaigns - only linked ones (excludes CSV import duplicates).
      // channel is pulled so the email accumulators below can be gated to
      // email/multichannel rows. Without the gate, Reply.io LinkedIn rows
      // (which carry sent:messagesSent for the dashboard Sent column)
      // would silently pollute the "Emails Sent" tooltip number.
      const { data: campaigns, error: campaignsError } = await supabase
        .from('synced_campaigns')
        .select('id, status, stats, channel')
        .eq('is_linked', true);

      if (campaignsError) throw campaignsError;

      // Get the IDs of linked campaigns to scope contact query
      const linkedCampaignIds = (campaigns || []).map(c => c.id);

      // Fetch contacts only for linked campaigns
      const { data: contacts, error: contactsError } = linkedCampaignIds.length > 0
        ? await supabase
            .from('synced_contacts')
            .select('id, engagement_data, campaign_id')
            .in('campaign_id', linkedCampaignIds)
        : { data: [], error: null };

      if (contactsError) throw contactsError;

      // ---- Total Contacts -----------------------------------------------
      // COUNTED LIVE. Do NOT go back to summing synced_campaigns.stats.peopleCount
      // here, however tempting the "we already have the campaigns" shortcut looks —
      // that is the bug that has been "fixed" three times and keeps returning.
      //
      // peopleCount is a single JSONB key written by SIX functions that do not
      // agree on what it means:
      //   sync-reply-campaigns:332      pickNumber(raw, ['contacted'])   ← people CONTACTED
      //   sync-reply-contacts:968       verifiedCount || contacts.length ← roster COUNT(*)
      //   sync-reply-campaigns:634      em.peopleCount
      //   sync-heyreach-campaigns:140   progressStats.totalUsers
      //   sync-smartlead-campaigns:387  analytics fields
      //   fetch-available-campaigns:213/283
      // The first two run on different crons (campaigns hourly, contacts 6-hourly),
      // so the hourly job overwrites the roster count with "contacted" for ~5 of
      // every 6 hours — and Reply.io reports no `contacted` for LinkedIn-first
      // sequences, so it writes 0 over real rosters. Measured on Avania Clinical:
      // the summed aggregate read 3,558 against 18,590 actual contacts.
      //
      // NOR use `contacts.length` from the fetch above: PostgREST caps responses
      // at 1000 rows (verified — a 5,000-row request returns exactly 1000), so
      // that silently plateaus at 1000 and looks deliberate.
      //
      // head:true transfers no rows, and this is deliberately UNFILTERED so RLS
      // (team_id = get_user_team_id(auth.uid())) supplies the scope — the exact
      // query shape useSyncedContactsPaged uses for the People tab. Same table,
      // same policy, no filters: the two screens cannot disagree by construction.
      // ~5ms on the largest tenant (index-only scan on idx_synced_contacts_team).
      const { count: liveContactCount, error: contactCountError } = await supabase
        .from('synced_contacts')
        .select('id', { count: 'exact', head: true });

      if (contactCountError) throw contactCountError;

      // Calculate stats from campaigns
      let totalMessagesSent = 0;
      let totalReplies = 0;
      let activeCampaigns = 0;
      let totalPeopleFinished = 0;
      let totalPeopleCount = 0;
      let outOfOfficeCount = 0;
      
      // Email-specific metrics
      let emailDeliveries = 0;
      let emailReplies = 0;
      let emailOpens = 0;
      let emailBounced = 0;
      let emailClicked = 0;
      let linkedinCampaignCount = 0;
      
      // LinkedIn metrics from webhooks
      let linkedinMessagesSent = 0;
      let linkedinConnectionsSent = 0;
      let linkedinConnectionsAccepted = 0;
      let linkedinReplies = 0;

      // First pass: collect campaign stats
      campaigns?.forEach((campaign) => {
        const stats = campaign.stats as Record<string, number> | null;
        // synced_campaigns.channel was added in the 20260619130000 migration
        // and is missing from the auto-generated types.ts; assert here so
        // TS sees the field without a project-wide type regeneration.
        const channel =
          (campaign as { channel?: string | null }).channel ?? null;
        if (stats) {
          // Use sent/delivered from campaign stats (populated by V3 API)
          const sent = stats.sent || stats.delivered || 0;
          const replies = stats.replies || 0;

          // totalContacts is NOT accumulated here any more — see the live
          // count above. totalPeopleCount still is, deliberately: it is only
          // the denominator of completionPercentage, whose numerator
          // (peopleFinished) comes from this same stats blob. Swapping one
          // side for a live row count would mix two different sources and
          // silently distort that percentage.
          totalPeopleFinished += stats.peopleFinished || 0;
          totalPeopleCount += stats.peopleCount || 0;
          outOfOfficeCount += stats.outOfOffice || 0;

          // Email metrics — channel-gated (Bug 2 fix). Reply.io LinkedIn
          // rows write sent:messagesSent so the dashboard Sent column
          // shows real numbers (Step 3a); without this gate that value
          // would silently inflate emailDeliveries here. null/linkedin
          // channels contribute 0 to email metrics (no email outreach).
          // HeyReach (channel='linkedin') is unaffected — its rows wrote
          // no sent/opens/etc. at the top level anyway, so this gate
          // changes nothing for HR. Smartlead (channel='email') still
          // counts as before.
          if (channel === 'email' || channel === 'multichannel') {
            emailDeliveries += sent;
            emailReplies += replies;
            emailOpens += stats.opens || 0;
            emailBounced += stats.bounced || 0;
            emailClicked += stats.clicked || 0;
          }

          // (Bug 1 fix) LinkedIn metrics are NO LONGER summed per-campaign
          // here. Single source is outbound_integrations.stats_cache below
          // (Path B). Reply.io was the only platform writing BOTH per-row
          // linkedin* keys AND stats_cache linkedin* sums, producing a 2x
          // double-count in CYPR's tooltip. HR writes only stats_cache,
          // SL writes neither — reading from stats_cache alone keeps all
          // three platforms single-counted.

          // Identify LinkedIn-focused campaigns (have people but no email deliveries)
          if (sent === 0 && (stats.peopleCount || 0) > 0) {
            linkedinCampaignCount++;
          }
        }
        // Count campaigns that are still running. Membership in
        // ACTIVE_STATUSES (exported above) — same set the modal uses, so
        // count and drill-down can't drift.
        if (ACTIVE_STATUSES.includes(campaign.status?.toLowerCase() || '')) {
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
      
      // Merge in bulk stats cached on outbound_integrations. HeyReach's
      // sync-heyreach-campaigns writes one GetOverallStats result per
      // integration into stats_cache; those numbers are account-wide and
      // don't need summing across campaigns client-side.
      const { data: integrations, error: integrationsError } = await supabase
        .from('outbound_integrations')
        .select('stats_cache')
        .eq('is_active', true);

      if (integrationsError) {
        console.warn('[usePlaygroundStats] stats_cache fetch failed', integrationsError);
      }

      (integrations ?? []).forEach((int: any) => {
        const cache = int.stats_cache as Record<string, number> | null;
        if (!cache) return;
        linkedinMessagesSent += cache.linkedinMessagesSent ?? 0;
        linkedinReplies += cache.linkedinReplies ?? 0;
        linkedinConnectionsSent += cache.linkedinConnectionsSent ?? 0;
        linkedinConnectionsAccepted += cache.linkedinConnectionsAccepted ?? 0;
      });

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
        totalContacts: liveContactCount ?? 0,
        activeCampaigns,
        completionPercentage,
        outOfOfficeCount,
        campaignScore: null,
        emailDeliveries,
        emailReplies,
        emailOpens,
        emailBounced,
        emailClicked,
        linkedinCampaignCount,
        linkedinMessagesSent,
        linkedinConnectionsSent,
        linkedinConnectionsAccepted,
        linkedinReplies,
      };
    },
  });
}
