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
    // Extract integration ID from URL path (e.g. /heyreach-webhook/<integrationId>)
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const integrationId = pathParts[pathParts.length - 1];

    if (!integrationId || integrationId === "heyreach-webhook") {
      return new Response(JSON.stringify({ error: "Missing integration ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.text();
    console.log("HeyReach webhook payload:", payload.substring(0, 500));

    // Service role for database writes
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify integration exists
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, is_active, created_by, api_key_encrypted")
      .eq("id", integrationId)
      .eq("platform", "heyreach")
      .single();

    if (integrationError || !integration) {
      console.error("HeyReach integration not found:", integrationId);
      return new Response(JSON.stringify({ error: "Integration not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!integration.created_by) {
      console.error("Integration missing created_by");
      return new Response(JSON.stringify({ error: "Integration misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // HeyReach webhook event types:
    // EVERY_MESSAGE_REPLY_RECEIVED — a LinkedIn reply came in
    const eventType = event.eventType || event.type || "unknown";
    console.log(`HeyReach event: ${eventType} for integration ${integrationId}`);

    // Log the event
    await supabase.from("webhook_events").insert({
      integration_id: integrationId,
      team_id: integration.team_id,
      event_type: eventType,
      contact_email: event.lead?.emailAddress || null,
      campaign_external_id: event.campaignId?.toString() || null,
      event_data: event,
    });

    // Only process reply events
    if (eventType !== "EVERY_MESSAGE_REPLY_RECEIVED") {
      console.log(`Ignoring non-reply event: ${eventType}`);
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract lead data from HeyReach webhook payload
    const lead = event.lead || {};
    const conversation = event.conversation || {};

    const firstName = lead.firstName || "";
    const lastName = lead.lastName || "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
    const email = lead.emailAddress || null;
    const linkedinUrl = lead.profileUrl || lead.linkedInProfileUrl || null;
    const replyText = event.messageText || event.message || conversation.lastMessageText || "";

    // Use lead's HeyReach ID or LinkedIn URL as external_id
    const externalId = lead.id?.toString() || linkedinUrl || `heyreach-${Date.now()}`;

    // Conversation and account IDs for sending replies
    const conversationId = conversation.id?.toString() || event.conversationId?.toString() || null;
    const accountId = event.linkedInAccountId || conversation.linkedInAccountId || null;

    if (!replyText) {
      console.log("No reply text in event, skipping agent_leads upsert");
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert into agent_leads
    const { error: upsertError } = await supabase
      .from("agent_leads")
      .upsert(
        {
          user_id: integration.created_by,
          external_id: externalId,
          full_name: fullName,
          email,
          last_reply_text: replyText,
          inbox_status: "pending",
          channel: "linkedin",
          heyreach_conversation_id: conversationId,
          heyreach_account_id: accountId ? Number(accountId) : null,
          linkedin_url: linkedinUrl,
        },
        { onConflict: "user_id,external_id" }
      );

    if (upsertError) {
      console.error("agent_leads upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to save lead" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Upserted agent_lead for ${fullName || externalId} (linkedin)`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("HeyReach webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
