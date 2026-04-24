// [smartlead-webhook v1]
//
// Receives Smartlead webhooks (primary: "email reply received"). Smartlead
// doesn't document HMAC webhook signatures as of writing, so we use a
// shared-secret query param (?secret=<value>) gated by the
// SMARTLEAD_WEBHOOK_SECRET env var.
//
// The exact payload shape for "email reply received" is NOT documented in
// the Smartlead PDF. This first version:
//   1. Verbosely logs the raw payload + key-level types so the first real
//      webhook surfaces the actual structure in function logs.
//   2. Uses best-effort extraction against plausible snake_case / camelCase
//      field names (email, reply_message_id, campaign_id, lead_id, body).
//   3. Gracefully ignores non-reply events (bounced / unsubscribed / etc)
//      with a 200 response so Smartlead doesn't retry.
//   4. Always records the raw event in webhook_events before acting.
//
// classify-reply invocation is deferred to Phase C — Phase A is observation-
// only from a data-flow perspective.

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
    // === Auth: shared-secret query param ====================================
    const url = new URL(req.url);
    const providedSecret = url.searchParams.get("secret");
    const expectedSecret = Deno.env.get("SMARTLEAD_WEBHOOK_SECRET");

    if (!expectedSecret) {
      console.error(
        "[smartlead-webhook v1] SMARTLEAD_WEBHOOK_SECRET env var not set — refusing all requests until configured",
      );
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (providedSecret !== expectedSecret) {
      console.warn("[smartlead-webhook v1] Secret mismatch — rejecting request");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Payload parsing ====================================================
    const rawText = await req.text();
    console.log(
      "[smartlead-webhook v1] Raw payload (first 2000 chars):",
      rawText.substring(0, 2000),
    );

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawText);
    } catch {
      console.error("[smartlead-webhook v1] Invalid JSON payload");
      // Return 200 so Smartlead doesn't retry a malformed request forever.
      return new Response(
        JSON.stringify({ success: false, error: "invalid_json" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Shape diagnostics — will confirm or refute the field-name assumptions
    // below on the first real webhook.
    const topLevelKeys = Object.keys(payload);
    const keyTypes = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        Array.isArray(v) ? `array[${v.length}]` : v === null ? "null" : typeof v,
      ]),
    );
    console.log("[smartlead-webhook v1] Top-level keys:", topLevelKeys);
    console.log("[smartlead-webhook v1] Key types:", keyTypes);

    // === Event type detection ===============================================
    // Try every plausible field name Smartlead might use.
    const eventType = (
      (payload.event_type as string) ||
      (payload.eventType as string) ||
      (payload.type as string) ||
      (payload.event as string) ||
      "unknown"
    ).toString();
    console.log(`[smartlead-webhook v1] eventType="${eventType}"`);

    // === DB client ==========================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Always log the raw event (before filtering / processing). integration_id
    // left null because we don't yet know how to derive it from the payload —
    // will be revisited once real payload shape is observed.
    try {
      await supabase.from("webhook_events").insert({
        integration_id: null,
        team_id: null,
        event_type: `smartlead:${eventType}`,
        event_data: payload,
      });
    } catch (logErr) {
      console.warn(
        "[smartlead-webhook v1] webhook_events insert failed (non-fatal):",
        logErr,
      );
    }

    // === Filter: reply-like events only =====================================
    const looksLikeReply =
      eventType.toLowerCase().includes("reply") ||
      !!payload.reply_message_id ||
      !!payload.email_body ||
      !!payload.reply_body;

    if (!looksLikeReply) {
      console.log(
        `[smartlead-webhook v1] Event "${eventType}" is not a reply — acknowledged but skipped`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "not_a_reply", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Best-effort payload extraction =====================================
    // These paths are GUESSES. Once the first real webhook lands in the logs,
    // refactor this block to match the observed field names.
    const lead = (payload.lead as Record<string, unknown>) ?? {};

    const emailRaw =
      (lead.email as string | undefined) ??
      (lead.email_address as string | undefined) ??
      (payload.email as string | undefined) ??
      (payload.to_email as string | undefined) ??
      null;
    const email = emailRaw ? emailRaw.toLowerCase() : null;

    const firstName =
      (lead.first_name as string | undefined) ??
      (lead.firstName as string | undefined) ??
      null;
    const lastName =
      (lead.last_name as string | undefined) ??
      (lead.lastName as string | undefined) ??
      null;
    const company =
      (lead.company_name as string | undefined) ??
      (lead.company as string | undefined) ??
      null;
    const jobTitle =
      (lead.position as string | undefined) ??
      (lead.title as string | undefined) ??
      null;

    const smartleadLeadId =
      ((payload.lead_id ?? payload.leadId ?? lead.id) as
        | string
        | number
        | undefined)?.toString() ?? null;
    const smartleadCampaignId =
      ((payload.campaign_id ?? payload.campaignId) as
        | string
        | number
        | undefined)?.toString() ?? null;
    const replyMessageId =
      ((payload.reply_message_id ?? payload.message_id) as
        | string
        | number
        | undefined)?.toString() ?? null;

    // Reply body: stripped text for display + raw HTML for debugging.
    // Thorough HTML / quoted-chain stripping (Phase C) replaces this basic regex.
    const rawHtml =
      (payload.reply_body as string | undefined) ??
      (payload.email_body as string | undefined) ??
      (payload.body as string | undefined) ??
      null;
    const replyText = rawHtml
      ? rawHtml
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";

    if (!email) {
      console.warn(
        "[smartlead-webhook v1] No email address in reply payload — skipping upsert. Keys:",
        topLevelKeys,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "no_email", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Route to an integration ============================================
    // Smartlead payload doesn't expose which integration in our DB it maps
    // to. For Phase A, pick the first active Smartlead integration; multi-
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
        "[smartlead-webhook v1] No active Smartlead integration — cannot route lead",
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "no_active_integration", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Upsert agent_leads =================================================
    // external_id = lowercased email. Stable per prospect; matches the
    // conflict key pattern used by heyreach-webhook.
    const externalId = email;
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
    const nowIso = new Date().toISOString();

    const { data: upsertedLead, error: upsertError } = await supabase
      .from("agent_leads")
      .upsert(
        {
          user_id: integration.created_by,
          external_id: externalId,
          email,
          email_address: email,
          full_name: fullName,
          company,
          job_title: jobTitle,
          channel: "email",
          smartlead_lead_id: smartleadLeadId,
          smartlead_campaign_id: smartleadCampaignId,
          reply_message_id: replyMessageId,
          last_reply_text: replyText,
          last_reply_raw_html: rawHtml,
          last_reply_at: nowIso,
          inbox_status: "pending",
        },
        { onConflict: "user_id,external_id" },
      )
      .select("id")
      .single();

    if (upsertError) {
      console.error("[smartlead-webhook v1] agent_leads upsert error:", upsertError);
      // 200 so Smartlead doesn't retry; we've logged for investigation.
      return new Response(
        JSON.stringify({ success: false, error: "upsert_failed", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[smartlead-webhook v1] Upserted agent_lead ${upsertedLead?.id} for email=${email}`,
    );

    // classify-reply invocation intentionally deferred to Phase C.

    return new Response(
      JSON.stringify({ success: true, eventType, leadId: upsertedLead?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[smartlead-webhook v1] Fatal error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
