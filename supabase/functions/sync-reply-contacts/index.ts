import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v3";

interface ReplyContact {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  status?: {
    status?: string;
    replied?: boolean;
    delivered?: boolean;
    bounced?: boolean;
    opened?: boolean;
    clicked?: boolean;
    optedOut?: boolean;
  };
  customFields?: Record<string, unknown>;
  addedAt?: string;
  lastStepCompletedAt?: string;
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

// Map Reply.io contact status to simplified status string
function mapContactStatus(status: ReplyContact['status']): string {
  if (!status) return 'unknown';
  if (status.replied) return 'replied';
  if (status.bounced) return 'bounced';
  if (status.optedOut) return 'opted_out';
  if (status.opened) return 'opened';
  if (status.delivered) return 'delivered';
  return status.status || 'active';
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
    const sequenceId = campaign.external_campaign_id;

    console.log(`Fetching contacts for sequence ${sequenceId}`);

    // Fetch contacts from Reply.io V3 API using OFFSET pagination (not page)
    const uniqueContactsMap = new Map<string, ReplyContact>();
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let totalFetched = 0;
    let iterations = 0;
    const maxIterations = 100; // Safety cap: 100 iterations * 100 contacts = 10,000 max

    while (hasMore && iterations < maxIterations) {
      iterations++;
      const endpoint = `/sequences/${sequenceId}/contacts/extended?limit=${limit}&offset=${offset}`;
      console.log(`Fetching page ${iterations}: offset=${offset}, limit=${limit}`);
      
      const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as { 
        items?: ReplyContact[]; 
        info?: { hasMore?: boolean } 
      };
      
      const contacts = response.items || [];
      totalFetched += contacts.length;
      
      // Track unique contacts by email to avoid duplicates
      let newUniqueCount = 0;
      for (const contact of contacts) {
        if (contact.email && !uniqueContactsMap.has(contact.email.toLowerCase())) {
          uniqueContactsMap.set(contact.email.toLowerCase(), contact);
          newUniqueCount++;
        }
      }
      
      console.log(`Page ${iterations}: fetched ${contacts.length}, new unique: ${newUniqueCount}, total unique: ${uniqueContactsMap.size}`);
      
      // Stop if no new contacts were found (we're seeing duplicates)
      if (newUniqueCount === 0 && contacts.length > 0) {
        console.log("No new unique contacts in this page, stopping pagination");
        break;
      }
      
      // Check if there's more data
      hasMore = response.info?.hasMore ?? (contacts.length === limit);
      
      // Move offset forward
      offset += contacts.length;
      
      // Break if we got fewer than limit (last page)
      if (contacts.length < limit) {
        hasMore = false;
      }
      
      // Rate limit protection between pages
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const allContacts = Array.from(uniqueContactsMap.values());
    console.log(`Fetched ${totalFetched} total items, ${allContacts.length} unique contacts from Reply.io`);

    // Batch upsert contacts to database
    const BATCH_SIZE = 100;
    let contactsSynced = 0;
    let contactsFailed = 0;

    for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
      const batch = allContacts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(allContacts.length / BATCH_SIZE);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)`);

      const records = batch.map(contact => {
        const engagementData = {
          replied: contact.status?.replied || false,
          delivered: contact.status?.delivered || false,
          bounced: contact.status?.bounced || false,
          opened: contact.status?.opened || false,
          clicked: contact.status?.clicked || false,
          optedOut: contact.status?.optedOut || false,
          addedAt: contact.addedAt,
          lastStepCompletedAt: contact.lastStepCompletedAt,
        };

        return {
          campaign_id: campaignId,
          team_id: teamId,
          external_contact_id: String(contact.id),
          email: contact.email,
          first_name: contact.firstName || null,
          last_name: contact.lastName || null,
          company: contact.company || null,
          job_title: contact.title || null,
          status: mapContactStatus(contact.status),
          engagement_data: engagementData,
          custom_fields: contact.customFields || {},
          raw_data: contact,
          updated_at: new Date().toISOString(),
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

    console.log(`Contacts sync complete: ${contactsSynced} processed, ${contactsFailed} failed, ${verifiedCount} verified in database`);

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        totalFetched,
        uniquePrepared: allContacts.length,
        verifiedCount: verifiedCount || 0,
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
