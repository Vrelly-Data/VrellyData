// [calendly-webhook v1]
//
// Receives Calendly webhook events for invitees on scheduled events.
// Events handled:
// - invitee.created      → status 'scheduled'
// - invitee.canceled     → status 'canceled' (also accepts 'invitee_canceled')
//
// Policy:
// - MATCH-ONLY: attach bookings to existing people by email (team-scoped).
//   Never create new people/leads.
// - Upsert into public.calendly_events with source: 'webhook'
// - Best‑effort write to public.inference_events (meeting_booked) when matched.
//
// Routing/auth:
// - Attribute to an integration via either:
//   1) query param integration_id=<outbound_integrations.id>, or
//   2) query param t=<outbound_integrations.webhook_secret> (preferred when configured)
// - Optional URL gate: ?secret=<CALENDLY_WEBHOOK_SECRET> — if env var is set, it must match
// - No JWT required (public webhook endpoint) — verify_jwt=false in config.toml
//
// Notes:
// - Payload parsing is defensive across minor Calendly variations. We extract
//   scheduled_event_uuid / invitee_uuid from .../uri fields and email from the
//   invitee where present.
// - Signature verification (Calendly-Webhook-Signature) is not enforced here;
//   if needed, wire a per-integration signing key and HMAC validator in a
//   future revision. The URL-secret + per-integration token provide routing
//   and a basic auth layer today.

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

function extractUuidFromUri(uri: unknown): string | null {
  const s = typeof uri === "string" ? uri : String(uri ?? "");
  const m = s.match(/[a-f0-9-]{36}$/i);
  return m ? m[0] : null;
}

function normalizeEventName(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  return s.replace(/_/g, "."); // accept invitee_canceled as invitee.canceled
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Optional URL-wide secret (defence-in-depth, shared across integrations)
    const url = new URL(req.url);
    const providedUrlSecret = url.searchParams.get("secret");
    const expectedUrlSecret = Deno.env.get("CALENDLY_WEBHOOK_SECRET") || "";
    if (expectedUrlSecret) {
      if (!providedUrlSecret || providedUrlSecret !== expectedUrlSecret) {
        console.warn("[calendly-webhook] URL ?secret mismatch — rejecting");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Raw body used for logging and (future) signature verification
    const rawText = await req.text();
    if (!rawText || !rawText.trim()) {
      return new Response(JSON.stringify({ success: true, skipped: "empty_body" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch {
      console.error("[calendly-webhook] invalid JSON — acknowledging to prevent retries");
      return new Response(JSON.stringify({ success: true, skipped: "invalid_json" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventName = normalizeEventName(body?.event);
    // Primary Calendly events we care about
    const isInviteeCreated = eventName === "invitee.created";
    const isInviteeCanceled = eventName === "invitee.canceled";
    if (!isInviteeCreated && !isInviteeCanceled) {
      // Acknowledge unknown events so Calendly does not retry
      return new Response(JSON.stringify({ success: true, skipped: "unknown_event", event: eventName }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve integration by token (?t=) OR explicit id (?integration_id=)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const routingToken = url.searchParams.get("t");
    const integrationId = url.searchParams.get("integration_id");

    let integration: { id: string; team_id: string } | null = null;

    if (routingToken) {
      const { data } = await supabase
        .from("outbound_integrations")
        .select("id, team_id")
        .eq("platform", "calendly")
        .eq("is_active", true)
        .eq("webhook_secret", routingToken)
        .maybeSingle();
      integration = (data?.id && data?.team_id) ? { id: data.id, team_id: data.team_id } : null;
    } else if (integrationId) {
      const { data } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, platform, is_active")
        .eq("id", integrationId)
        .maybeSingle();
      if (data && (data.platform || "").toLowerCase() === "calendly" && data.is_active !== false) {
        integration = { id: String(data.id), team_id: String(data.team_id) };
      }
    }

    if (!integration) {
      console.warn("[calendly-webhook] Unroutable event — no integration matched token/id");
      return new Response(JSON.stringify({ success: true, skipped: "unroutable" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract identifiers and timestamps (defensive across minor variants)
    const payload = body?.payload ?? body ?? {};
    const eventObj = payload.event ?? payload.scheduled_event ?? {};
    const inviteeObj = payload.invitee ?? {};

    const scheduledEventUuid =
      extractUuidFromUri(eventObj?.uri) ??
      extractUuidFromUri(payload?.event?.uri) ??
      extractUuidFromUri(payload?.scheduled_event?.uri) ??
      null;
    const inviteeUuid =
      extractUuidFromUri(inviteeObj?.uri) ??
      extractUuidFromUri(payload?.invitee?.uri) ??
      null;
    const eventNameHuman: string | null =
      typeof eventObj?.name === "string" ? eventObj.name :
      typeof payload?.event_type?.name === "string" ? payload.event_type.name :
      null;
    const emailLower: string | null =
      typeof inviteeObj?.email === "string" && inviteeObj.email.includes("@")
        ? String(inviteeObj.email).trim().toLowerCase()
        : null;
    const startTimeRaw: string | null =
      typeof eventObj?.start_time === "string" ? eventObj.start_time :
      typeof payload?.start_time === "string" ? payload.start_time :
      null;
    const endTimeRaw: string | null =
      typeof eventObj?.end_time === "string" ? eventObj.end_time :
      typeof payload?.end_time === "string" ? payload.end_time :
      null;
    const canceledFlag: boolean =
      Boolean(inviteeObj?.canceled ?? inviteeObj?.cancellation ?? payload?.cancellation) ||
      isInviteeCanceled;

    // Determine normalized status
    let status: "scheduled" | "canceled" | "completed" = "scheduled";
    if (canceledFlag) {
      status = "canceled";
    } else if (endTimeRaw && new Date(endTimeRaw).getTime() < Date.now()) {
      status = "completed";
    }

    // Resolve person_key by email (MATCH-ONLY)
    let personKey: string | null = null;
    if (emailLower) {
      const { data: p } = await supabase
        .from("people")
        .select("person_key")
        .eq("team_id", integration.team_id)
        .eq("email", emailLower)
        .limit(1)
        .maybeSingle();
      if (p?.person_key) personKey = p.person_key;
    }

    // Upsert calendly_events
    const row = {
      integration_id: integration.id,
      team_id: integration.team_id,
      person_key: personKey,
      email: emailLower,
      scheduled_event_uuid: scheduledEventUuid,
      invitee_uuid: inviteeUuid,
      event_name: eventNameHuman,
      status,
      start_time: startTimeRaw ? new Date(startTimeRaw).toISOString() : null,
      end_time: endTimeRaw ? new Date(endTimeRaw).toISOString() : null,
      source: "webhook" as const,
      raw: body,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase
      .from("calendly_events")
      .upsert(row as any, { onConflict: "integration_id,invitee_uuid" });
    if (upErr) {
      console.error("[calendly-webhook] calendly_events upsert error:", upErr);
      // Acknowledge so Calendly does not retry forever; poller backfills
      return new Response(JSON.stringify({ success: true, warning: "upsert_failed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Best-effort inference write for new bookings
    if (status === "scheduled" && personKey) {
      const occurredAt =
        (startTimeRaw ? new Date(startTimeRaw).toISOString() : null) ||
        new Date().toISOString();
      const { error: ieErr } = await supabase.from("inference_events").insert({
        team_id: integration.team_id,
        person_key: personKey,
        email: emailLower,
        channel: "other",
        sequence_step_type: "meeting",
        event_type: "meeting_booked",
        intent: null,
        occurred_at: occurredAt,
        source: "calendly_webhook",
        source_row_id: inviteeUuid,
        metadata: { event_uuid: scheduledEventUuid, event_name: eventNameHuman },
      });
      if (ieErr) {
        console.warn("[calendly-webhook] inference_events insert failed (non-fatal):", ieErr);
      }
    }

    return new Response(JSON.stringify({ success: true, event: eventName, status }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[calendly-webhook] fatal:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ success: false, error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

