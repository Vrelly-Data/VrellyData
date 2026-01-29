import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v1";

// LinkedIn fields - preserved from CSV uploads, never overwritten by sync
const LINKEDIN_FIELDS = [
  'linkedinMessagesSent',
  'linkedinConnectionsSent',
  'linkedinReplies',
  'linkedinConnectionsAccepted',
  'linkedinDataSource',
  'linkedinDataUploadedAt',
];

interface ReplyioCampaign {
  id: number;
  name: string;
  status: string | number;
  // Stats fields from Reply.io API
  deliveriesCount?: number;
  repliesCount?: number;
  opensCount?: number;
  bouncesCount?: number;
  optOutsCount?: number;
  outOfOfficeCount?: number;
  peopleCount?: number;
  peopleActive?: number;
  peopleFinished?: number;
  // Legacy nested stats (may exist in some responses)
  stats?: {
    sent?: number;
    delivered?: number;
    opened?: number;
    clicked?: number;
    replied?: number;
    bounced?: number;
  };
}

// Reply.io returns status as integers: 0=draft, 1=active, 2=paused, 3=completed, 4=archived, 5=stopped, 6=error, 7=finished
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
      5: 'stopped',
      6: 'error',
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
  
  // Add team context for agency accounts
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

// Retry wrapper with exponential backoff for rate limiting
async function fetchWithRetry(
  endpoint: string, 
  apiKey: string, 
  teamId?: string, 
  maxRetries: number = 3
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFromReplyio(endpoint, apiKey, teamId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a rate limit error
      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt; // 5s, 10s, 15s (reduced from 10/20/30)
        console.log(`Rate limited on ${endpoint}, waiting ${waitTime/1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Paginated fetch helper - optimized for fast sync (no delays between pages)
async function fetchAllPaginated<T>(
  endpoint: string, 
  apiKey: string, 
  resultKey: string,
  teamId?: string,
  pageSize: number = 100
): Promise<T[]> {
  let allResults: T[] = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${separator}limit=${pageSize}&page=${page}`;
    
    const response = await fetchWithRetry(url, apiKey, teamId) as Record<string, unknown>;
    const results = (response[resultKey] || response || []) as T[];
    
    if (!Array.isArray(results)) {
      console.warn(`Expected array for ${resultKey}, got:`, typeof results);
      break;
    }
    
    allResults = [...allResults, ...results];
    
    // Check for more pages
    const info = response.info as { hasMore?: boolean } | undefined;
    hasMore = info?.hasMore || 
              (response.hasMore as boolean) || 
              (results.length === pageSize);
    
    console.log(`  Page ${page}: fetched ${results.length} ${resultKey}, total: ${allResults.length}`);
    
    page++;
    
    // Safety limit
    if (page > 100) {
      console.warn(`Reached page limit (100) for ${endpoint}`);
      break;
    }
    
    // Minimal delay between pages (500ms) for rate limit protection
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return allResults;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let integrationId: string | undefined;
  let authHeader: string | null = null;
  let campaignsProcessed = 0;
  let campaignsFailed = 0;
  
  try {
    authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    integrationId = body.integrationId;

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

    // Update status to syncing
    await supabase
      .from("outbound_integrations")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("id", integrationId);

    console.log(`Starting FAST sync for integration ${integrationId}${replyTeamId ? ` (team: ${replyTeamId})` : ''}`);

    // Fetch ALL campaigns from Reply.io
    let campaigns: ReplyioCampaign[] = [];
    try {
      campaigns = await fetchAllPaginated<ReplyioCampaign>(
        "/campaigns",
        apiKey,
        "campaigns",
        replyTeamId || undefined
      );
      console.log(`Fetched ${campaigns.length} campaigns from Reply.io`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch campaigns:", err);
      throw new Error(`Failed to fetch campaigns: ${errorMessage}`);
    }

    // FAST SYNC: Only process campaign metadata and stats
    // No steps, no contacts, no delays between campaigns
    for (const campaign of campaigns) {
      try {
        if (!campaign.id || !campaign.name) {
          console.warn(`Skipping campaign with missing id or name`);
          campaignsFailed++;
          continue;
        }
        
        console.log(`Processing campaign: ${campaign.name} (ID: ${campaign.id})`);

        // Fetch existing campaign to preserve LinkedIn stats
        const { data: existingCampaign } = await supabase
          .from("synced_campaigns")
          .select("stats")
          .eq("integration_id", integrationId)
          .eq("external_campaign_id", String(campaign.id))
          .maybeSingle();

        const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

        // Preserve LinkedIn fields from existing stats
        const linkedinStats: Record<string, unknown> = {};
        for (const field of LINKEDIN_FIELDS) {
          if (existingStats[field] !== undefined) {
            linkedinStats[field] = existingStats[field];
          }
        }

        // Build merged stats object: email stats from API + preserved LinkedIn stats
        const mergedStats = {
          // Email stats from Reply.io API
          sent: campaign.deliveriesCount || 0,
          delivered: campaign.deliveriesCount || 0,
          replies: campaign.repliesCount || 0,
          opens: campaign.opensCount || 0,
          bounces: campaign.bouncesCount || 0,
          optOuts: campaign.optOutsCount || 0,
          peopleCount: campaign.peopleCount || 0,
          peopleActive: campaign.peopleActive || 0,
          peopleFinished: campaign.peopleFinished || 0,
          outOfOffice: campaign.outOfOfficeCount || 0,
          // Preserve LinkedIn stats from CSV upload
          ...linkedinStats,
        };

        // Upsert campaign with merged stats
        const { error: campaignError } = await supabase
          .from("synced_campaigns")
          .upsert({
            integration_id: integrationId,
            team_id: teamId,
            external_campaign_id: String(campaign.id),
            name: String(campaign.name || 'Unnamed Campaign'),
            status: normalizeStatus(campaign.status),
            stats: mergedStats,
            raw_data: campaign,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "integration_id,external_campaign_id",
          });

        if (campaignError) {
          console.error(`Failed to upsert campaign ${campaign.id}:`, campaignError);
          campaignsFailed++;
          continue;
        }

        campaignsProcessed++;
        
      } catch (campaignError) {
        console.error(`Error processing campaign ${campaign.id}:`, campaignError);
        campaignsFailed++;
      }
    }

    // Update integration status
    const finalStatus = campaignsFailed > 0 && campaignsProcessed === 0 ? "error" : "synced";
    const syncError = campaignsFailed > 0 
      ? `Synced ${campaignsProcessed}/${campaigns.length} campaigns (${campaignsFailed} failed)` 
      : null;

    await supabase
      .from("outbound_integrations")
      .update({
        sync_status: finalStatus,
        sync_error: syncError,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    console.log(`Fast sync complete: ${campaignsProcessed}/${campaigns.length} campaigns processed`);

    return new Response(
      JSON.stringify({
        success: true,
        campaigns: campaignsProcessed,
        campaignsFailed,
        mode: "fast",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Sync error:", err);

    // Update integration status to error
    if (integrationId && authHeader) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          { global: { headers: { Authorization: authHeader } } }
        );

        await supabase
          .from("outbound_integrations")
          .update({
            sync_status: "error",
            sync_error: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integrationId);
      } catch (updateError) {
        console.error("Failed to update error status:", updateError);
      }
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
