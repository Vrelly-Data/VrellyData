import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// V3 API for sequences (includes teamId for workspace filtering)
const REPLY_API_V3 = "https://api.reply.io/v3";
// V1 API for campaigns list (includes inline stats per campaign)
const REPLY_API_V1 = "https://api.reply.io/v1";

// LinkedIn fields - preserved from CSV uploads, never overwritten by sync
const LINKEDIN_FIELDS = [
  'linkedinMessagesSent',
  'linkedinConnectionsSent',
  'linkedinReplies',
  'linkedinConnectionsAccepted',
  'linkedinDataSource',
  'linkedinDataUploadedAt',
];

// Email CSV upload fields - preserved from CSV uploads, never overwritten by sync
const EMAIL_UPLOAD_FIELDS = [
  'emailDataSource',
  'emailDataUploadedAt',
  'opens',
  'clicked',
  'bounced',
  'outOfOffice',
  'optedOut',
  'interested',
  'notInterested',
  'autoReplied',
];

// V3 Sequence structure (replaces V1 Campaign)
interface ReplyioSequence {
  id: number;
  name: string;
  status: string;        // "Active", "Paused", "Finished", "Archived"
  teamId: number;        // Workspace ID - this is what we need for filtering!
  ownerId?: number;
  created?: string;
  isArchived?: boolean;
}

// V3 status is already a string, just lowercase it
function normalizeStatus(status: unknown): string {
  if (typeof status === 'string') {
    return status.toLowerCase();
  }
  return 'unknown';
}

async function fetchFromReplyioV3(endpoint: string, apiKey: string, teamId?: string) {
  const headers: Record<string, string> = {
    // Reply requires strict header casing
    "X-API-Key": apiKey,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  if (teamId) {
    headers["X-Reply-Team-Id"] = teamId;
  }

  const response = await fetch(`${REPLY_API_V3}${endpoint}`, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io V3 API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function fetchFromReplyioV1(endpoint: string, apiKey: string, teamId?: string) {
  const headers: Record<string, string> = {
    // Reply requires strict header casing
    "X-API-Key": apiKey,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  if (teamId) {
    headers["X-Reply-Team-Id"] = teamId;
  }

  const response = await fetch(`${REPLY_API_V1}${endpoint}`, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io V1 API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// Retry wrapper with exponential backoff for rate limiting
async function fetchWithRetryV3(
  endpoint: string, 
  apiKey: string, 
  teamId?: string, 
  maxRetries: number = 3
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFromReplyioV3(endpoint, apiKey, teamId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(`Rate limited on ${endpoint}, waiting ${waitTime/1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

async function fetchWithRetryV1(
  endpoint: string, 
  apiKey: string, 
  teamId?: string, 
  maxRetries: number = 3
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFromReplyioV1(endpoint, apiKey, teamId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(`Rate limited on ${endpoint}, waiting ${waitTime/1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Extract stats from a V1 campaign list object (stats are inline in the list response)
function extractStatsFromV1Campaign(campaign: Record<string, unknown>): Record<string, number> {
  return {
    sent: (campaign.deliveriesCount as number) || 0,
    delivered: (campaign.deliveriesCount as number) || 0,
    opens: (campaign.opensCount as number) || 0,
    replies: (campaign.repliesCount as number) || 0,
    bounces: (campaign.bouncesCount as number) || 0,
    optedOut: (campaign.optOutsCount as number) || 0,
    outOfOffice: (campaign.outOfOfficeCount as number) || 0,
    peopleCount: (campaign.peopleCount as number) || 0,
    peopleFinished: (campaign.peopleFinished as number) || 0,
    peopleActive: (campaign.peopleActive as number) || 0,
    peoplePaused: (campaign.peoplePaused as number) || 0,
  };
}

// Fetch all campaigns from V1 list endpoint (paginated), returns a map keyed by campaign ID
async function fetchAllCampaignsV1(
  apiKey: string,
  teamId?: string,
  pageSize: number = 100
): Promise<Map<number, Record<string, unknown>>> {
  const campaignMap = new Map<number, Record<string, unknown>>();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await fetchWithRetryV1(`/campaigns?limit=${pageSize}&page=${page}`, apiKey, teamId);
    const campaigns = (Array.isArray(data) ? data : []) as Record<string, unknown>[];

    for (const c of campaigns) {
      const id = c.id as number;
      if (id) campaignMap.set(id, c);
    }

    console.log(`  V1 campaigns page ${page}: fetched ${campaigns.length}, total: ${campaignMap.size}`);

    hasMore = campaigns.length === pageSize;
    page++;

    if (page > 100) {
      console.warn(`Reached page limit (100) for V1 campaigns`);
      break;
    }

    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return campaignMap;
}

// Paginated fetch helper for V3 API
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
    
    const response = await fetchWithRetryV3(url, apiKey, teamId) as Record<string, unknown>;
    const results = (response[resultKey] || response || []) as T[];
    
    if (!Array.isArray(results)) {
      console.warn(`Expected array for ${resultKey}, got:`, typeof results);
      break;
    }
    
    allResults = [...allResults, ...results];
    
    const info = response.info as { hasMore?: boolean } | undefined;
    hasMore = info?.hasMore || 
              (response.hasMore as boolean) || 
              (results.length === pageSize);
    
    console.log(`  Page ${page}: fetched ${results.length} ${resultKey}, total: ${allResults.length}`);
    
    page++;
    
    if (page > 100) {
      console.warn(`Reached page limit (100) for ${endpoint}`);
      break;
    }
    
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return allResults;
}

// NOTE: Contact sync was intentionally removed from this function.
// Rationale: syncing contacts for many campaigns can exceed request time limits,
// causing the client to see "Failed to fetch" even though the backend keeps working.
//
// Contacts are synced per-campaign via the separate `sync-reply-contacts` function.
// That function also updates per-campaign stats like peopleCount + replies.


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let integrationId: string | undefined;
  let authHeader: string | null = null;
  let campaignsProcessed = 0;
  let campaignsFailed = 0;
  let totalContactsSynced = 0;
  
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

    await supabase
      .from("outbound_integrations")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("id", integrationId);

    console.log(`Starting sync for integration ${integrationId}${replyTeamId ? ` (workspace: ${replyTeamId})` : ''}`);

    // Fetch sequences from V3 API (includes teamId for filtering)
    let sequences: ReplyioSequence[] = [];
    try {
      sequences = await fetchAllPaginated<ReplyioSequence>(
        "/sequences",
        apiKey,
        "items",
        replyTeamId || undefined
      );
      console.log(`Fetched ${sequences.length} total sequences from Reply.io V3`);
      
      // Filter by workspace teamId
      if (replyTeamId) {
        const teamIdNum = parseInt(replyTeamId, 10);
        const originalCount = sequences.length;
        
        sequences = sequences.filter(seq => {
          if (seq.teamId === undefined) {
            console.log(`Sequence ${seq.id} (${seq.name}) has no teamId, excluding`);
            return false;
          }
          return seq.teamId === teamIdNum;
        });
        
        console.log(`After workspace filter: ${sequences.length}/${originalCount} sequences belong to workspace ${replyTeamId}`);
      }
      
      // Filter out archived sequences
      sequences = sequences.filter(seq => !seq.isArchived);
      console.log(`After archive filter: ${sequences.length} active sequences`);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch sequences:", err);
      throw new Error(`Failed to fetch sequences: ${errorMessage}`);
    }

    // Fetch all campaigns from V1 list endpoint (stats are inline)
    console.log(`Fetching V1 campaigns list for inline stats...`);
    let v1CampaignMap = new Map<number, Record<string, unknown>>();
    try {
      v1CampaignMap = await fetchAllCampaignsV1(apiKey, replyTeamId || undefined);
      console.log(`Fetched ${v1CampaignMap.size} campaigns from V1 list endpoint`);
    } catch (err) {
      console.warn(`Could not fetch V1 campaigns list, stats will be empty:`, err);
    }

    // Process each sequence - map inline stats and sync
    const syncedCampaignIds: { internal: string; external: string }[] = [];

    for (const sequence of sequences) {
      try {
        if (!sequence.id || !sequence.name) {
          console.warn(`Skipping sequence with missing id or name`);
          campaignsFailed++;
          continue;
        }
        
        console.log(`Processing sequence: ${sequence.name} (ID: ${sequence.id})`);

        // DEDUPLICATION FIX: Check for ANY existing campaign with this external_id for this team
        // (not scoped to integration_id to catch orphaned duplicates from previous syncs)
        const { data: existingCampaigns } = await supabase
          .from("synced_campaigns")
          .select("id, stats, is_linked, integration_id")
          .eq("team_id", teamId)
          .eq("external_campaign_id", String(sequence.id))
          .order("created_at", { ascending: true });

        // Use the FIRST existing campaign (oldest) to prevent duplicates
        const existingCampaign = existingCampaigns && existingCampaigns.length > 0 
          ? existingCampaigns[0] 
          : null;
        
        // Log if we found duplicates (for debugging)
        if (existingCampaigns && existingCampaigns.length > 1) {
          console.log(`Found ${existingCampaigns.length} duplicate campaigns for ${sequence.id}, using oldest: ${existingCampaign?.id}`);
        }

        const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};
        
        // Preserve is_linked: if campaign exists, keep user's choice; if new, default to true
        const isLinked = existingCampaign ? existingCampaign.is_linked : true;

        // Preserve LinkedIn fields from existing stats
        const linkedinStats: Record<string, unknown> = {};
        for (const field of LINKEDIN_FIELDS) {
          if (existingStats[field] !== undefined) {
            linkedinStats[field] = existingStats[field];
          }
        }

        // Preserve email CSV upload fields from existing stats
        const emailUploadStats: Record<string, unknown> = {};
        const hasEmailUpload = existingStats.emailDataSource === 'csv_upload';
        for (const field of EMAIL_UPLOAD_FIELDS) {
          if (existingStats[field] !== undefined) {
            emailUploadStats[field] = existingStats[field];
          }
        }

        // Extract stats from V1 campaigns list (already fetched in bulk)
        const v1Campaign = v1CampaignMap.get(sequence.id);
        const apiStats = v1Campaign
          ? extractStatsFromV1Campaign(v1Campaign)
          : { sent: 0, delivered: 0, opens: 0, replies: 0, bounces: 0, optedOut: 0, outOfOffice: 0, peopleCount: 0, peopleFinished: 0, peopleActive: 0, peoplePaused: 0 };

        if (!v1Campaign) {
          console.warn(`  No V1 campaign data found for sequence ${sequence.id}, stats will be zero`);
        }
        console.log(`  Stats: sent=${apiStats.sent}, replies=${apiStats.replies}, opens=${apiStats.opens}`);

        // Extract existing values for fallback logic
        const existingPeopleCount = existingStats.peopleCount as number | undefined;
        const existingSent = existingStats.sent as number | undefined;
        const existingDelivered = existingStats.delivered as number | undefined;
        const existingReplies = existingStats.replies as number | undefined;

        // For sent/delivered/replies: if we have email upload data and the API returns 0,
        // prefer the uploaded values (the API often can't retrieve these stats)
        let finalSent = apiStats.sent || existingSent || 0;
        let finalDelivered = apiStats.delivered || existingDelivered || 0;
        let finalReplies = apiStats.replies || existingReplies || 0;

        if (hasEmailUpload) {
          // If API returns 0 but we have existing uploaded values, keep the uploaded values
          if (!apiStats.sent && existingSent) finalSent = existingSent;
          if (!apiStats.delivered && existingDelivered) finalDelivered = existingDelivered;
          if (!apiStats.replies && existingReplies) finalReplies = existingReplies;
          console.log(`  Email upload detected - preserving uploaded stats: sent=${finalSent}, delivered=${finalDelivered}, replies=${finalReplies}`);
        }

        // Merge: preserve existing stats, overlay API data, preserve LinkedIn + email upload stats
        const mergedStats = {
          ...existingStats,      // Preserve ALL existing stats
          ...apiStats,           // Overlay with fresh API data (if available)
          ...linkedinStats,      // Preserve LinkedIn fields from CSV uploads
          ...emailUploadStats,   // Preserve email upload fields from CSV uploads
          sent: finalSent,
          delivered: finalDelivered,
          replies: finalReplies,
          // Keep peopleCount separate - it represents contacts enrolled, not emails sent
          peopleCount: apiStats.peopleCount || existingPeopleCount || 0,
          // Preserve replyTeamId from V3 sequence data
          replyTeamId: sequence.teamId || (existingStats.replyTeamId as number) || undefined,
        };

        // Update existing campaign or insert new one
        // Use the existing campaign's ID if it exists to prevent duplicates
        let upsertedCampaignId: string | null = null;
        let campaignError: { message: string } | null = null;
        
        if (existingCampaign) {
          // UPDATE existing campaign (preserves the same UUID for contacts)
          const { error } = await supabase
            .from("synced_campaigns")
            .update({
              integration_id: integrationId, // Update to current integration
              name: String(sequence.name || 'Unnamed Sequence'),
              status: normalizeStatus(sequence.status),
              stats: mergedStats,
              raw_data: sequence,
              is_linked: isLinked,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingCampaign.id);
          
          if (error) {
            campaignError = error;
          } else {
            upsertedCampaignId = existingCampaign.id;
            console.log(`Updated existing campaign ${existingCampaign.id} for sequence ${sequence.id}`);
          }
        } else {
          // INSERT new campaign
          const { data, error } = await supabase
            .from("synced_campaigns")
            .insert({
              integration_id: integrationId,
              team_id: teamId,
              external_campaign_id: String(sequence.id),
              name: String(sequence.name || 'Unnamed Sequence'),
              status: normalizeStatus(sequence.status),
              stats: mergedStats,
              raw_data: sequence,
              is_linked: isLinked,
            })
            .select("id")
            .single();
          
          if (error) {
            campaignError = error;
          } else {
            upsertedCampaignId = data?.id || null;
            console.log(`Created new campaign ${upsertedCampaignId} for sequence ${sequence.id}`);
          }
        }

        if (campaignError) {
          console.error(`Failed to upsert sequence ${sequence.id}:`, campaignError);
          campaignsFailed++;
          continue;
        }

        campaignsProcessed++;
        
        // Track for contact sync
        if (upsertedCampaignId) {
          syncedCampaignIds.push({
            internal: upsertedCampaignId,
            external: String(sequence.id),
          });
        }
        
        // Small delay between campaigns for rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (sequenceError) {
        console.error(`Error processing sequence ${sequence.id}:`, sequenceError);
        campaignsFailed++;
      }
    }

    console.log(`Campaign sync complete: ${campaignsProcessed}/${sequences.length} sequences`);

    // NOTE: Contact sync is handled separately via `sync-reply-contacts`

    // Update integration status
    const finalStatus = campaignsFailed > 0 && campaignsProcessed === 0 ? "error" : "synced";
    const syncError = campaignsFailed > 0 
      ? `Synced ${campaignsProcessed}/${sequences.length} sequences (${campaignsFailed} failed)` 
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

    console.log(`Sync complete: ${campaignsProcessed} campaigns`);

    return new Response(
      JSON.stringify({
        success: true,
        campaigns: campaignsProcessed,
        campaignsFailed,
        mode: "v3-sequences",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Sync error:", err);

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
