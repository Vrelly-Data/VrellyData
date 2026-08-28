import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Smartlead / HeyReach campaign names, keyed by the external campaign id that
// agent_leads carries.
//
// WHY THIS EXISTS. The inbox card renders `lead.last_campaign_name`, a TEXT
// column that only some write paths populate:
//
//   * reply-webhook resolves the name from synced_campaigns at capture and
//     stores it — so Reply.io leads have it.
//   * smartlead-webhook copies it straight off the vendor payload's
//     `campaign_name`, which is absent on some event shapes, and neither
//     poll-smartlead-inbox nor the one-shot reply backfills write it at all.
//   * heyreach-webhook and poll-heyreach-inbox never write it. The only
//     HeyReach path that does is add-to-heyreach-campaign, i.e. AFTER an
//     operator pushes the lead into a sequence — not at capture.
//
// What those leads DO carry is the campaign id: agent_leads.smartlead_campaign_id
// (Smartlead) and agent_leads.campaign_external_id (HeyReach). Both are TEXT and
// both match synced_campaigns.external_campaign_id, which holds the name. So the
// name is resolved here at read time instead of requiring a backfill and three
// edge-function changes.
//
// Same shape as useHeyReachAccountNames: an id -> display-name Map, gated by
// `enabled` so tenants with no Smartlead/HeyReach lead in view make no request,
// and display-only, so a failure renders nothing rather than an error state.
//
// SCOPING — WHY THE TWO MAPS ARE KEPT SEPARATE. agent_leads.campaign_external_id
// is NOT HeyReach-exclusive: backfill_agent_leads_campaign_attribution.sql
// populated it for every channel='linkedin' lead by joining webhook_events, and
// Reply.io emits linkedin_message_replied events too. Reply.io and HeyReach
// campaign ids are both bare integers, so a merged map could resolve a Reply.io
// lead's id against a HeyReach campaign and print the wrong campaign name. The
// caller therefore picks the map by the lead's `source`, and the maps are built
// from integrations filtered by platform so neither can contain the other's
// campaigns.

export interface CampaignNameMaps {
  /** external_campaign_id -> name, for platform='smartlead' integrations only. */
  smartlead: Map<string, string>;
  /** external_campaign_id -> name, for platform='heyreach' integrations only. */
  heyreach: Map<string, string>;
}

const EMPTY: CampaignNameMaps = { smartlead: new Map(), heyreach: new Map() };

interface Row {
  name: string | null;
  external_campaign_id: string | null;
  integration_id: string | null;
}

/**
 * @param enabled Gate the network call — pass false when no visible lead
 *   carries a Smartlead or HeyReach campaign id, so Reply.io-only tenants
 *   never make the request.
 */
export function useCampaignNames(enabled: boolean): CampaignNameMaps {
  const query = useQuery({
    // Distinct from ['smartlead-campaigns'] / ['heyreach-campaigns'], which
    // hold the Add-to-Campaign dropdown's rows (a different column set and,
    // for the dropdown, a different freshness expectation).
    queryKey: ['campaign-names-by-external-id'],
    queryFn: async (): Promise<CampaignNameMaps> => {
      // RLS scopes both selects to the caller's own tenant, exactly as
      // useSmartleadCampaigns / useHeyReachCampaigns already rely on.
      const { data: integrations, error: intError } = await supabase
        .from('outbound_integrations')
        .select('id, platform')
        .in('platform', ['smartlead', 'heyreach']);

      if (intError) throw intError;
      if (!integrations?.length) return { smartlead: new Map(), heyreach: new Map() };

      const platformById = new Map<string, string>();
      for (const i of integrations) platformById.set(i.id, i.platform);

      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('name, external_campaign_id, integration_id')
        .in('integration_id', Array.from(platformById.keys()));

      if (error) throw error;

      const maps: CampaignNameMaps = { smartlead: new Map(), heyreach: new Map() };
      for (const r of (data ?? []) as Row[]) {
        const name = r.name?.trim();
        if (!name || !r.external_campaign_id || !r.integration_id) continue;
        const platform = platformById.get(r.integration_id);
        const target =
          platform === 'smartlead' ? maps.smartlead
          : platform === 'heyreach' ? maps.heyreach
          : null;
        // First write wins. Two integrations on the same platform can share an
        // external id (sync-smartlead-campaigns' own comment notes this); the
        // name is the same either way, so there is nothing to disambiguate.
        if (target && !target.has(String(r.external_campaign_id))) {
          target.set(String(r.external_campaign_id), name);
        }
      }
      return maps;
    },
    enabled,
    staleTime: 5 * 60_000, // campaign names change rarely
    // Display-only enrichment: a failure must never surface as an error state,
    // it just means the campaign line stays as it is today.
    retry: 1,
  });

  return query.data ?? EMPTY;
}

/**
 * The campaign name to show for a lead: the stored value when a write path
 * recorded one, otherwise resolved from the lead's campaign id.
 *
 * Stored value ALWAYS wins, so no lead that shows a campaign name today can
 * change what it shows — this can only fill a line that is currently blank.
 */
export function resolveCampaignName(
  lead: {
    last_campaign_name?: string | null;
    smartlead_campaign_id?: string | null;
    campaign_external_id?: string | null;
    source?: string | null;
    heyreach_account_id?: number | null;
  },
  names: CampaignNameMaps,
): string | null {
  const stored = lead.last_campaign_name?.trim();
  if (stored) return stored;

  // smartlead_campaign_id is written by the Smartlead paths only — no other
  // platform populates that column, so it needs no source gate.
  if (lead.smartlead_campaign_id) {
    const n = names.smartlead.get(String(lead.smartlead_campaign_id));
    if (n) return n;
  }

  // campaign_external_id IS shared with Reply.io LinkedIn leads (see the
  // scoping note above), so only consult the HeyReach map for a lead that is
  // positively HeyReach. `source` is the primary discriminator;
  // heyreach_account_id covers any row the source backfill missed.
  const isHeyReach = lead.source === 'heyreach' || lead.heyreach_account_id != null;
  if (isHeyReach && lead.campaign_external_id) {
    const n = names.heyreach.get(String(lead.campaign_external_id));
    if (n) return n;
  }

  return null;
}
