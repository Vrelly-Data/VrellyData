// [send-smartlead-email v1]
//
// Mirrors send-heyreach-message structurally — auth via user JWT (RLS
// enforced), single-integration-per-user lookup, agent_leads update on
// success, plaintext stored in reply_thread / HTML on the wire.
//
// Smartlead API:
//   POST /campaigns/{campaign_id}/reply-email-thread?api_key=KEY
//   Body: { lead_id (number), email_body (HTML), reply_message_id, reply_email_time (ISO) }
//
// Auth in the QUERY STRING — never log the full URL because it contains
// the credential. URL is built via URL + URLSearchParams so api_key is
// always properly encoded.
//
// Cross-channel schema parity:
//   - inbox_status: 'replied'  (matches send-heyreach-message)
//   - reply_thread role: 'sender' for outgoing (matches send-heyreach-message;
//     smartlead-webhook writes role='prospect' for incoming)
//   - Accepts both `leadId` and `lead_id` in the body so the D4 dispatcher
//     can call this and send-heyreach-message with one body shape.

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

// HTML escape for the plaintext path so a draft like "I love <3" doesn't
// emit broken HTML. Skip ' / " — they're safe in body content and look
// noisy when rendered raw if the receiving client doesn't decode them.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapAsHtml(message: string): string {
  const trimmed = message.trim();
  // If the caller gave us HTML (UI editor, future rich-text), trust it.
  if (trimmed.startsWith("<")) return trimmed;
  // Otherwise wrap a single <p> with <br> per newline.
  return `<p>${escapeHtml(trimmed).replace(/\r?\n/g, "<br>")}</p>`;
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
    const message: string | undefined = body.message;

    if (!leadId || !message) {
      throw new Error("Missing required fields: leadId, message");
    }

    // Fetch the agent_leads row for this user. RLS already scopes to user_id,
    // but we keep the explicit eq() to match send-heyreach-message and to
    // produce a clearer 'not found' error vs 'access denied'.
    const { data: lead, error: leadError } = await supabase
      .from("agent_leads")
      .select(
        "channel, smartlead_lead_id, smartlead_campaign_id, smartlead_email_stats_id, reply_message_id, reply_thread",
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
            `Use send-heyreach-message for LinkedIn leads.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (
      !lead.smartlead_lead_id ||
      !lead.smartlead_campaign_id ||
      !lead.reply_message_id ||
      !lead.smartlead_email_stats_id
    ) {
      // smartlead_email_stats_id is undocumented but required by Smartlead's
      // reply-email-thread endpoint. Leads that pre-date the column being
      // captured (rows landed before 2026-04-27) won't have it; user will
      // need a fresh webhook event for those before they can be replied to.
      throw new Error(
        "Lead is missing required Smartlead identifiers (smartlead_lead_id, smartlead_campaign_id, reply_message_id, or smartlead_email_stats_id)",
      );
    }

    // Single-integration-per-user lookup, mirroring send-heyreach-message.
    // Multi-integration disambiguation (would need synced_campaigns join)
    // is intentionally out of scope here.
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
    const emailBody = wrapAsHtml(String(message));
    const sentAt = new Date().toISOString();

    // Build the URL with URLSearchParams so api_key is properly encoded.
    // NEVER log this URL anywhere — it contains the credential.
    const url = new URL(
      `${SMARTLEAD_API_BASE}/campaigns/${encodeURIComponent(lead.smartlead_campaign_id)}/reply-email-thread`,
    );
    url.searchParams.set("api_key", apiKey);

    const smartleadResponse = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        // lead_id is documented as required but the live API rejects it
        // ("lead_id is not allowed"). email_stats_id appears to be the
        // canonical lead+message identifier on this endpoint. We still
        // validate that smartlead_lead_id exists on agent_leads (above)
        // as a sanity check on inbound data — just don't forward it.
        email_body: emailBody,
        reply_message_id: lead.reply_message_id,
        reply_email_time: sentAt,
        // Required by Smartlead but undocumented; captured from the
        // EMAIL_REPLY webhook payload (`stats_id`) and persisted on
        // agent_leads.smartlead_email_stats_id.
        email_stats_id: lead.smartlead_email_stats_id,
      }),
    });

    if (!smartleadResponse.ok) {
      const errorText = await smartleadResponse.text();
      // Log status + body snippet only — never the URL (contains api_key).
      console.error(
        "[send-smartlead-email v1] Smartlead API error:",
        smartleadResponse.status,
        errorText.substring(0, 500),
      );
      // Surface a trimmed body snippet to the caller for debugging without
      // leaking the full body (which Smartlead doesn't echo api_key in,
      // but defense in depth).
      throw new Error(
        `Smartlead API error (${smartleadResponse.status}): ${errorText.substring(0, 300)}`,
      );
    }

    // Append the sent message to reply_thread so it persists in the DB.
    // role='sender' matches send-heyreach-message; channel='email' matches
    // smartlead-webhook's incoming-message records. Read-then-write pattern
    // with the same small race window as send-heyreach-message — acceptable
    // for a single-user send flow.
    const existingThread = Array.isArray(lead.reply_thread) ? lead.reply_thread : [];
    const newMessage = {
      role: "sender",
      content: String(message),
      timestamp: sentAt,
      channel: "email",
    };
    const updatedThread = [...existingThread, newMessage];

    const { error: updateError } = await supabase
      .from("agent_leads")
      .update({
        draft_approved: true,
        inbox_status: "replied",
        reply_thread: updatedThread,
      })
      .eq("id", leadId)
      .eq("user_id", user.id);

    if (updateError) {
      // Smartlead already accepted the send; just log and continue.
      console.error(
        "[send-smartlead-email v1] Failed to update lead status:",
        updateError,
      );
    }

    return new Response(
      JSON.stringify({ success: true, sentAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[send-smartlead-email v1] error:", err);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
