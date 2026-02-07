import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use V1 API which has working page-based pagination
const REPLY_API_V1 = "https://api.reply.io/v1";

interface ReplyPeopleResponse {
  people?: ReplyPerson[];
  totalCount?: number;
}

interface ReplyPerson {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  status?: string;
  replied?: boolean;
  bounced?: boolean;
  finished?: boolean;
  optedOut?: boolean;
  opened?: boolean;
  clicked?: boolean;
  customFields?: Record<string, unknown>;
  addedTime?: string;
  // Additional contact data fields
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;
  addingDate?: string;
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
        throw new Error(`Reply.io API error (${response.status}): ${errorText}`);
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

// Map Reply.io person status to simplified status string
function mapPersonStatus(person: ReplyPerson): string {
  if (person.replied) return 'replied';
  if (person.bounced) return 'bounced';
  if (person.optedOut) return 'opted_out';
  if (person.finished) return 'finished';
  if (person.opened) return 'opened';
  // V1 API uses string status like "InProgress", "Finished", etc.
  if (person.status) {
    const statusLower = person.status.toLowerCase();
    if (statusLower === 'inprogress' || statusLower === 'in_progress') return 'active';
    if (statusLower === 'finished') return 'finished';
    if (statusLower === 'paused') return 'paused';
    return statusLower;
  }
  return 'active';
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
    // V1 API uses campaign ID directly
    const replyCampaignId = campaign.external_campaign_id;

    console.log(`Fetching contacts for campaign ${replyCampaignId} using V1 API`);

    // Fetch contacts from Reply.io V1 API using PAGE pagination (1-indexed)
    const uniqueContactsMap = new Map<string, ReplyPerson>();
    let page = 1;
    const limit = 100;
    let hasMore = true;
    let totalFetched = 0;
    const maxPages = 100; // Safety cap: 100 pages * 100 contacts = 10,000 max
    let consecutiveDuplicatePages = 0;

    while (hasMore && page <= maxPages) {
      const endpoint = `/campaigns/${replyCampaignId}/people?limit=${limit}&page=${page}`;
      console.log(`Fetching page ${page}: limit=${limit}`);
      
      const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as ReplyPeopleResponse;
      
      const people = response.people || [];
      totalFetched += people.length;
      
      // Track unique contacts by email to avoid duplicates
      let newUniqueCount = 0;
      for (const person of people) {
        if (person.email && !uniqueContactsMap.has(person.email.toLowerCase())) {
          uniqueContactsMap.set(person.email.toLowerCase(), person);
          newUniqueCount++;
        }
      }
      
      console.log(`Page ${page}: fetched ${people.length}, new unique: ${newUniqueCount}, total unique: ${uniqueContactsMap.size}`);
      
      // Track consecutive pages with no new contacts (API returning same data)
      if (newUniqueCount === 0 && people.length > 0) {
        consecutiveDuplicatePages++;
        console.log(`Page ${page} returned duplicates (${consecutiveDuplicatePages} consecutive)`);
        // Stop if we get 3 consecutive pages of duplicates - API is stuck
        if (consecutiveDuplicatePages >= 3) {
          console.log("Stopping: 3 consecutive duplicate pages detected");
          break;
        }
      } else {
        consecutiveDuplicatePages = 0; // Reset counter on new unique contacts
      }
      
      // Stop conditions:
      // 1. Empty page (no more contacts)
      // 2. Fewer items than limit (last page)
      if (people.length === 0 || people.length < limit) {
        hasMore = false;
      }
      
      page++;
      
      // Rate limit protection between pages
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const allContacts = Array.from(uniqueContactsMap.values());
    console.log(`Fetched ${totalFetched} total items, ${allContacts.length} unique contacts from Reply.io V1 API`);

    // Batch upsert contacts to database
    const BATCH_SIZE = 100;
    let contactsSynced = 0;
    let contactsFailed = 0;

    for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
      const batch = allContacts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allContacts.length / BATCH_SIZE);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)`);

      const records = batch.map(person => {
        const engagementData = {
          replied: person.replied || false,
          bounced: person.bounced || false,
          opened: person.opened || false,
          clicked: person.clicked || false,
          optedOut: person.optedOut || false,
          finished: person.finished || false,
          addedTime: person.addedTime || person.addingDate,
        };

        return {
          campaign_id: campaignId,
          team_id: teamId,
          external_contact_id: String(person.id),
          email: person.email,
          first_name: person.firstName || null,
          last_name: person.lastName || null,
          company: person.company || null,
          job_title: person.title || null,
          status: mapPersonStatus(person),
          engagement_data: engagementData,
          custom_fields: person.customFields || {},
          raw_data: person,
          updated_at: new Date().toISOString(),
          // New fields from Reply.io
          industry: person.industry || null,
          company_size: person.companySize && person.companySize !== 'Empty' ? person.companySize : null,
          city: person.city || null,
          state: person.state || null,
          country: person.country || null,
          phone: person.phone || null,
          linkedin_url: person.linkedInProfile || null,
          added_at: person.addingDate || person.addedTime || null,
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

    // Update campaign aggregate stats from contact booleans
    // (This makes the dashboard update even if statistics endpoints are unavailable.)
    const repliesCount = allContacts.filter(p => !!p.replied).length;
    const opensCount = allContacts.filter(p => !!p.opened).length;
    const clicksCount = allContacts.filter(p => !!p.clicked).length;
    const bouncesCount = allContacts.filter(p => !!p.bounced).length;
    const optOutsCount = allContacts.filter(p => !!p.optedOut).length;
    const finishedCount = allContacts.filter(p => !!p.finished).length;

    const { data: existingCampaign } = await serviceClient
      .from("synced_campaigns")
      .select("stats")
      .eq("id", campaignId)
      .maybeSingle();

    const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

    const existingSent = typeof existingStats.sent === 'number' ? (existingStats.sent as number) : null;
    const existingDelivered = typeof existingStats.delivered === 'number' ? (existingStats.delivered as number) : null;

    await serviceClient
      .from("synced_campaigns")
      .update({
        stats: {
          ...existingStats,
          peopleCount,
          replies: repliesCount,
          opens: opensCount,
          clicked: clicksCount,
          bounces: bouncesCount,
          optOuts: optOutsCount,
          peopleFinished: finishedCount,
          // If no API delivery stats are available, fall back to peopleCount
          delivered: existingDelivered ?? peopleCount,
          sent: existingSent ?? existingDelivered ?? peopleCount,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`Contacts sync complete: ${contactsSynced} processed, ${contactsFailed} failed, ${peopleCount} verified in database`);

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        totalFetched,
        uniquePrepared: allContacts.length,
        verifiedCount: peopleCount,
        campaignStats: {
          peopleCount,
          replies: repliesCount,
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
