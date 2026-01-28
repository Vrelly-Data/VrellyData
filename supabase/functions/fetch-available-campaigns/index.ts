import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v1";

interface ReplyioCampaign {
  id: number;
  name: string;
  status: string | number;
  peopleCount?: number;
}

// Reply.io returns status as integers: 0=draft, 1=active, 2=paused, 3=completed, 4=archived
function normalizeStatus(status: unknown): string {
  if (typeof status === 'string') {
    return status.toLowerCase();
  }
  if (typeof status === 'number') {
    const statusMap: Record<number, string> = {
      0: 'draft',
      1: 'active',
      2: 'paused',
      3: 'completed',
      4: 'archived',
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

// Paginated fetch for campaigns only - lightweight
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
    
    // Small delay between pages
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  return allCampaigns;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { integrationId } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    
    if (!integrationId) {
      throw new Error("Missing integrationId");
    }

    // Fetch the integration
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, platform, reply_team_id")
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

    console.log(`Fetching campaigns for integration ${integrationId}${replyTeamId ? ` (team: ${replyTeamId})` : ''}`);

    // Fetch ALL campaigns from Reply.io (lightweight - just names/IDs/status)
    const campaigns = await fetchAllCampaigns(apiKey, replyTeamId || undefined);
    
    console.log(`Found ${campaigns.length} campaigns from Reply.io`);

    // Get existing linked status from database
    const { data: existingCampaigns } = await supabase
      .from("synced_campaigns")
      .select("external_campaign_id, is_linked")
      .eq("team_id", teamId);

    const linkedMap = new Map<string, boolean>();
    (existingCampaigns || []).forEach(c => {
      linkedMap.set(c.external_campaign_id, c.is_linked);
    });

    // Store campaigns in database (with is_linked = false for new ones)
    const campaignsToUpsert = campaigns.map(campaign => ({
      integration_id: integrationId,
      team_id: teamId,
      external_campaign_id: String(campaign.id),
      name: String(campaign.name || 'Unnamed Campaign'),
      status: normalizeStatus(campaign.status),
      stats: { peopleCount: campaign.peopleCount || 0 },
      is_linked: linkedMap.get(String(campaign.id)) ?? false,
      updated_at: new Date().toISOString(),
    }));

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
    }

    // Return campaigns with linked status for UI
    const result = campaigns.map(campaign => ({
      id: String(campaign.id),
      name: campaign.name,
      status: normalizeStatus(campaign.status),
      peopleCount: campaign.peopleCount || 0,
      isLinked: linkedMap.get(String(campaign.id)) ?? false,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        campaigns: result,
        total: result.length,
      }),
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
