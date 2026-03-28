import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

const REPLY_API_BASE = "https://api.reply.io/v1";
const REPLY_API_V3_BASE = "https://api.reply.io/v3";

interface ReplyioCampaign {
  id: number;
  name: string;
  status: string | number;
  peopleCount?: number;
}

interface DiscoveredTeam {
  teamId: string;
  teamName?: string;
}

// Reply.io v1 Campaign Status Codes (verified from API docs):
// 0 = New/Draft, 2 = Active, 4 = Paused, 7 = Finished
function normalizeStatus(status: unknown): string {
  if (typeof status === 'string') {
    return status.toLowerCase();
  }
  if (typeof status === 'number') {
    const statusMap: Record<number, string> = {
      0: 'draft',
      2: 'active',
      4: 'paused',
      7: 'finished',
    };
    return statusMap[status] || 'unknown';
  }
  return 'unknown';
}

async function fetchFromReplyio(endpoint: string, apiKey: string, teamId?: string) {
  const headers: Record<string, string> = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
  };
  
  if (teamId) {
    headers["X-Reply-Team-Id"] = teamId;
  }
  
  const response = await fetch(`${REPLY_API_BASE}${endpoint}`, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function fetchFromReplyioV3(endpoint: string, apiKey: string) {
  const headers: Record<string, string> = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
  };
  
  const response = await fetch(`${REPLY_API_V3_BASE}${endpoint}`, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io V3 API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// Discover all team IDs from V3 /sequences endpoint
async function discoverAllTeams(apiKey: string): Promise<DiscoveredTeam[]> {
  const teamsMap = new Map<string, DiscoveredTeam>();
  let page = 1;
  const pageSize = 100;
  let hasMore = true;
  
  console.log("Discovering all teams from V3 /sequences...");
  
  while (hasMore) {
    try {
      const url = `/sequences?limit=${pageSize}&page=${page}`;
      const response = await fetchFromReplyioV3(url, apiKey) as Record<string, unknown>;
      const sequences = (response.items || []) as Array<Record<string, unknown>>;
      
      console.log(`V3 /sequences page ${page}: got ${sequences.length} items`);
      
      if (!Array.isArray(sequences) || sequences.length === 0) {
        console.log("No more sequences found, stopping discovery");
        break;
      }
      
      for (const seq of sequences) {
        const teamId = seq.teamId?.toString() || seq.ownerId?.toString();
        if (teamId && !teamsMap.has(teamId)) {
          teamsMap.set(teamId, {
            teamId,
            teamName: (seq.teamName as string) || `Team ${teamId}`,
          });
          console.log(`Discovered team: ${teamId}`);
        }
      }
      
      const info = response.info as { hasMore?: boolean } | undefined;
      hasMore = info?.hasMore ?? (sequences.length === pageSize);
      page++;
      
      if (page > 20) {
        console.warn("Reached page limit (20) during team discovery");
        break;
      }
      
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (err) {
      console.error(`Error discovering teams at page ${page}:`, err);
      break;
    }
  }
  
  const teams = Array.from(teamsMap.values());
  console.log(`Discovered ${teams.length} unique teams:`, teams.map(t => t.teamId).join(', '));
  return teams;
}

// Fetch campaigns for a single team
async function fetchCampaignsForTeam(
  apiKey: string, 
  teamId: string,
  pageSize: number = 100
): Promise<{ campaigns: ReplyioCampaign[], teamId: string }> {
  let allCampaigns: ReplyioCampaign[] = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    try {
      const url = `/campaigns?limit=${pageSize}&page=${page}`;
      const response = await fetchFromReplyio(url, apiKey, teamId) as Record<string, unknown>;
      const campaigns = (response.campaigns || response || []) as ReplyioCampaign[];
      
      if (!Array.isArray(campaigns)) {
        console.warn(`Expected array for campaigns (team ${teamId}), got:`, typeof campaigns);
        break;
      }
      
      allCampaigns = [...allCampaigns, ...campaigns];
      
      const info = response.info as { hasMore?: boolean } | undefined;
      hasMore = info?.hasMore || (response.hasMore as boolean) || (campaigns.length === pageSize);
      
      page++;
      
      if (page > 50) {
        console.warn(`Reached page limit (50) for team ${teamId}`);
        break;
      }
      
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (err) {
      console.error(`Error fetching campaigns for team ${teamId} at page ${page}:`, err);
      break;
    }
  }
  
  return { campaigns: allCampaigns, teamId };
}

// Fetch all campaigns across all discovered teams (for agency accounts)
async function fetchAllTeamsCampaigns(apiKey: string): Promise<{ 
  campaigns: (ReplyioCampaign & { teamId: string })[], 
  teamsCount: number 
}> {
  const teams = await discoverAllTeams(apiKey);
  
  if (teams.length === 0) {
    console.warn("No teams discovered, falling back to default fetch");
    const result = await fetchCampaignsForTeam(apiKey, "");
    return { 
      campaigns: result.campaigns.map(c => ({ ...c, teamId: "default" })),
      teamsCount: 1 
    };
  }
  
  const allCampaigns: (ReplyioCampaign & { teamId: string })[] = [];
  
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    console.log(`Fetching campaigns for team ${team.teamId} (${i + 1}/${teams.length})...`);
    
    try {
      const result = await fetchCampaignsForTeam(apiKey, team.teamId);
      const campaignsWithTeam = result.campaigns.map(c => ({ 
        ...c, 
        teamId: team.teamId 
      }));
      allCampaigns.push(...campaignsWithTeam);
      console.log(`Got ${result.campaigns.length} campaigns from team ${team.teamId}`);
    } catch (err) {
      console.error(`Failed to fetch campaigns for team ${team.teamId}:`, err);
    }
    
    if (i < teams.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  console.log(`Total: ${allCampaigns.length} campaigns from ${teams.length} teams`);
  return { campaigns: allCampaigns, teamsCount: teams.length };
}

// Paginated fetch for campaigns from a single team
async function fetchAllCampaigns(
  apiKey: string, 
  teamId?: string,
  pageSize: number = 100
): Promise<ReplyioCampaign[]> {
  let allCampaigns: ReplyioCampaign[] = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    const url = `/campaigns?limit=${pageSize}&page=${page}`;
    const response = await fetchFromReplyio(url, apiKey, teamId) as Record<string, unknown>;
    const campaigns = (response.campaigns || response || []) as ReplyioCampaign[];
    
    if (!Array.isArray(campaigns)) {
      console.warn(`Expected array for campaigns, got:`, typeof campaigns);
      break;
    }
    
    allCampaigns = [...allCampaigns, ...campaigns];
    
    const info = response.info as { hasMore?: boolean } | undefined;
    hasMore = info?.hasMore || (response.hasMore as boolean) || (campaigns.length === pageSize);
    
    console.log(`Page ${page}: fetched ${campaigns.length} campaigns, total: ${allCampaigns.length}`);
    
    page++;
    
    if (page > 100) {
      console.warn(`Reached page limit (100)`);
      break;
    }
    
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  return allCampaigns;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { integrationId, skipTeamFilter, autoLinkOnFirstSync } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    
    if (!integrationId) {
      throw new Error("Missing integrationId");
    }

    // Fetch the integration including links_initialized flag
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, platform, reply_team_id, links_initialized")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    if (integration.platform !== "reply.io") {
      throw new Error("This function only supports Reply.io integrations");
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id;
    const linksInitialized = integration.links_initialized ?? false;

    // Determine if we should auto-link campaigns
    // Only auto-link if:
    // 1. autoLinkOnFirstSync flag is true (from sync flow)
    // 2. links_initialized is false (first time setup)
    const shouldAutoLink = autoLinkOnFirstSync === true && !linksInitialized;
    
    console.log(`Auto-link decision: autoLinkOnFirstSync=${autoLinkOnFirstSync}, linksInitialized=${linksInitialized}, shouldAutoLink=${shouldAutoLink}`);

    let campaigns: (ReplyioCampaign & { teamId?: string })[];
    let teamsCount = 1;
    let teamFiltered: boolean;
    let effectiveTeamId: string | null;

    if (skipTeamFilter) {
      console.log(`Fetching campaigns from ALL teams for integration ${integrationId}`);
      const result = await fetchAllTeamsCampaigns(apiKey);
      campaigns = result.campaigns;
      teamsCount = result.teamsCount;
      teamFiltered = false;
      effectiveTeamId = null;
    } else {
      effectiveTeamId = replyTeamId || null;
      console.log(`Fetching campaigns for integration ${integrationId}${effectiveTeamId ? ` (team: ${effectiveTeamId})` : ' (default team)'}`);
      const singleTeamCampaigns = await fetchAllCampaigns(apiKey, effectiveTeamId ?? undefined);
      campaigns = singleTeamCampaigns.map(c => ({ ...c, teamId: effectiveTeamId ?? "default" }));
      teamFiltered = true;
    }
    
    console.log(`Found ${campaigns.length} campaigns from Reply.io (${teamsCount} teams)`);

    // Get existing campaigns from database (scoped to this integration)
    const { data: existingCampaigns } = await supabase
      .from("synced_campaigns")
      .select("external_campaign_id, is_linked, stats")
      .eq("integration_id", integrationId);

    const existingMap = new Map<string, { is_linked: boolean; stats: Record<string, unknown> | null }>();
    (existingCampaigns || []).forEach(c => {
      existingMap.set(c.external_campaign_id, { 
        is_linked: c.is_linked, 
        stats: c.stats as Record<string, unknown> | null 
      });
    });

    // Determine is_linked for each campaign
    const campaignsToUpsert = campaigns.map(campaign => {
      const existing = existingMap.get(String(campaign.id));
      
      // Merge stats to preserve any existing stats while updating peopleCount
      const existingStats = existing?.stats || {};
      const mergedStats = {
        ...existingStats,
        peopleCount: campaign.peopleCount || 0,
        replyTeamId: campaign.teamId || null,
      };
      
      // Determine is_linked:
      // - If campaign exists in DB, preserve its is_linked value
      // - If new campaign AND shouldAutoLink is true, set to true
      // - Otherwise default to false
      let isLinked: boolean;
      if (existing !== undefined) {
        isLinked = existing.is_linked;
      } else if (shouldAutoLink) {
        isLinked = true;
        console.log(`Auto-linking new campaign: ${campaign.name} (${campaign.id})`);
      } else {
        isLinked = false;
      }
      
      return {
        integration_id: integrationId,
        team_id: teamId,
        external_campaign_id: String(campaign.id),
        name: String(campaign.name || 'Unnamed Campaign'),
        status: normalizeStatus(campaign.status),
        stats: mergedStats,
        is_linked: isLinked,
        updated_at: new Date().toISOString(),
      };
    });

    if (campaignsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from("synced_campaigns")
        .upsert(campaignsToUpsert, {
          onConflict: "integration_id,external_campaign_id",
        });

      if (upsertError) {
        console.error("Failed to upsert campaigns:", upsertError);
        throw new Error(`Failed to save campaigns: ${upsertError.message}`);
      }
      
      console.log(`Upserted ${campaignsToUpsert.length} campaigns`);
    }

    // If we auto-linked, mark the integration as initialized
    if (shouldAutoLink && campaignsToUpsert.length > 0) {
      const { error: updateError } = await supabase
        .from("outbound_integrations")
        .update({ links_initialized: true })
        .eq("id", integrationId);
      
      if (updateError) {
        console.warn("Failed to set links_initialized:", updateError);
      } else {
        console.log("Set links_initialized = true for integration");
      }
    }

    // Return campaigns with updated linked status
    const result = campaigns.map(campaign => {
      const existing = existingMap.get(String(campaign.id));
      let isLinked: boolean;
      if (existing !== undefined) {
        isLinked = existing.is_linked;
      } else if (shouldAutoLink) {
        isLinked = true;
      } else {
        isLinked = false;
      }
      
      return {
        id: String(campaign.id),
        name: campaign.name,
        status: normalizeStatus(campaign.status),
        peopleCount: campaign.peopleCount || 0,
        isLinked,
        replyTeamId: campaign.teamId || null,
      };
    });

    const responsePayload: Record<string, unknown> = {
      success: true,
      campaigns: result,
      total: result.length,
      teamsCount,
      teamFiltered,
      teamId: effectiveTeamId || null,
      autoLinked: shouldAutoLink,
      linkedCount: result.filter(c => c.isLinked).length,
    };

    if (!teamFiltered) {
      const discoveredTeamIds = [...new Set(campaigns.map(c => c.teamId).filter(Boolean))];
      responsePayload.discoveredTeamIds = discoveredTeamIds.slice(0, 50);
      responsePayload.discoveredTeamsCount = discoveredTeamIds.length;
    }

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Fetch campaigns error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
