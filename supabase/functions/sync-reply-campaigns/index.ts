import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v1";

interface ReplyioCampaign {
  id: number;
  name: string;
  status: string;
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

    // Fetch campaigns from Reply.io (pass replyTeamId for agency accounts)
    let campaigns: ReplyioCampaign[] = [];
    try {
      const campaignsResponse = await fetchFromReplyio("/campaigns", apiKey, replyTeamId || undefined);
      campaigns = campaignsResponse.campaigns || campaignsResponse || [];
      console.log(`Fetched ${campaigns.length} campaigns from Reply.io${replyTeamId ? ` for team ${replyTeamId}` : ''}`);
      
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
    for (const campaign of campaigns) {
      // Validate campaign has required fields
      if (!campaign.id || !campaign.name) {
        console.warn('Skipping campaign with missing id or name:', campaign);
        continue;
      }

      // Upsert campaign with proper type handling
      const { error: campaignError } = await supabase
        .from("synced_campaigns")
        .upsert({
          integration_id: integrationId,
          team_id: teamId,
          external_campaign_id: String(campaign.id),
          name: String(campaign.name || 'Unnamed Campaign'),
          status: normalizeStatus(campaign.status),
          stats: campaign.stats || {},
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

      // Fetch and sync sequences (email steps)
      try {
        const stepsResponse = await fetchFromReplyio(`/campaigns/${campaign.id}/steps`, apiKey, replyTeamId || undefined);
        const steps: ReplyioStep[] = stepsResponse.steps || stepsResponse || [];
        
        for (const step of steps) {
          if (step.type !== "email") continue; // Only sync email steps
          
          await supabase
            .from("synced_sequences")
            .upsert({
              campaign_id: syncedCampaign.id,
              team_id: teamId,
              external_sequence_id: String(step.id),
              step_number: step.number,
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

      // Fetch and sync contacts (people)
      try {
        const peopleResponse = await fetchFromReplyio(`/campaigns/${campaign.id}/people`, apiKey, replyTeamId || undefined);
        const people: ReplyioPerson[] = peopleResponse.people || peopleResponse || [];
        
        for (const person of people) {
          await supabase
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
          
          totalContacts++;
        }
      } catch (error) {
        console.error(`Failed to fetch people for campaign ${campaign.id}:`, error);
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
