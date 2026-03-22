import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
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
    console.warn(`Could not fetch V3 stats for sequence ${sequenceId}:`, err);
    return {};
  }
}

// Fetch sequence report from V3 Reports API (different endpoint, may have different permissions)
async function fetchSequenceReport(
  sequenceId: number,
  apiKey: string,
  teamId?: string
): Promise<Record<string, number>> {
  try {
    const data = await fetchWithRetryV3(
      `/reports/sequences/${sequenceId}`, 
      apiKey, 
      teamId
    ) as Record<string, unknown>;
    
    // Reports API may use different field names
    return {
      sent: (data.delivered as number) || (data.sent as number) || (data.deliveredContacts as number) || 0,
      delivered: (data.delivered as number) || (data.deliveredContacts as number) || 0,
      replies: (data.replied as number) || (data.replies as number) || (data.repliedContacts as number) || 0,
      opens: (data.opened as number) || (data.opens as number) || (data.openedContacts as number) || 0,
      clicks: (data.clicked as number) || (data.clicks as number) || (data.clickedContacts as number) || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch V3 report for sequence ${sequenceId}:`, err);
    return {};
  }
}

// Fetch campaign stats from V1 single campaign endpoint without team header
// (Some accounts may not work with team-scoped requests)
async function fetchCampaignStatsV1NoTeam(
  campaignId: number,
  apiKey: string
): Promise<Record<string, number>> {
  try {
    // Try without team header - might work for non-agency accounts
    const data = await fetchWithRetryV1(`/campaigns/${campaignId}`, apiKey);
    const campaign = data as Record<string, unknown>;
    
    return {
      sent: (campaign.peopleSent as number) || (campaign.peopleDelivered as number) || 0,
      delivered: (campaign.peopleDelivered as number) || (campaign.peopleSent as number) || 0,
      replies: (campaign.peopleReplied as number) || 0,
      opens: (campaign.peopleOpened as number) || 0,
      clicks: (campaign.peopleClicked as number) || 0,
      bounces: (campaign.peopleBounced as number) || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch V1 stats (no team) for campaign ${campaignId}:`, err);
    return {};
  }
}

// Fetch campaign stats from V1 single campaign endpoint (fallback when V3 fails)
async function fetchCampaignStatsV1(
  campaignId: number,
  apiKey: string,
  teamId?: string
): Promise<Record<string, number>> {
  try {
    const data = await fetchWithRetryV1(`/campaigns/${campaignId}`, apiKey, teamId);
    const campaign = data as Record<string, unknown>;
    
    // V1 campaign response includes aggregate stats directly
    return {
      sent: (campaign.peopleSent as number) || (campaign.peopleDelivered as number) || 0,
      delivered: (campaign.peopleDelivered as number) || (campaign.peopleSent as number) || 0,
      replies: (campaign.peopleReplied as number) || 0,
      opens: (campaign.peopleOpened as number) || 0,
      clicks: (campaign.peopleClicked as number) || 0,
      bounces: (campaign.peopleBounced as number) || 0,
      peopleFinished: (campaign.peopleFinished as number) || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch V1 stats for campaign ${campaignId}:`, err);
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

        // Fetch stats - multiple fallback layers
        console.log(`  Fetching stats from V3 Statistics API...`);
        let apiStats = await fetchSequenceStats(sequence.id, apiKey, replyTeamId || undefined);
        
        // Fallback 1: Try V3 Reports API
        if (!apiStats.sent && !apiStats.replies) {
          console.log(`  V3 stats empty, trying V3 Reports API...`);
          apiStats = await fetchSequenceReport(sequence.id, apiKey, replyTeamId || undefined);
        }
        
        // Fallback 2: Try V1 single campaign with team header
        if (!apiStats.sent && !apiStats.replies) {
          console.log(`  V3 reports empty, trying V1 /campaigns/${sequence.id}...`);
          apiStats = await fetchCampaignStatsV1(sequence.id, apiKey, replyTeamId || undefined);
        }
        
        // Fallback 3: Try V1 single campaign WITHOUT team header
        if (!apiStats.sent && !apiStats.replies) {
          console.log(`  V1 with team failed, trying V1 without team header...`);
          apiStats = await fetchCampaignStatsV1NoTeam(sequence.id, apiKey);
        }
        
        console.log(`  Final stats: sent=${apiStats.sent || 0}, replies=${apiStats.replies || 0}`);

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
          peopleCount: existingPeopleCount || 0,
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
