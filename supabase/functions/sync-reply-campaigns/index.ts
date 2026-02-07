import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// V3 API for sequences (includes teamId for workspace filtering)
const REPLY_API_V3 = "https://api.reply.io/v3";
// V1 API for fetching campaign stats (V3 doesn't include stats)
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

// V3 Statistics response
interface ReplySequenceStats {
  sequenceId: number;
  sequenceName?: string;
  deliveredContacts?: number;
  repliedContacts?: number;
  interestedContacts?: number;
  notInterestedContacts?: number;
  replyRate?: number;
  deliveryRate?: number;
  interestedRate?: number;
  openRate?: number;
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

// Fetch sequence stats from V3 Statistics API
async function fetchSequenceStats(
  sequenceId: number, 
  apiKey: string, 
  teamId?: string
): Promise<Record<string, number>> {
  try {
    const data = await fetchWithRetryV3(`/statistics/sequences/${sequenceId}`, apiKey, teamId) as ReplySequenceStats;
    
    return {
      sent: data.deliveredContacts || 0,
      delivered: data.deliveredContacts || 0,
      replies: data.repliedContacts || 0,
      replyRate: data.replyRate || 0,
      deliveryRate: data.deliveryRate || 0,
      interestedContacts: data.interestedContacts || 0,
      notInterestedContacts: data.notInterestedContacts || 0,
      openRate: data.openRate || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch stats for sequence ${sequenceId}:`, err);
    return {};
  }
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

    // Process each sequence - fetch stats and sync contacts
    const syncedCampaignIds: { internal: string; external: string }[] = [];

    for (const sequence of sequences) {
      try {
        if (!sequence.id || !sequence.name) {
          console.warn(`Skipping sequence with missing id or name`);
          campaignsFailed++;
          continue;
        }
        
        console.log(`Processing sequence: ${sequence.name} (ID: ${sequence.id})`);

        // Fetch existing campaign to preserve LinkedIn stats
        const { data: existingCampaign } = await supabase
          .from("synced_campaigns")
          .select("id, stats")
          .eq("integration_id", integrationId)
          .eq("external_campaign_id", String(sequence.id))
          .maybeSingle();

        const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

        // Preserve LinkedIn fields from existing stats
        const linkedinStats: Record<string, unknown> = {};
        for (const field of LINKEDIN_FIELDS) {
          if (existingStats[field] !== undefined) {
            linkedinStats[field] = existingStats[field];
          }
        }

        // Fetch stats from V3 Statistics API
        console.log(`  Fetching stats from V3 Statistics API...`);
        const apiStats = await fetchSequenceStats(sequence.id, apiKey, replyTeamId || undefined);
        console.log(`  Stats: sent=${apiStats.sent || 0}, replies=${apiStats.replies || 0}`);

        // Merge: API stats + preserve LinkedIn stats from CSV
        const mergedStats = {
          ...apiStats,
          ...linkedinStats,
        };

        // Upsert sequence as campaign
        const { data: upsertedCampaign, error: campaignError } = await supabase
          .from("synced_campaigns")
          .upsert({
            integration_id: integrationId,
            team_id: teamId,
            external_campaign_id: String(sequence.id),
            name: String(sequence.name || 'Unnamed Sequence'),
            status: normalizeStatus(sequence.status),
            stats: mergedStats,
            raw_data: sequence,
            is_linked: true,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "integration_id,external_campaign_id",
          })
          .select("id")
          .single();

        if (campaignError) {
          console.error(`Failed to upsert sequence ${sequence.id}:`, campaignError);
          campaignsFailed++;
          continue;
        }

        campaignsProcessed++;
        
        // Track for contact sync
        if (upsertedCampaign?.id) {
          syncedCampaignIds.push({
            internal: upsertedCampaign.id,
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

    console.log(`Sync complete: ${campaignsProcessed} campaigns (contacts sync runs per-campaign)`);

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

    console.log(`Full sync complete: ${campaignsProcessed} campaigns`);

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
