import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeCopyFingerprint } from "../_shared/copy-fingerprint.ts";

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

// Defensive strip — see add-to-heyreach-campaign for context.
function stripBraceWrapper(s: string): string {
  if (!s) return s;
  return s.trim().replace(/^\{+/, "").replace(/\}+$/, "").trim();
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

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
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
    const { lead_id } = body;
    const message = stripBraceWrapper(String(body.message ?? ""));

    if (!lead_id || !message) {
      throw new Error("Missing required fields: lead_id, message");
    }

    // Fetch the agent_leads row for this user
    const { data: lead, error: leadError } = await supabase
      .from("agent_leads")
      .select("heyreach_conversation_id, heyreach_account_id, reply_thread")
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

    // Append the sent message to reply_thread so it persists in the DB
    // (the HeyReach webhook only rewrites reply_thread on INCOMING replies,
    // so without this the outgoing message would only exist in the React
    // Query optimistic cache and disappear on next server refetch).
    // Read-then-write pattern; small race window on concurrent sends to
    // the same lead, acceptable for a single-user send flow.
    const existingThread = Array.isArray(lead.reply_thread) ? lead.reply_thread : [];
    const newMessage = {
      role: "sender",
      content: message,
      timestamp: new Date().toISOString(),
      channel: "linkedin",
    };
    const updatedThread = [...existingThread, newMessage];

    // Update agent_leads on success
    const { error: updateError } = await supabase
      .from("agent_leads")
      .update({
        draft_approved: true,
        inbox_status: "replied",
        reply_thread: updatedThread,
      })
      .eq("id", lead_id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Failed to update lead status:", updateError);
    }

    // Best-effort: record 'sent' inference event (non-blocking)
    try {
      // Re-fetch minimal fields needed for attribution and person key
      const { data: leadRow } = await supabase
        .from("agent_leads")
        .select("id, full_name, email, job_title, company, linkedin_url, reply_thread")
        .eq("id", lead_id)
        .eq("user_id", user.id)
        .maybeSingle();
      const personKey =
        (leadRow?.email && String(leadRow.email).trim() ? String(leadRow.email).trim().toLowerCase() : "") ||
        (leadRow?.linkedin_url && String(leadRow.linkedin_url).trim() ? String(leadRow.linkedin_url).trim() : "") ||
        String(lead_id);
      if (personKey) {
        const fp = await computeCopyFingerprint(message, null);
        const occurredAt = new Date().toISOString();
        // Look up last campaign name if any was set earlier (optional)
        const { data: namedCampaign } = await supabase
          .from("agent_leads")
          .select("last_campaign_name")
          .eq("id", lead_id)
          .maybeSingle();
        // Resolve conversation/account ids for normalized metadata
        const conversationId = lead.heyreach_conversation_id ?? null;
        const accountId = lead.heyreach_account_id ?? null;
        // Fetch team_id (single HeyReach integration per user)
        const { data: intRow } = await serviceSupabase
          .from("outbound_integrations")
          .select("team_id")
          .eq("platform", "heyreach")
          .eq("created_by", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        await serviceSupabase.from("inference_events")
          // @ts-ignore onConflict supports column-list
          .upsert({
            team_id: intRow?.team_id ?? null,
            agent_config_id: null,
            person_key: personKey,
            email: leadRow?.email ? String(leadRow.email).trim().toLowerCase() : null,
            linkedin_url: leadRow?.linkedin_url ?? null,
            full_name: leadRow?.full_name ?? null,
            job_title: leadRow?.job_title ?? null,
            company_name: leadRow?.company ?? null,
            channel: "linkedin",
            campaign_external_id: null,
            campaign_name: (namedCampaign as any)?.last_campaign_name ?? null,
            sequence_step_type: "linkedin_message",
            copy_fingerprint: fp,
            subject: null,
            event_type: "sent",
            intent: null,
            is_objection: null,
            pipeline_stage: null,
            disposition_tag: null,
            occurred_at: occurredAt,
            source: "send_heyreach_message",
            source_row_id: String(lead_id),
            metadata: {
              provider: "heyreach",
              path: "direct_linkedin_message",
              outbound_message: message,
              provider_thread_id: conversationId ? String(conversationId) : null,
              provider_message_id: null,
              conversation_id: conversationId ? String(conversationId) : null,
              account_id: accountId != null ? Number(accountId) : null
            }
          }, { onConflict: "source,source_row_id,event_type" });
      }
    } catch (e) {
      console.warn("[send-heyreach-message] inference_events write failed (non-fatal):", e);
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
