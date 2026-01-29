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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Fetch the integration
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, reply_team_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    // Fetch the campaign to get external_campaign_id
    const { data: campaign, error: campaignError } = await supabase
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id;
    const sequenceId = campaign.external_campaign_id;

    console.log(`Fetching contacts for sequence ${sequenceId}`);

    // Fetch contacts from Reply.io V3 API
    let allContacts: ReplyContact[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const endpoint = `/sequences/${sequenceId}/contacts/extended?page=${page}&limit=100`;
      const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as { 
        items?: ReplyContact[]; 
        info?: { hasMore?: boolean } 
      };
      
      const contacts = response.items || [];
      allContacts = [...allContacts, ...contacts];
      
      hasMore = response.info?.hasMore || false;
      page++;
      
      if (page > 50) {
        console.warn("Reached page limit (50) for contacts");
        break;
      }
      
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`Fetched ${allContacts.length} contacts from Reply.io`);

    // Upsert contacts to database
    let contactsSynced = 0;
    let contactsFailed = 0;

    for (const contact of allContacts) {
      try {
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

        const { error: upsertError } = await supabase
          .from("synced_contacts")
          .upsert({
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
          }, {
            onConflict: "campaign_id,email",
          });

        if (upsertError) {
          console.error(`Failed to upsert contact ${contact.email}:`, upsertError);
          contactsFailed++;
        } else {
          contactsSynced++;
        }
      } catch (err) {
        console.error(`Error processing contact ${contact.email}:`, err);
        contactsFailed++;
      }
    }

    console.log(`Contacts sync complete: ${contactsSynced} synced, ${contactsFailed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        totalFetched: allContacts.length,
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
