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
    const { lead_id, message } = body;

    if (!lead_id || !message) {
      throw new Error("Missing required fields: lead_id, message");
    }

    // Fetch the agent_leads row for this user
    const { data: lead, error: leadError } = await supabase
      .from("agent_leads")
      .select("heyreach_conversation_id, heyreach_account_id")
      .eq("id", lead_id)
      .eq("user_id", user.id)
      .single();

    if (leadError || !lead) {
      throw new Error("Lead not found or access denied");
    }

    if (!lead.heyreach_conversation_id || !lead.heyreach_account_id) {
      throw new Error("Lead is missing HeyReach conversation or account ID");
    }

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

    // Send message via HeyReach API
    const heyreachResponse = await fetch(
      "https://api.heyreach.io/api/public/inbox/SendMessage",
      {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          conversationId: lead.heyreach_conversation_id,
          linkedInAccountId: Number(lead.heyreach_account_id),
        }),
      }
    );

    if (!heyreachResponse.ok) {
      const errorText = await heyreachResponse.text();
      throw new Error(`HeyReach API error (${heyreachResponse.status}): ${errorText}`);
    }

    // Update agent_leads on success
    const { error: updateError } = await supabase
      .from("agent_leads")
      .update({ draft_approved: true, inbox_status: "replied" })
      .eq("id", lead_id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Failed to update lead status:", updateError);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Send HeyReach message error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
