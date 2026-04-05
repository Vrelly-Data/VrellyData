import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // Auth: x-agent-key header
  const agentKey = req.headers.get("x-agent-key");
  const expectedKey = Deno.env.get("AGENT_API_KEY");
  if (!agentKey || agentKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Parse scope from body
  let scope: string = "full";
  try {
    const body = await req.json();
    if (body.scope === "campaigns") scope = "campaigns";
  } catch {
    // No body or invalid JSON — default to full
  }

  console.log(`Auto-sync starting (scope: ${scope})`);

  const results = {
    integrations_synced: 0,
    campaigns_synced: 0,
    contacts_synced: 0,
    errors: [] as string[],
  };

  try {
    // 1. Fetch all active Reply.io integrations
    const { data: integrations, error: intError } = await supabase
      .from("outbound_integrations")
      .select("id, platform, created_by, team_id, reply_team_id, api_key_encrypted")
      .eq("is_active", true)
      .eq("platform", "reply.io");

    if (intError) {
      throw new Error(`Failed to fetch integrations: ${intError.message}`);
    }

    if (!integrations || integrations.length === 0) {
      console.log("No active Reply.io integrations found");
      return new Response(JSON.stringify({ ...results, message: "No active integrations" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${integrations.length} active integrations`);

    // Use service role key as Authorization header for sub-function calls
    // (service role key is a valid JWT that bypasses RLS)
    const authHeader = `Bearer ${serviceRoleKey}`;

    // 2. Process each integration
    for (const integration of integrations) {
      try {
        console.log(`Processing integration ${integration.id} (team: ${integration.team_id})`);

        // 2a. Sync campaigns
        const campaignRes = await fetch(
          `${supabaseUrl}/functions/v1/sync-reply-campaigns`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": authHeader,
            },
            body: JSON.stringify({ integrationId: integration.id }),
          }
        );

        if (!campaignRes.ok) {
          const errText = await campaignRes.text();
          results.errors.push(`Campaigns sync failed for ${integration.id}: ${errText}`);
          console.error(`Campaigns sync failed for ${integration.id}: ${errText}`);
          continue;
        }

        const campaignData = await campaignRes.json();
        results.campaigns_synced += campaignData.campaigns || 0;
        console.log(`Campaigns synced for integration ${integration.id}: ${campaignData.campaigns || 0}`);

        // 2b. If scope is full, also sync contacts per campaign
        if (scope === "full") {
          // Fetch campaign IDs for this team
          const { data: campaigns, error: campError } = await supabase
            .from("synced_campaigns")
            .select("id, external_campaign_id")
            .eq("team_id", integration.team_id);

          if (campError) {
            results.errors.push(`Failed to fetch campaigns for team ${integration.team_id}: ${campError.message}`);
            console.error(`Failed to fetch campaigns for team ${integration.team_id}:`, campError);
          } else if (campaigns && campaigns.length > 0) {
            console.log(`Syncing contacts for ${campaigns.length} campaigns`);

            for (const campaign of campaigns) {
              try {
                const contactRes = await fetch(
                  `${supabaseUrl}/functions/v1/sync-reply-contacts`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": authHeader,
                    },
                    body: JSON.stringify({
                      integrationId: integration.id,
                      campaignId: campaign.id,
                    }),
                  }
                );

                if (!contactRes.ok) {
                  const errText = await contactRes.text();
                  results.errors.push(`Contacts sync failed for campaign ${campaign.external_campaign_id}: ${errText}`);
                  console.error(`Contacts sync failed for campaign ${campaign.external_campaign_id}: ${errText}`);
                } else {
                  const contactData = await contactRes.json();
                  results.contacts_synced += contactData.contactsSynced || 0;
                  console.log(`Contacts synced for campaign ${campaign.external_campaign_id}: ${contactData.contactsSynced || 0}`);
                }
              } catch (contactErr) {
                const msg = contactErr instanceof Error ? contactErr.message : String(contactErr);
                results.errors.push(`Contact sync error for campaign ${campaign.external_campaign_id}: ${msg}`);
                console.error(`Contact sync error for campaign ${campaign.external_campaign_id}:`, contactErr);
              }

              // 500ms delay between campaigns to avoid rate limiting
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
        }

        results.integrations_synced++;
      } catch (integrationErr) {
        const msg = integrationErr instanceof Error ? integrationErr.message : String(integrationErr);
        results.errors.push(`Integration ${integration.id} failed: ${msg}`);
        console.error(`Integration ${integration.id} failed:`, integrationErr);
        // Continue to next integration
      }
    }

    console.log(`Auto-sync complete:`, JSON.stringify(results));

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Auto-sync fatal error:", err);
    results.errors.push(errorMessage);

    return new Response(JSON.stringify(results), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
