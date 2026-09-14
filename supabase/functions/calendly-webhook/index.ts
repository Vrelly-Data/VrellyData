// [calendly-webhook v1]
//
// Calendly webhook receiver — primary path for instant booking persistence.
// Events handled:
//   - invitee.created
//   - invitee.canceled
//
// Behavior:
//  - Requires ?integrationId=<uuid> in the URL (one endpoint per connected account)
//  - Optionally verifies signature with CALENDLY_WEBHOOK_SECRET (HMAC-SHA256)
//  - Upserts into public.calendly_events (additive; onConflict: integration_id,invitee_uuid)
//  - Matches to existing public.people by email (team-scoped). MATCH-ONLY.
//  - Sends notification email on creation when outbound_integrations.calendly_notify_emails is non-empty,
//    idempotent by calendly_events.notified_at (set exactly once).
//  - Never writes agent_leads or reply_thread. UI merges calendly_events into the timeline.
//
// Security:
//  - verify_jwt = false in config.toml (webhooks)
//  - Optional HMAC header verification:
//      Header: Calendly-Webhook-Signature: sha256=<hex>
//      Body: raw request body (as text)
//      Key: CALENDLY_WEBHOOK_SECRET (or omit to accept without signature)
//
// Notes:
//  - Payload shapes vary slightly between API versions; extract defensively.
//  - Cancel notifications are not sent in v1 — creation only (documented).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendTransactionalEmail } from "../_shared/email.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hmacSha256Hex(key: string, msg: string): string {
  const enc = new TextEncoder();
  const algoKey = crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // deno-lint-ignore no-explicit-any
  return (algoKey as any).then((k: CryptoKey) =>
    crypto.subtle.sign("HMAC", k, enc.encode(msg))
  ).then((buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

async function verifySignatureIfPresent(req: Request, rawBody: string): Promise<boolean> {
  const key = Deno.env.get("CALENDLY_WEBHOOK_SECRET") || "";
  const header = req.headers.get("Calendly-Webhook-Signature") || "";
  if (!key) {
    console.warn("[calendly-webhook] CALENDLY_WEBHOOK_SECRET not set — accepting without signature verification");
    return true;
  }
  if (!header) {
    console.error("[calendly-webhook] Missing Calendly-Webhook-Signature header");
    return false;
  }
  // Expected format: "sha256=<hex>"
  const m = header.match(/sha256=([a-f0-9]{64})/i);
  if (!m) {
    console.error("[calendly-webhook] Signature header present but unparsable");
    return false;
  }
  const expected = m[1].toLowerCase();
  const computed = (await hmacSha256Hex(key, rawBody)).toLowerCase();
  const ok = crypto.timingSafeEqual(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(computed),
  );
  if (!ok) {
    console.error("[calendly-webhook] Signature mismatch");
  }
  return ok;
}

type AnyJson = Record<string, unknown>;

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

function parseIsoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Extracts common fields from Calendly payload across invitee.created/canceled
function extractEventFields(body: AnyJson): {
  eventType: string;
  inviteeEmail: string | null;
  inviteeName: string | null;
  inviteeUuid: string | null;
  eventUuid: string | null;
  eventName: string | null;
  startTime: string | null;
  endTime: string | null;
  joinUrl: string | null;
} {
  const eventType = firstString(
    body?.event as string,
    (body?.["event_type"] as string),
  ) || "unknown";

  // Typical shapes (defensive):
  // body.payload.invitee.email / name / uri
  // body.payload.event.uuid / name / start_time / end_time / location
  const payload = (body?.payload ?? {}) as AnyJson;
  const invitee = (payload?.invitee ?? {}) as AnyJson;
  const calEvent = (payload?.event ?? payload?.scheduled_event ?? {}) as AnyJson;

  const inviteeEmail = firstString(invitee?.email);
  const inviteeName = firstString(invitee?.name);
  const inviteeUuid = firstString(
    invitee?.uuid,
    // Sometimes only a URI is present: https://api.calendly.com/scheduled_events/{eventUuid}/invitees/{inviteeUuid}
    (firstString(invitee?.uri)?.match(/invitees\/([a-f0-9\-]+)$/i) || [])[1],
  );

  const eventUuid = firstString(
    calEvent?.uuid,
    // Fallback from invitee.uri if it nests event uuid
    (firstString(invitee?.uri)?.match(/scheduled_events\/([a-f0-9\-]+)/i) || [])[1],
  );
  const eventName = firstString(calEvent?.name, payload?.event_type?.name as string);
  const startTime = parseIsoOrNull(calEvent?.start_time);
  const endTime = parseIsoOrNull(calEvent?.end_time);
  const joinUrl = firstString(
    (calEvent?.location as AnyJson)?.join_url as string,
    (payload?.location as AnyJson)?.join_url as string,
    (payload?.zoom_meeting_join_url as string),
  );

  return { eventType, inviteeEmail, inviteeName, inviteeUuid, eventUuid, eventName, startTime, endTime, joinUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Calendly-Webhook-Signature",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const integrationId = url.searchParams.get("integrationId");
  if (!integrationId) return json({ error: "integrationId is required in query" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  try {
    const rawText = await req.text();
    // Verify signature if configured
    const ok = await verifySignatureIfPresent(req, rawText);
    if (!ok) return json({ error: "Invalid signature" }, 401);

    let body: AnyJson = {};
    try {
      body = JSON.parse(rawText);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    // Fetch integration — validates platform and finds team_id + notify emails
    const { data: integration, error: intErr } = await serviceClient
      .from("outbound_integrations")
      .select("id, team_id, platform, calendly_notify_emails")
      .eq("id", integrationId)
      .single();
    if (intErr || !integration) return json({ error: "Integration not found or access denied" }, 404);
    if ((integration.platform || "").toLowerCase() !== "calendly") {
      return json({ error: "Integration is not a Calendly connection" }, 400);
    }
    const teamId: string = integration.team_id;
    const notifyTo: string[] = Array.isArray((integration as any).calendly_notify_emails)
      ? ((integration as any).calendly_notify_emails as string[]).filter((s) => typeof s === "string" && s.includes("@"))
      : [];

    // Extract fields
    const f = extractEventFields(body);
    const type = (f.eventType || "").toLowerCase();
    if (!f.inviteeUuid || !f.eventUuid) {
      console.warn("[calendly-webhook] Missing UUID(s) — skipping persist", { type, inviteeUuid: f.inviteeUuid, eventUuid: f.eventUuid });
      return json({ ok: true, skipped: "missing_identifiers" });
    }
    const normalizedEmail = (f.inviteeEmail || "").trim().toLowerCase() || null;

    // MATCH-ONLY: find person_key by email (team-scoped). Do not create people.
    let personKey: string | null = null;
    if (normalizedEmail) {
      const { data: p } = await serviceClient
        .from("people")
        .select("person_key")
        .eq("team_id", teamId)
        .eq("person_key", normalizedEmail)
        .maybeSingle();
      personKey = p?.person_key ?? null;
    }

    // Map type to status
    const status: "scheduled" | "canceled" | "completed" =
      type.includes("canceled") ? "canceled" : "scheduled";

    const upsertRow = {
      integration_id: integrationId,
      team_id: teamId,
      person_key: personKey,
      email: normalizedEmail,
      scheduled_event_uuid: f.eventUuid,
      invitee_uuid: f.inviteeUuid,
      event_name: f.eventName,
      status,
      start_time: f.startTime,
      end_time: f.endTime,
      source: "webhook",
      raw: body as unknown,
    } as Record<string, unknown>;

    // Upsert event
    const { data: upRows, error: upErr } = await serviceClient
      .from("calendly_events")
      .upsert(upsertRow, { onConflict: "integration_id,invitee_uuid" })
      .select("id, notified_at, email, person_key, event_name, start_time, status")
      .limit(1);
    if (upErr) throw upErr;
    const row = Array.isArray(upRows) && upRows.length > 0 ? upRows[0] as any : null;

    // Send notification on CREATED only and only once (idempotent by notified_at)
    if (row && row.status === "scheduled" && !row.notified_at && notifyTo.length > 0) {
      const startIso = row.start_time ? new Date(row.start_time).toISOString() : null;
      const startLocal = row.start_time
        ? new Date(row.start_time).toLocaleString()
        : "TBD";
      const subject = `New Calendly booking: ${row.event_name || "Meeting"}${normalizedEmail ? ` · ${normalizedEmail}` : ""}`;
      const matchedNote = row.person_key ? `Matched to person_key: ${row.person_key}` : "Unmatched (no person found)";
      const html =
        `<p><strong>New Calendly booking</strong></p>
         <ul>
           <li>Invitee: ${f.inviteeName || "-"} &lt;${normalizedEmail || "-"}&gt;</li>
           <li>Event: ${row.event_name || "-"}</li>
           <li>When: ${startLocal}${startIso ? ` <span style="color:#999">(${startIso})</span>` : ""}</li>
           ${f.joinUrl ? `<li>Join: <a href="${f.joinUrl}">${f.joinUrl}</a></li>` : ""}
           <li>${matchedNote}</li>
         </ul>`;
      const text =
        `New Calendly booking\n` +
        `Invitee: ${f.inviteeName || "-"} <${normalizedEmail || "-"}>\n` +
        `Event: ${row.event_name || "-"}\n` +
        `When: ${startLocal}${startIso ? ` (${startIso})` : ""}\n` +
        (f.joinUrl ? `Join: ${f.joinUrl}\n` : "") +
        `${matchedNote}\n`;

      const sent = await sendTransactionalEmail({
        to: notifyTo,
        subject,
        html,
        text,
        tags: [{ name: "integration", value: "calendly" }],
      });
      if (sent) {
        await serviceClient
          .from("calendly_events")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }

    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendly-webhook] error:", msg);
    return json({ error: msg }, 500);
  }
});

