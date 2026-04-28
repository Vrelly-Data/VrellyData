// [smartlead-webhook v2]
//
// Receives Smartlead webhooks. Primary event is EMAIL_REPLY; we also recognise
// (and gracefully skip) EMAIL_BOUNCE, LEAD_UNSUBSCRIBED, CAMPAIGN_COMPLETED,
// and LEAD_CATEGORY_UPDATED. Anything else is logged and 200-acknowledged so
// Smartlead doesn't retry.
//
// === Real payload shape (EMAIL_REPLY) =====================================
// Captured from a live test event. The named fields below are the canonical
// references — older v1 guesswork (lead.email, payload.reply_body, etc.) does
// NOT match the wire format. Examples:
//   {
//     "event_type": "EMAIL_REPLY",
//     "from_email": "rep@your-domain.com",        // sender mailbox (NOT prospect)
//     "to_email":   "prospect@example.com",       // prospect (the inversion gotcha)
//     "to_name":    "Jane Prospect",
//     "sl_lead_email": "prospect@example.com",    // canonical prospect email
//     "sl_email_lead_id": 121,                    // canonical lead id
//     "sl_email_lead_map_id": 1221,
//     "campaign_id": 100,
//     "campaign_name": "Link insertion",
//     "sent_message":  { "message_id": "<…>", "html": "…", "text": "…", "time": "ISO" },
//     "reply_message": { "message_id": "<…>", "html": "…", "text": "…", "time": "ISO" },
//     "secret_key":   "…",                        // body-level shared secret
//     "webhook_id":   100
//   }
//
// IMPORTANT inversion: from_email is the campaign's SENDER mailbox and
// to_email is the PROSPECT — opposite of what the names suggest in a
// reply context. Always use sl_lead_email as the canonical prospect address.
//
// === Auth ================================================================
// Primary check: URL query param  ?secret=<SMARTLEAD_WEBHOOK_SECRET>
// Optional defence-in-depth: body field  payload.secret_key === <SMARTLEAD_BODY_SECRET>
//
// The body check is OPT-IN — only enforced when SMARTLEAD_BODY_SECRET is
// configured. Smartlead's dashboard test payload sends the literal string
// "secretkey" as a placeholder, and at time of writing it isn't confirmed
// whether owners can pick a real value for that body field. Requiring a body
// match by default would risk rejecting real webhooks. Once we confirm
// Smartlead supports a configurable body secret, set SMARTLEAD_BODY_SECRET
// and the second check activates automatically.

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

// Strip the Zendesk-style "type your reply above this line" marker plus
// anything after it. Full quoted-chain stripping (Gmail/Outlook headers,
// "On <date> <name> wrote:" blocks, etc.) is deferred to Phase C in
// classify-reply preprocessing.
function stripZendeskMarker(text: string): string {
  if (!text) return "";
  const markerRe = /##-\s*Please type your reply above this line\s*-##/i;
  const idx = text.search(markerRe);
  return (idx >= 0 ? text.slice(0, idx) : text).trim();
}

const SKIPPABLE_EVENTS = new Set([
  "EMAIL_BOUNCE",
  "LEAD_UNSUBSCRIBED",
  "CAMPAIGN_COMPLETED",
  "LEAD_CATEGORY_UPDATED",
]);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === Auth check 1: URL query secret =====================================
    const url = new URL(req.url);
    const providedUrlSecret = url.searchParams.get("secret");
    const expectedUrlSecret = Deno.env.get("SMARTLEAD_WEBHOOK_SECRET");

    if (!expectedUrlSecret) {
      console.error(
        "[smartlead-webhook v2] SMARTLEAD_WEBHOOK_SECRET env var not set — refusing all requests until configured",
      );
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (providedUrlSecret !== expectedUrlSecret) {
      console.warn("[smartlead-webhook v2] URL secret mismatch — rejecting request");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Payload parsing ====================================================
    const rawText = await req.text();
    console.log(
      "[smartlead-webhook v2] Raw payload (first 2000 chars):",
      rawText.substring(0, 2000),
    );

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawText);
    } catch {
      console.error("[smartlead-webhook v2] Invalid JSON payload");
      return new Response(
        JSON.stringify({ success: false, error: "invalid_json" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Auth check 2 (optional): body-level secret ========================
    // Opt-in defence-in-depth. Only enforced when SMARTLEAD_BODY_SECRET is
    // explicitly set. Reasoning lives in the top-of-file docstring; tl;dr:
    // Smartlead test payloads use a literal "secretkey" placeholder and
    // configurability isn't yet confirmed, so we don't enforce by default.
    const expectedBodySecret = Deno.env.get("SMARTLEAD_BODY_SECRET");

    if (expectedBodySecret) {
      console.log(
        "[smartlead-webhook v2] Body secret check: ENABLED (SMARTLEAD_BODY_SECRET set)",
      );
      const providedBodySecret =
        (payload.secret_key as string | undefined) ?? null;

      if (providedBodySecret !== expectedBodySecret) {
        console.warn(
          "[smartlead-webhook v2] Body secret_key mismatch — rejecting request",
        );
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.log(
        "[smartlead-webhook v2] Body secret check: SKIPPED (SMARTLEAD_BODY_SECRET unset — URL-only auth mode)",
      );
    }

    // === Event type detection ===============================================
    const eventType = ((payload.event_type as string) || "unknown").toString();
    console.log(`[smartlead-webhook v2] eventType="${eventType}"`);

    // === DB client ==========================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Always log the raw event before filtering. integration_id / team_id are
    // resolved further down; webhook_events.team_id and integration_id NOT
    // NULL constraint fix is tracked separately.
    try {
      await supabase.from("webhook_events").insert({
        integration_id: null,
        team_id: null,
        event_type: `smartlead:${eventType}`,
        event_data: payload,
      });
    } catch (logErr) {
      console.warn(
        "[smartlead-webhook v2] webhook_events insert failed (non-fatal):",
        logErr,
      );
    }

    // === Skip non-reply events gracefully ===================================
    if (SKIPPABLE_EVENTS.has(eventType)) {
      console.log(
        `[smartlead-webhook v2] Event "${eventType}" recognised but not actioned — acknowledged`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "non_reply_event", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (eventType !== "EMAIL_REPLY") {
      console.log(
        `[smartlead-webhook v2] Unrecognised eventType "${eventType}" — acknowledged but not processed`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "unknown_event", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === EMAIL_REPLY extraction =============================================
    const replyMessage =
      (payload.reply_message as Record<string, unknown> | undefined) ?? {};

    const emailRaw =
      (payload.sl_lead_email as string | undefined) ??
      (payload.to_email as string | undefined) ??
      null;
    const email = emailRaw ? emailRaw.toLowerCase() : null;

    const fullName = (payload.to_name as string | undefined) ?? null;

    const smartleadLeadId =
      payload.sl_email_lead_id !== undefined && payload.sl_email_lead_id !== null
        ? String(payload.sl_email_lead_id)
        : null;
    const smartleadCampaignId =
      payload.campaign_id !== undefined && payload.campaign_id !== null
        ? String(payload.campaign_id)
        : null;
    const lastCampaignName = (payload.campaign_name as string | undefined) ?? null;

    const replyMessageId = (replyMessage.message_id as string | undefined) ?? null;
    const replyHtml = (replyMessage.html as string | undefined) ?? null;
    const replyTextRaw = (replyMessage.text as string | undefined) ?? null;
    const replyTimestamp =
      (replyMessage.time as string | undefined) ?? new Date().toISOString();

    // email_stats_id: undocumented but required by Smartlead's
    // POST /campaigns/{id}/reply-email-thread endpoint. The webhook payload
    // ships it as `stats_id` (top-level); we tolerate a few likely synonyms
    // in case Smartlead changes the name. Stored on agent_leads so
    // send-smartlead-email can forward it.
    const smartleadEmailStatsId =
      ((payload.stats_id ??
        payload.email_stats_id ??
        (replyMessage.stats_id as unknown)) as string | number | undefined) !==
      undefined
        ? String(
            payload.stats_id ??
              payload.email_stats_id ??
              (replyMessage.stats_id as unknown),
          )
        : null;

    // Prefer the plain-text body; fall back to a quick HTML-strip if Smartlead
    // ever omits .text. Zendesk-style "type your reply above this line" marker
    // and anything after it is dropped here; full quoted-chain stripping is
    // Phase C work in classify-reply preprocessing.
    const replyText = stripZendeskMarker(
      replyTextRaw ??
        (replyHtml
          ? replyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
          : ""),
    );

    if (!email) {
      console.warn(
        "[smartlead-webhook v2] No prospect email in EMAIL_REPLY payload — skipping",
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "no_email", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Route to an integration ============================================
    // Smartlead payload doesn't expose which integration in our DB it maps
    // to. Pick the first active Smartlead integration for now; multi-
    // integration disambiguation can be added later via API-key hashing or
    // a per-integration webhook secret.
    const { data: integration } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, created_by")
      .eq("platform", "smartlead")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!integration?.created_by || !integration?.team_id) {
      console.warn(
        "[smartlead-webhook v2] No active Smartlead integration — cannot route lead",
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "no_active_integration", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Build reply_thread (single-message for now) ========================
    // heyreach-webhook builds the full thread from event.recent_messages.
    // Smartlead's EMAIL_REPLY payload only carries the latest reply_message
    // (and an unrelated sent_message), so we record just the prospect's
    // message. Phase C may stitch in earlier messages from Smartlead's
    // history endpoints if/when needed.
    const replyThread = [
      {
        role: "prospect",
        content: replyText,
        timestamp: replyTimestamp,
        channel: "email",
      },
    ];

    // === Upsert agent_leads =================================================
    // external_id = lowercased canonical prospect email. Stable per prospect;
    // matches the conflict key used by heyreach-webhook.
    const externalId = email;

    const { data: upsertedLead, error: upsertError } = await supabase
      .from("agent_leads")
      .upsert(
        {
          user_id: integration.created_by,
          external_id: externalId,
          email,
          email_address: email,
          full_name: fullName,
          channel: "email",
          smartlead_lead_id: smartleadLeadId,
          smartlead_campaign_id: smartleadCampaignId,
          smartlead_email_stats_id: smartleadEmailStatsId,
          last_campaign_name: lastCampaignName,
          reply_message_id: replyMessageId,
          last_reply_text: replyText,
          last_reply_raw_html: replyHtml,
          last_reply_at: replyTimestamp,
          reply_thread: replyThread,
          inbox_status: "pending",
        },
        { onConflict: "user_id,external_id" },
      )
      .select("id")
      .single();

    if (upsertError) {
      console.error("[smartlead-webhook v2] agent_leads upsert error:", upsertError);
      // 200 so Smartlead doesn't retry; we've logged for investigation.
      return new Response(
        JSON.stringify({ success: false, error: "upsert_failed", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[smartlead-webhook v2] Upserted agent_lead ${upsertedLead?.id} for email=${email}`,
    );

    // === classify-reply (async) =============================================
    // Mirrors heyreach-webhook: fire classify-reply asynchronously via
    // EdgeRuntime.waitUntil so the webhook returns 200 to Smartlead fast.
    // Gated on an active agent_config — without one, classify-reply has no
    // sender persona / offer copy to work with, so we just leave the lead
    // as inbox_status='pending' for manual handling.
    //
    // Empty-text guard: Smartlead's dashboard test fixture (and rare real-
    // world cases like prospects replying with only quoted history) results
    // in replyText collapsing to "" after Zendesk-marker stripping. We
    // upsert the row regardless (metadata like smartlead_lead_id /
    // reply_message_id is still useful for the inbox) but skip classify-
    // reply, since classify-reply rejects empty reply_text with 400.
    if (upsertedLead?.id) {
      const hasReplyContent = !!replyText && replyText.trim().length > 0;

      if (!hasReplyContent) {
        console.log(
          `[smartlead-webhook v2] Empty reply text, skipping classification for lead ${upsertedLead.id}`,
        );
      } else {
        const { data: agentConfig } = await supabase
          .from("agent_configs")
          .select("*")
          .eq("user_id", integration.created_by)
          .eq("is_active", true)
          .maybeSingle();

        if (agentConfig) {
          const agentApiKey = Deno.env.get("AGENT_API_KEY") || "";
          const classifyPromise = fetch(
            `${supabaseUrl}/functions/v1/classify-reply`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-agent-key": agentApiKey,
              },
              body: JSON.stringify({
                reply_text: replyText,
                thread_history: replyThread,
                lead_id: upsertedLead.id,
                user_id: integration.created_by,
                channel: "email",
                agent_context: {
                  offer_description: agentConfig.offer_description,
                  desired_action: agentConfig.desired_action,
                  outcome_delivered: agentConfig.outcome_delivered,
                  target_icp: agentConfig.target_icp,
                  sender_name: agentConfig.sender_name,
                  sender_title: agentConfig.sender_title,
                  sender_bio: agentConfig.sender_bio,
                  company_name: agentConfig.company_name,
                  company_url: agentConfig.company_url,
                  communication_style: agentConfig.communication_style,
                  avoid_phrases: agentConfig.avoid_phrases || [],
                  sample_message: agentConfig.sample_message || "",
                },
              }),
            },
          ).catch((err) => {
            console.error("[smartlead-webhook v2] classify-reply invocation failed:", err);
          });

          // @ts-ignore — EdgeRuntime is injected by Supabase runtime
          if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
            // @ts-ignore
            EdgeRuntime.waitUntil(classifyPromise);
          } else {
            await classifyPromise;
          }
        } else {
          console.log(
            `[smartlead-webhook v2] No active agent_config for user ${integration.created_by} — skipping classify-reply`,
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, eventType, leadId: upsertedLead?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[smartlead-webhook v2] Fatal error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
