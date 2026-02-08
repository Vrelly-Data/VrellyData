import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use V3 API for extended contacts with engagement data
const REPLY_API_V3 = "https://api.reply.io/v3";

// V3 Extended Contact response structure
interface V3ExtendedContact {
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  addedAt?: string;
  currentStep?: {
    stepId: number;
    displayStepNumber: string;
    stepNumber: number;
  };
  lastStepCompletedAt?: string | null;
  status?: {
    status: string;
    replied: boolean;
    delivered: boolean;
    bounced: boolean;
    opened: boolean;
    clicked: boolean;
    optedOut?: boolean;
    finished?: boolean;
  };
  // Additional fields from the API
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;
}

interface V3ExtendedResponse {
  items?: V3ExtendedContact[];
  info?: {
    hasMore: boolean;
  };
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
      const headers: Record<string, string> = {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(
          `Rate limited on ${endpoint}, waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Map V3 contact status to simplified status string
function mapContactStatus(contact: V3ExtendedContact): string {
  const status = contact.status;
  if (!status) {
    return 'active';
  }
  
  if (status.replied) return 'replied';
  if (status.bounced) return 'bounced';
  if (status.optedOut) return 'opted_out';
  if (status.finished) return 'finished';
  if (status.opened) return 'opened';
  
  // Use the status string from API
  const statusStr = status.status?.toLowerCase();
  if (statusStr === 'active' || statusStr === 'inprogress') return 'active';
  if (statusStr === 'finished') return 'finished';
  if (statusStr === 'paused') return 'paused';
  
  return statusStr || 'active';
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
    const { campaignId, integrationId } = body;

    if (!campaignId || !integrationId) {
      throw new Error("Missing campaignId or integrationId");
    }

    // Use user's auth to validate access to integration/campaign
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Fetch the integration (validates user has access via RLS)
    const { data: integration, error: integrationError } = await userClient
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, reply_team_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    // Fetch the campaign to get external_campaign_id (validates access via RLS)
    const { data: campaign, error: campaignError } = await userClient
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("id", campaignId)
      .single();

    // Use service role for bulk data operations (after access is validated)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id;
    // V3 API uses sequence ID (same as external_campaign_id)
    const sequenceId = campaign.external_campaign_id;

    console.log(`Fetching contacts for sequence ${sequenceId} using V3 extended API`);

    // Fetch contacts from Reply.io V3 API using offset pagination
    const allContacts: V3ExtendedContact[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    const maxIterations = 100; // Safety cap: 100 * 100 = 10,000 max
    let iteration = 0;

    while (hasMore && iteration < maxIterations) {
      const endpoint = `/sequences/${sequenceId}/contacts/extended?limit=${limit}&offset=${offset}`;
      console.log(`Fetching V3 extended contacts: offset=${offset}, limit=${limit}`);
      
      const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as V3ExtendedResponse;
      
      const items = response.items || [];
      allContacts.push(...items);
      
      console.log(`Fetched ${items.length} contacts, total: ${allContacts.length}`);
      
      // Check if there are more pages
      hasMore = response.info?.hasMore ?? false;
      
      if (hasMore) {
        offset += limit;
        iteration++;
        // Rate limit protection between pages
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log(`Total contacts fetched from V3 API: ${allContacts.length}`);

    // Batch upsert contacts to database
    const BATCH_SIZE = 100;
    let contactsSynced = 0;
    let contactsFailed = 0;

    // Track engagement stats from contacts
    let deliveredCount = 0;
    let repliesCount = 0;
    let opensCount = 0;
    let clicksCount = 0;
    let bouncesCount = 0;
    let optOutsCount = 0;
    let finishedCount = 0;

    for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
      const batch = allContacts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allContacts.length / BATCH_SIZE);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)`);

      const records = batch.map(contact => {
        const status = contact.status;
        
        // Count engagement stats from V3 status object
        if (status?.delivered) deliveredCount++;
        if (status?.replied) repliesCount++;
        if (status?.opened) opensCount++;
        if (status?.clicked) clicksCount++;
        if (status?.bounced) bouncesCount++;
        if (status?.optedOut) optOutsCount++;
        if (status?.finished) finishedCount++;
        
        const engagementData = {
          replied: status?.replied || false,
          bounced: status?.bounced || false,
          opened: status?.opened || false,
          clicked: status?.clicked || false,
          optedOut: status?.optedOut || false,
          finished: status?.finished || false,
          delivered: status?.delivered || false, // NEW: V3 provides delivered status
          addedAt: contact.addedAt,
          lastStepCompletedAt: contact.lastStepCompletedAt,
        };

        return {
          campaign_id: campaignId,
          team_id: teamId,
          external_contact_id: null, // V3 extended doesn't return contact ID
          email: contact.email,
          first_name: contact.firstName || null,
          last_name: contact.lastName || null,
          company: contact.company || null,
          job_title: contact.title || null,
          status: mapContactStatus(contact),
          engagement_data: engagementData,
          custom_fields: {},
          raw_data: contact,
          updated_at: new Date().toISOString(),
          // Additional fields
          industry: contact.industry || null,
          company_size: contact.companySize && contact.companySize !== 'Empty' ? contact.companySize : null,
          city: contact.city || null,
          state: contact.state || null,
          country: contact.country || null,
          phone: contact.phone || null,
          linkedin_url: contact.linkedInProfile || null,
          added_at: contact.addedAt || null,
        };
      });

      try {
        const { error: upsertError } = await serviceClient
          .from("synced_contacts")
          .upsert(records, {
            onConflict: "campaign_id,email",
          });

        if (upsertError) {
          console.error(`Batch ${batchNumber} failed:`, upsertError);
          contactsFailed += batch.length;
        } else {
          contactsSynced += batch.length;
        }
      } catch (err) {
        console.error(`Error in batch ${batchNumber}:`, err);
        contactsFailed += batch.length;
      }
    }

    // Verify actual count in database
    const { count: verifiedCount } = await serviceClient
      .from("synced_contacts")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const peopleCount = verifiedCount || allContacts.length;

    // Get existing campaign stats to preserve LinkedIn metrics
    const { data: existingCampaign } = await serviceClient
      .from("synced_campaigns")
      .select("stats")
      .eq("id", campaignId)
      .maybeSingle();

    const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

    // Preserve LinkedIn stats that came from CSV upload
    const linkedinMessagesSent = existingStats.linkedinMessagesSent || 0;
    const linkedinConnectionsSent = existingStats.linkedinConnectionsSent || 0;
    const linkedinConnectionsAccepted = existingStats.linkedinConnectionsAccepted || 0;
    const linkedinReplies = existingStats.linkedinReplies || 0;

    // Update campaign stats with actual counts from V3 engagement data
    await serviceClient
      .from("synced_campaigns")
      .update({
        stats: {
          ...existingStats,
          peopleCount,
          // Use V3 delivered count - this is the actual "emails sent" metric
          sent: deliveredCount,
          delivered: deliveredCount,
          replies: repliesCount,
          opens: opensCount,
          clicked: clicksCount,
          bounces: bouncesCount,
          optOuts: optOutsCount,
          peopleFinished: finishedCount,
          // Preserve LinkedIn stats
          linkedinMessagesSent,
          linkedinConnectionsSent,
          linkedinConnectionsAccepted,
          linkedinReplies,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`Contacts sync complete: ${contactsSynced} processed, ${contactsFailed} failed, ${peopleCount} verified`);
    console.log(`Engagement stats: ${deliveredCount} delivered, ${repliesCount} replies, ${opensCount} opens`);

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        totalFetched: allContacts.length,
        verifiedCount: peopleCount,
        campaignStats: {
          peopleCount,
          sent: deliveredCount,
          delivered: deliveredCount,
          replies: repliesCount,
          opens: opensCount,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Contacts sync error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
