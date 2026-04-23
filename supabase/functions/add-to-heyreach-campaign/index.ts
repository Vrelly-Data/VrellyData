import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { lead_id, campaign_id, message } = body;

    if (!lead_id || !campaign_id || !message) {
      throw new Error("Missing required fields: lead_id, campaign_id, message");
    }

    // Fetch the agent_leads row for this user
    const { data: lead, error: leadError } = await supabase
      .from("agent_leads")
      .select("linkedin_url, full_name, email")
      .eq("id", lead_id)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      throw new Error("Lead not found or access denied");
    }

    if (!lead.linkedin_url) {
      throw new Error("Lead is missing LinkedIn URL");
    }

    // Split full_name into first/last
    const nameParts = (lead.full_name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Get HeyReach API key from outbound_integrations
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("api_key_encrypted")
      .eq("platform", "heyreach")
      .eq("created_by", user.id)
      .single();

    if (integrationError || !integration) {
      throw new Error("HeyReach integration not found");
    }

    const apiKey = integration.api_key_encrypted;

    // Validate campaign_id numeric conversion — synced_campaigns.external_campaign_id
    // is TEXT, but HeyReach's campaignId must be a positive integer.
    const campaignIdNum = Number(campaign_id);
    if (!Number.isFinite(campaignIdNum) || campaignIdNum <= 0) {
      throw new Error(
        `Invalid campaign_id: received "${campaign_id}" (Number conversion produced ${campaignIdNum}). ` +
        `Expected a positive integer string.`,
      );
    }

    // Build payload once so we can log it on error.
    const heyreachPayload = {
      campaignId: campaignIdNum,
      accountLeadPairs: [
        {
          lead: {
            firstName,
            lastName,
            profileUrl: lead.linkedin_url,
            emailAddress: lead.email || "",
            customUserFields: [
              { name: "message", value: message },
            ],
          },
        },
      ],
      resumeFinishedCampaign: true,
      resumePausedCampaign: true,
    };

    // Add lead to HeyReach campaign
    const heyreachResponse = await fetch(
      "https://api.heyreach.io/api/public/campaign/AddLeadsToCampaignV2",
      {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(heyreachPayload),
      }
    );

    if (!heyreachResponse.ok) {
      const errorText = await heyreachResponse.text();
      console.error("HeyReach API error response:", heyreachResponse.status, errorText);
      console.error("Request payload sent:", JSON.stringify(heyreachPayload));
      throw new Error(`HeyReach API error (${heyreachResponse.status}): ${errorText}`);
    }

    const heyreachResult = await heyreachResponse.json();

    // Look up the campaign name so we can persist it on the lead for the
    // Campaign History section in the UI. Non-fatal if the lookup fails —
    // the lead update below still lands without the name.
    let campaignName: string | null = null;
    try {
      const { data: campaignRow } = await supabase
        .from("synced_campaigns")
        .select("name")
        .eq("external_campaign_id", String(campaignIdNum))
        .maybeSingle();
      campaignName = (campaignRow as { name?: string } | null)?.name ?? null;
    } catch (e) {
      console.warn("Campaign name lookup failed:", e);
    }

    // Update agent_leads on success. pipeline_stage → 'in_progress' because
    // the lead is now being actively worked via an outbound sequence.
    const { error: updateError } = await supabase
      .from("agent_leads")
      .update({
        inbox_status: "replied",
        pipeline_stage: "in_progress",
        last_campaign_name: campaignName,
      })
      .eq("id", lead_id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Failed to update lead status:", updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        addedLeadsCount: heyreachResult.addedLeadsCount ?? 0,
        updatedLeadsCount: heyreachResult.updatedLeadsCount ?? 0,
        failedLeadsCount: heyreachResult.failedLeadsCount ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Add to HeyReach campaign error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
