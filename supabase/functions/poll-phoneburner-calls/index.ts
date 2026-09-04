// [poll-phoneburner-calls]
//
// Poll recent PhoneBurner dial sessions and upsert call events into
// dialer_events. Best‑effort writes to inference_events for teachable
// dispositions. Strictly additive — never touches agent_leads or inbox.
//
// Matching policy (product decision):
// - MATCH-ONLY: attach calls to existing people/leads by email (preferred) or
//   leave person_key null. Do NOT create new people/contacts/leads.
// - No dependency on a full PhoneBurner contacts sync. We do not rely on
//   phoneburner_contacts for matching.
//
// Window: last N days (default 2). Times on the API are US Central; the
// poll uses UTC ISO strings and treats them as inclusive bounds.

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
      "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

const PB_API_BASE = "https://www.phoneburner.com/rest/1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toIso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function normalizePhoneE164(input: unknown): string | null {
  const s = typeof input === "string" ? input : String(input ?? "");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

type MappedInference =
  | { event_type: "meeting_booked"; intent?: null; reason: string }
  | { event_type: "classified"; intent: "not_interested"; reason: string }
  | { event_type: "opted_out"; intent?: null; reason: string }
  | null;

function mapDispositionToInference(raw: unknown): MappedInference {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  // Negative/noise guard — skip common non-outcome dispositions
  const noise = ["no answer", "left message", "left vm", "busy", "callback", "call back", "wrong number"];
  if (noise.some((k) => s.includes(k))) return null;
  // Appointment / meeting booked
  if (["appointment", "appt", "meeting", "booked", "scheduled"].some((k) => s.includes(k))) {
    return { event_type: "meeting_booked", reason: "dialer_disposition" };
  }
  // Explicit DNC
  if (s.includes("dnc") || s.includes("do not call") || s.includes("do-not-call")) {
    return { event_type: "opted_out", reason: "dialer_disposition" };
  }
  // Not interested class
  if (["not interested", "no interest", "not a fit", "no fit", "no thanks", "no thank"].some((k) => s.includes(k))) {
    return { event_type: "classified", intent: "not_interested", reason: "dialer_disposition" };
  }
  return null;
}

async function fetchJson(token: string, path: string, qs?: Record<string, string | number | undefined>) {
  const url = new URL(`${PB_API_BASE}${path}`);
  for (const [k, v] of Object.entries(qs || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} error (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let integrationId: string | undefined;
  let lookbackDays: number = 2;
  try {
    const body = await req.json().catch(() => ({}));
    integrationId = body.integrationId;
    lookbackDays = Number(body.lookbackDays ?? 2);
    if (!integrationId) {
      return new Response(JSON.stringify({ error: "Missing integrationId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth mode
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternal = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const db = isInternal ? serviceClient : userClient;

    // Load integration
    const { data: integration, error: intErr } = await db
      .from("outbound_integrations")
      .select("id, team_id, platform, api_key_encrypted")
      .eq("id", integrationId)
      .single();
    if (intErr || !integration) throw new Error("Integration not found or access denied");
    if ((integration.platform || "").toLowerCase() !== "phoneburner") {
      throw new Error("Integration is not a PhoneBurner connection");
    }
    const teamId: string = integration.team_id;
    const token: string = integration.api_key_encrypted;

    // Window
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);
    const date_start = toIso(start);
    const date_end = toIso(end);

    // 1) List dial sessions
    const dsList = await fetchJson(token, "/dialsession", { date_start, date_end });
    try {
      console.log(`[poll-phoneburner-calls] list keys:`, Object.keys(dsList || {}));
    } catch { /* ignore */ }
    // Official selector observed: dialsessions (plural). Be defensive.
    const sessions: Array<{ id?: string | number }> =
      Array.isArray(dsList?.dialsessions) ? dsList.dialsessions :
      Array.isArray(dsList?.dial_sessions) ? dsList.dial_sessions :
      Array.isArray(dsList?.dialsession?.dialsessions) ? dsList.dialsession.dialsessions :
      Array.isArray(dsList) ? dsList :
      Array.isArray(dsList?.items) ? dsList.items :
      Array.isArray(dsList?.data) ? dsList.data : [];
    const sessionIds = sessions
      .map((s) => (s?.id != null ? String(s.id) : null))
      .filter((v): v is string => !!v);
    console.log(`[poll-phoneburner-calls] integration=${integrationId} sessions=${sessionIds.length} window=${date_start}..${date_end}`);

    let eventsUpserted = 0;
    let inferenceWritten = 0;

    for (const sid of sessionIds) {
      const detail = await fetchJson(token, `/dialsession/${encodeURIComponent(sid)}`);
      // Detail can be a wrapper: { dialsession: { calls: [...] } }
      const calls: any[] =
        Array.isArray(detail?.dialsession?.calls) ? detail.dialsession.calls :
        Array.isArray(detail?.dial_session?.calls) ? detail.dial_session.calls :
        Array.isArray(detail) ? detail :
        Array.isArray(detail?.calls) ? detail.calls :
        Array.isArray(detail?.data) ? detail.data : [];
      for (const c of calls) {
        const callId = String(c?.call_id ?? c?.id ?? "");
        if (!callId) continue;
        const rawPhone = c?.phone ?? c?.to ?? c?.dialed ?? null;
        const phoneE164 = normalizePhoneE164(rawPhone);
        const disposition = c?.disposition ?? c?.status ?? null;
        const connected = Boolean(c?.connected ?? (typeof c?.answered === "boolean" ? c.answered : undefined));
        const voicemail = Boolean(c?.voicemail ?? (typeof c?.left_voicemail === "boolean" ? c.left_voicemail : undefined));
        const duration = typeof c?.duration_seconds === "number" ? c.duration_seconds
          : typeof c?.duration === "number" ? c.duration
          : null;
        const note = typeof c?.note === "string" ? c.note : null;
        const occurredAt = c?.ended_at || c?.connected_at || c?.started_at || c?.time || new Date().toISOString();
        const recordingUrl = typeof c?.recording_url === "string" ? c.recording_url : null;

        // Person match: MATCH-ONLY against existing people by email.
        // Try several common fields from PhoneBurner responses for email.
        const emailVal =
          c?.email ??
          c?.email_address ??
          c?.contact_email ??
          c?.primary_email?.email_address ??
          c?.contact?.email ??
          c?.lead?.email_address ??
          c?.lead?.email ??
          null;
        const emailLower = (typeof emailVal === "string" && emailVal.includes("@"))
          ? String(emailVal).trim().toLowerCase()
          : null;

        let personKey: string | null = null;
        // Match only if this email already exists in people for the team.
        if (emailLower) {
          const { data: hit } = await serviceClient
            .from("people")
            .select("person_key")
            .eq("team_id", teamId)
            .eq("email", emailLower)
            .limit(1)
            .maybeSingle();
          if (hit?.person_key) {
            personKey = emailLower; // normalized email is our person_key convention
          }
        }

        // Upsert dialer_events
        const row = {
          integration_id: integrationId,
          team_id: teamId,
          person_key: personKey,
          pb_contact_id: null as string | null, // no dependency on phoneburner_contacts
          phone_e164: phoneE164,
          call_id: callId,
          dialsession_id: sid,
          disposition: disposition,
          connected,
          voicemail,
          duration_seconds: duration,
          note,
          recording_url: recordingUrl,
          occurred_at: new Date(occurredAt).toISOString(),
          source: "poll" as const,
          raw: c,
        };
        const { error: upErr } = await serviceClient
          .from("dialer_events")
          .upsert(row, { onConflict: "integration_id,call_id" });
        if (!upErr) eventsUpserted++;

        // Best-effort inference write
        const mapped = mapDispositionToInference(disposition);
        if (mapped && personKey) {
          const { error: ieErr } = await serviceClient.from("inference_events").insert({
            team_id: teamId,
            person_key: personKey,
            email: personKey.includes("@") ? personKey : null,
            channel: "other",                 // Optional CHECK-widen not shipped; use 'other' + call step
            sequence_step_type: "call",
            event_type: mapped.event_type,
            intent: "intent" in mapped ? mapped.intent : null,
            occurred_at: new Date(occurredAt).toISOString(),
            source: "poll_phoneburner_calls",
            source_row_id: callId,
            metadata: { disposition, reason: mapped.reason, dialsession_id: sid, phone_e164: phoneE164 },
          });
          if (!ieErr) inferenceWritten++;
        }
      }
      await sleep(150);
    }

    // Clear 'syncing' if this poll was invoked during connect and no other
    // function has finalized status yet. Only transition syncing->synced here.
    try {
      const { data: row } = await serviceClient
        .from("outbound_integrations")
        .select("sync_status")
        .eq("id", integrationId)
        .single();
      if ((row?.sync_status || "").toLowerCase() === "syncing") {
        await serviceClient
          .from("outbound_integrations")
          .update({
            sync_status: "synced",
            sync_error: null,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", integrationId);
      }
    } catch (e) {
      console.warn("[poll-phoneburner-calls] failed to finalize syncing status:", e);
    }

    return new Response(JSON.stringify({
      success: true,
      sessions: sessionIds.length,
      eventsUpserted,
      inferenceWritten,
      window: { date_start, date_end },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[poll-phoneburner-calls] error:", msg);
    // Only mark error if status is still 'syncing' (connect-time clear)
    try {
      if (integrationId) {
        const serviceClient = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );
        const { data: row } = await serviceClient
          .from("outbound_integrations")
          .select("sync_status")
          .eq("id", integrationId)
          .single();
        if ((row?.sync_status || "").toLowerCase() === "syncing") {
          await serviceClient
            .from("outbound_integrations")
            .update({ sync_status: "error", sync_error: msg, updated_at: new Date().toISOString() })
            .eq("id", integrationId);
        }
      }
    } catch (e) {
      console.warn("[poll-phoneburner-calls] failed to record error status:", e);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

