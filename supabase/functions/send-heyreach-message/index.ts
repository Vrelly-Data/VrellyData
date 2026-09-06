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
      "authorization, x-client-info, apikey, content-type, x-agent-key",
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
    const agentKey = req.headers.get("x-agent-key");
    const expectedKey = Deno.env.get("AGENT_API_KEY");

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    // Auth: UI JWT OR service-level x-agent-key (requires user_id)
    let userId: string | null = null;
    let dbClient: ReturnType<typeof createClient> | null = null;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
      dbClient = supabaseUser;
    } else if (agentKey && expectedKey && agentKey === expectedKey) {
      if (!body?.user_id) {
        return new Response(
          JSON.stringify({ error: "Missing user_id for service auth" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = String(body.user_id);
      dbClient = serviceSupabase;
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { lead_id } = body;
    const message = stripBraceWrapper(String(body.message ?? ""));
    const isAuto = body?.auto === true;

    if (!lead_id || !message) {
      throw new Error("Missing required fields: lead_id, message");
    }

    // Fetch the agent_leads row for this user
    const { data: lead, error: leadError } = await dbClient
      .from("agent_leads")
      .select("heyreach_conversation_id, heyreach_account_id, reply_thread, disposition_tag, full_name, company")
      .eq("id", lead_id)
      .eq("user_id", userId)
      .single();

    if (leadError || !lead) {
      throw new Error("Lead not found or access denied");
    }

    // Suppress opted-out contacts (compliance)
    if (lead.disposition_tag === "opted_out") {
      return new Response(
        JSON.stringify({
          success: false,
          handled: true,
          code: "contact_opted_out",
          message: "This contact has opted out and can't be messaged — reply not sent",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.heyreach_conversation_id || !lead.heyreach_account_id) {
      throw new Error("Lead is missing HeyReach conversation or account ID");
    }

    // Get HeyReach API key from outbound_integrations
    const { data: integration, error: integrationError } = await dbClient
      .from("outbound_integrations")
      .select("api_key_encrypted")
      .eq("platform", "heyreach")
      .eq("created_by", userId)
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
    const sentAtIso = new Date().toISOString();
    const newMessage = {
      role: "sender",
      content: message,
      timestamp: sentAtIso,
      channel: "linkedin",
    };
    const updatedThread = [...existingThread, newMessage];

    // Update agent_leads on success
    const { error: updateError } = await dbClient
      .from("agent_leads")
      .update({
        draft_approved: true,
        inbox_status: "replied",
        ...(isAuto ? { auto_handled: true } : {}),
        reply_thread: updatedThread,
      })
      .eq("id", lead_id)
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to update lead status:", updateError);
    }

    // Add activity record when auto-sent
    if (isAuto) {
      try {
        const { data: cfg } = await dbClient
          .from("agent_configs")
          .select("id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();
        await dbClient.from("agent_activity").insert({
          user_id: userId,
          agent_config_id: cfg?.id ?? null,
          lead_id,
          lead_name: lead.full_name ?? null,
          lead_company: lead.company ?? null,
          activity_type: "message_sent",
          description: `Reply sent to ${lead.full_name ?? ""} via HeyReach`,
          metadata: { channel: "linkedin", sent_by: "auto" },
        });
      } catch (e) {
        console.warn("[send-heyreach-message] activity insert failed (non-fatal):", e);
      }
    }

    // Best-effort: record 'sent' inference event (non-blocking)
    try {
      // Re-fetch minimal fields needed for attribution and person key
      const { data: leadRow } = await dbClient
        .from("agent_leads")
        .select("id, full_name, email, job_title, company, linkedin_url, reply_thread")
        .eq("id", lead_id)
        .eq("user_id", userId)
        .maybeSingle();
      const personKey =
        (leadRow?.email && String(leadRow.email).trim() ? String(leadRow.email).trim().toLowerCase() : "") ||
        (leadRow?.linkedin_url && String(leadRow.linkedin_url).trim() ? String(leadRow.linkedin_url).trim() : "") ||
        String(lead_id);
      if (personKey) {
        const fp = await computeCopyFingerprint(message, null);
        const occurredAt = sentAtIso;
        // Look up last campaign name if any was set earlier (optional)
        const { data: namedCampaign } = await dbClient
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
          .eq("created_by", userId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        const { computeSentSourceId } = await import("../_shared/sent-source-id.ts");
        const sentSourceId = await computeSentSourceId({
          provider: "heyreach",
          personKey,
          occurredAt,
          providerThreadId: conversationId ? String(conversationId) : null,
          providerMessageId: null,
          copyFingerprint: fp,
          tag: "direct_linkedin_message"
        });
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
            source_row_id: sentSourceId,
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
