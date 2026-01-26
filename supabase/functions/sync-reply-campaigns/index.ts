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

interface ReplyioStep {
  id: number;
  number: number;
  type: string;
  subject?: string;
  body?: string;
  delayDays?: number;
}

interface ReplyioPerson {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  status?: string;
  stats?: {
    opened?: boolean;
    clicked?: boolean;
    replied?: boolean;
    bounced?: boolean;
  };
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
        const waitTime = 10000 * attempt; // 10s, 20s, 30s
        console.log(`Rate limited on ${endpoint}, waiting ${waitTime/1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Paginated fetch helper to get all results across multiple pages
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
    
    const response = await fetchFromReplyio(url, apiKey, teamId);
    const results = response[resultKey] || response || [];
    
    if (!Array.isArray(results)) {
      console.warn(`Expected array for ${resultKey}, got:`, typeof results);
      break;
    }
    
    allResults = [...allResults, ...results];
    
    // Check for more pages using Reply.io's pagination metadata
    // Reply.io uses different patterns: info.hasMore, hasMore, or check if we got a full page
    hasMore = response.info?.hasMore || 
              response.hasMore || 
              (results.length === pageSize);
    
    console.log(`  Page ${page}: fetched ${results.length} ${resultKey}, total: ${allResults.length}, hasMore: ${hasMore}`);
    
    page++;
    
    // Safety limit to prevent infinite loops
    if (page > 500) {
      console.warn(`Reached page limit (500) for ${endpoint}`);
      break;
    }
    
    // Increased delay to avoid rate limiting (2 seconds between pages)
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return allResults;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse body early so we can use integrationId in error handling
  let integrationId: string | undefined;
  let authHeader: string | null = null;
  
  try {
    authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    integrationId = body.integrationId;

    // Create Supabase client with user's auth
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    
    if (!integrationId) {
      throw new Error("Missing integrationId");
    }

    // Fetch the integration to get API key and reply_team_id
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

    const apiKey = integration.api_key_encrypted; // TODO: Decrypt when encryption is implemented
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id; // For agency accounts

    // Update status to syncing
    await supabase
      .from("outbound_integrations")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("id", integrationId);

    console.log(`Starting sync for integration ${integrationId}`);

    // Fetch ALL campaigns from Reply.io with pagination
    let campaigns: ReplyioCampaign[] = [];
    try {
      campaigns = await fetchAllPaginated<ReplyioCampaign>(
        "/campaigns",
        apiKey,
        "campaigns",
        replyTeamId || undefined
      );
      console.log(`Fetched ${campaigns.length} total campaigns from Reply.io${replyTeamId ? ` for team ${replyTeamId}` : ''}`);
      
      // Debug: Log sample campaign structure for troubleshooting
      if (campaigns.length > 0) {
        console.log("Sample campaign structure:", JSON.stringify(campaigns[0], null, 2));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch campaigns:", err);
      throw new Error(`Failed to fetch campaigns: ${errorMessage}`);
    }

    let totalContacts = 0;
    let totalSequences = 0;

    // Process each campaign
    let campaignIndex = 0;
    for (const campaign of campaigns) {
      campaignIndex++;
      
      // Validate campaign has required fields
      if (!campaign.id || !campaign.name) {
        console.warn(`[${campaignIndex}/${campaigns.length}] Skipping campaign with missing id or name:`, campaign);
        continue;
      }
      
      console.log(`[${campaignIndex}/${campaigns.length}] Processing campaign: ${campaign.name} (ID: ${campaign.id})`)

      // Upsert campaign with proper type handling
      const { error: campaignError } = await supabase
        .from("synced_campaigns")
        .upsert({
          integration_id: integrationId,
          team_id: teamId,
          external_campaign_id: String(campaign.id),
          name: String(campaign.name || 'Unnamed Campaign'),
          status: normalizeStatus(campaign.status),
          stats: {
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
          },
          raw_data: campaign,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "integration_id,external_campaign_id",
        });

      if (campaignError) {
        console.error(`Failed to upsert campaign ${campaign.id}:`, campaignError);
        continue;
      }

      // Get the synced campaign ID for foreign key reference
      const { data: syncedCampaign } = await supabase
        .from("synced_campaigns")
        .select("id")
        .eq("integration_id", integrationId)
        .eq("external_campaign_id", String(campaign.id))
        .single();

      if (!syncedCampaign) continue;

      // Fetch and sync sequences (ALL step types) with retry logic
      try {
        const stepsResponse = await fetchWithRetry(`/campaigns/${campaign.id}/steps`, apiKey, replyTeamId || undefined) as Record<string, unknown>;
        const steps: ReplyioStep[] = (stepsResponse.steps as ReplyioStep[]) || (Array.isArray(stepsResponse) ? stepsResponse : []);
        
        // Log all step types for debugging
        const stepTypeSummary = steps.reduce((acc, s) => {
          acc[s.type] = (acc[s.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        console.log(`  Step types in campaign ${campaign.id}:`, JSON.stringify(stepTypeSummary));
        
        for (const step of steps) {
          // Capture ALL step types (email, linkedin_connect, linkedin_message, linkedin_view_profile, linkedin_inmail, call, manual_task, etc.)
          console.log(`    Step ${step.number}: type=${step.type}`);
          
          await supabase
            .from("synced_sequences")
            .upsert({
              campaign_id: syncedCampaign.id,
              team_id: teamId,
              external_sequence_id: String(step.id),
              step_number: step.number,
              step_type: step.type, // Store the step type
              subject: step.subject || "",
              body_html: step.body || "",
              delay_days: step.delayDays || 0,
              raw_data: step,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "campaign_id,step_number",
            });
          
          totalSequences++;
        }
      } catch (error) {
        console.error(`Failed to fetch steps for campaign ${campaign.id}:`, error);
      }

      // Fetch and sync contacts (people) with pagination
      try {
        console.log(`  Fetching people for campaign ${campaign.id}...`);
        const people = await fetchAllPaginated<ReplyioPerson>(
          `/campaigns/${campaign.id}/people`,
          apiKey,
          "people",
          replyTeamId || undefined
        );
        
        console.log(`  - Found ${people.length} contacts in campaign ${campaign.id}`);
        
        // Log sample person structure for debugging
        if (people.length > 0) {
          console.log(`  - Sample person structure:`, JSON.stringify(people[0], null, 2));
        } else {
          console.log(`  - No people returned from API for campaign ${campaign.id}`);
        }
        
        let campaignContactsSynced = 0;
        for (const person of people) {
          const { error: contactError } = await supabase
            .from("synced_contacts")
            .upsert({
              campaign_id: syncedCampaign.id,
              team_id: teamId,
              external_contact_id: String(person.id),
              email: person.email,
              first_name: person.firstName || null,
              last_name: person.lastName || null,
              company: person.company || null,
              job_title: person.title || null,
              status: person.status || null,
              engagement_data: {
                opened: person.stats?.opened || false,
                clicked: person.stats?.clicked || false,
                replied: person.stats?.replied || false,
                bounced: person.stats?.bounced || false,
              },
              raw_data: person,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: "campaign_id,email",
            });
          
          if (contactError) {
            console.error(`    Failed to upsert contact ${person.email}:`, contactError);
          } else {
            campaignContactsSynced++;
            totalContacts++;
          }
        }
        console.log(`  - Successfully synced ${campaignContactsSynced} contacts for campaign ${campaign.id}`);
      } catch (error) {
        console.error(`Failed to fetch people for campaign ${campaign.id}:`, error);
      }
      
      // Add 10 second delay between campaigns to respect Reply.io rate limits
      if (campaignIndex < campaigns.length) {
        console.log(`  Waiting 10s before next campaign (rate limit protection)...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    // Update integration status to synced
    await supabase
      .from("outbound_integrations")
      .update({
        sync_status: "synced",
        sync_error: null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    console.log(`Sync complete: ${campaigns.length} campaigns, ${totalSequences} sequences, ${totalContacts} contacts`);

    return new Response(
      JSON.stringify({
        success: true,
        campaigns: campaigns.length,
        sequences: totalSequences,
        contacts: totalContacts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Sync error:", err);

    // Try to update integration status to error (using integrationId captured at start)
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
