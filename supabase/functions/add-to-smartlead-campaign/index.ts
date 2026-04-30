// [add-to-smartlead-campaign v1]
//
// Mirrors add-to-heyreach-campaign structurally — auth via user JWT (RLS),
// single-integration-per-user lookup, agent_leads update on success with
// system message appended to reply_thread.
//
// Smartlead API:
//   POST /campaigns/{campaign_id}/leads?api_key=KEY
//   Body: { lead_list: [{ first_name, last_name, email, custom_fields }], settings }
//
// API key in QUERY STRING — never log the URL because it contains the
// credential. URLs are built via URL + URLSearchParams so api_key is
// always properly encoded.
//
// UX gotcha (surfaced in frontend toast): Smartlead only renders
// {{first_touch_message}} if the user's campaign template references it.
// Without that token, the personalized message is silently dropped and
// the prospect receives the campaign's default opener.
//
// Body field naming: accepts both camelCase (`leadId` / `campaignId`) and
// snake_case (`lead_id` / `campaign_id`) so the D4 dispatcher can use
// whichever convention matches the sibling hook (`useAddToHeyReachCampaign`
// uses snake_case).

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

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

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
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const leadId: string | undefined = body.leadId ?? body.lead_id;
    const campaignId: string | undefined = body.campaignId ?? body.campaign_id;
    const message: string | undefined = body.message;

    if (!leadId || !campaignId || !message) {
      throw new Error("Missing required fields: leadId, campaignId, message");
    }

    // Fetch the agent_leads row for this user.
    const { data: lead, error: leadError } = await supabase
      .from("agent_leads")
      .select(
        "channel, full_name, email, email_address, smartlead_lead_id, reply_thread",
      )
      .eq("id", leadId)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      throw new Error("Lead not found or access denied");
    }

    if (lead.channel !== "email") {
      return new Response(
        JSON.stringify({
          error:
            `This function is for email channel; lead is "${lead.channel}". ` +
            `Use add-to-heyreach-campaign for LinkedIn leads.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const leadEmail = (lead.email_address as string | null) ?? (lead.email as string | null);
    if (!leadEmail) {
      throw new Error("Lead is missing email address");
    }

    // Smartlead's /campaigns/{id}/leads accepts a string campaign_id in the
    // URL but our synced_campaigns external_campaign_id is already a string.
    // No numeric coercion needed (unlike HeyReach).
    if (!campaignId.trim()) {
      throw new Error(`Invalid campaignId: empty string`);
    }

    // Get Smartlead API key (single-integration-per-user, mirrors send-smartlead-email).
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("api_key_encrypted")
      .eq("platform", "smartlead")
      .eq("is_active", true)
      .eq("created_by", user.id)
      .single();

    if (integrationError || !integration?.api_key_encrypted) {
      throw new Error("Active Smartlead integration not found for this user");
    }

    const apiKey = integration.api_key_encrypted as string;

    // Parse first/last name from full_name. Email-prefix fallback for
    // first_name only — last_name stays empty rather than duplicating the
    // prefix (which would produce noisy data like first='dennis', last='dennis').
    const fullName = (lead.full_name || "").trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const emailPrefix = leadEmail.split("@")[0] || "";
    const firstName = nameParts[0] || emailPrefix || "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    // Smartlead payload. ignore_* defaults are conservative — we respect
    // dedup, blocklists, and unsubscribes. If a user wants to override,
    // they can do it manually in the Smartlead UI per-campaign.
    const smartleadPayload = {
      lead_list: [
        {
          first_name: firstName,
          last_name: lastName,
          email: leadEmail,
          custom_fields: {
            first_touch_message: message,
          },
        },
      ],
      settings: {
        ignore_global_block_list: false,
        ignore_unsubscribe_list: false,
        ignore_community_bounce_list: false,
        ignore_duplicate_leads_in_other_campaign: false,
      },
    };

    // Build URL with URLSearchParams so api_key is properly encoded.
    // NEVER log this URL — it contains the credential.
    const url = new URL(
      `${SMARTLEAD_API_BASE}/campaigns/${encodeURIComponent(campaignId)}/leads`,
    );
    url.searchParams.set("api_key", apiKey);

    const smartleadResponse = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(smartleadPayload),
    });

    if (!smartleadResponse.ok) {
      const errorText = await smartleadResponse.text();
      // Log status + body snippet only (not the URL — contains api_key).
      // Payload is safe to log: no credentials.
      console.error(
        "[add-to-smartlead-campaign v1] Smartlead API error:",
        smartleadResponse.status,
        errorText.substring(0, 500),
      );
      console.error(
        "[add-to-smartlead-campaign v1] Request payload:",
        JSON.stringify(smartleadPayload),
      );
      throw new Error(
        `Smartlead API error (${smartleadResponse.status}): ${errorText.substring(0, 300)}`,
      );
    }

    const smartleadResult = await smartleadResponse.json().catch(() => ({}));

    // Look up the campaign name for the system message + last_campaign_name.
    // Non-fatal if missing — surface "Unknown" in the system message.
    let campaignName: string | null = null;
    try {
      const { data: campaignRow } = await supabase
        .from("synced_campaigns")
        .select("name")
        .eq("external_campaign_id", String(campaignId))
        .eq("source", "smartlead")
        .maybeSingle();
      campaignName = (campaignRow as { name?: string } | null)?.name ?? null;
    } catch (e) {
      console.warn(
        "[add-to-smartlead-campaign v1] Campaign name lookup failed:",
        e,
      );
    }

    // Append a system message to reply_thread documenting the action.
    // Read-then-write; same race window pattern as add-to-heyreach-campaign.
    const existingThread = Array.isArray(lead.reply_thread) ? lead.reply_thread : [];
    const systemMessage = {
      role: "system",
      content: `Added to campaign: ${campaignName ?? "Unknown"}`,
      timestamp: new Date().toISOString(),
      channel: "email",
    };
    const updatedThread = [...existingThread, systemMessage];

    // Mirrors add-to-heyreach-campaign: inbox_status='replied' (lead is now
    // out of the pending queue) + pipeline_stage='in_progress' (active
    // outbound sequence) + last_campaign_name persisted for the UI.
    const { error: updateError } = await supabase
      .from("agent_leads")
      .update({
        inbox_status: "replied",
        pipeline_stage: "in_progress",
        last_campaign_name: campaignName,
        reply_thread: updatedThread,
      })
      .eq("id", leadId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error(
        "[add-to-smartlead-campaign v1] Failed to update lead status:",
        updateError,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaignName,
        campaignId,
        smartleadResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[add-to-smartlead-campaign v1] error:", err);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
