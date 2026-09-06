// [sync-calendly-events v1]
//
// Poll recent Calendly scheduled events and upsert invitee outcomes into
// calendly_events. Best‑effort writes to inference_events for meeting_booked.
// Strictly additive — never touches agent_leads or inbox.
//
// Matching policy (product decision):
// - MATCH-ONLY: attach bookings to existing people by email (preferred) or
//   leave person_key null. Do NOT create new people/contacts/leads.
//
// Window: last N days (default 30). All times are ISO UTC.

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

const CAL_API_BASE = "https://api.calendly.com";
const PAGE_SIZE = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toIso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

async function fetchJson(token: string, path: string, qs?: Record<string, string | number | undefined>) {
  const url = new URL(`${CAL_API_BASE}${path}`);
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

function extractUuidFromUri(uri: unknown): string | null {
  const s = typeof uri === "string" ? uri : String(uri ?? "");
  const m = s.match(/[a-f0-9-]{36}$/i);
  return m ? m[0] : null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let integrationId: string | undefined;
  let lookbackDays: number = 30;
  try {
    const body = await req.json().catch(() => ({}));
    integrationId = body.integrationId;
    lookbackDays = Number(body.lookbackDays ?? 30);

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

    // Helpers to manage connect-time sync status updates, mirroring PhoneBurner
    async function finalizeSyncingStatus(targetIntegrationId: string) {
      try {
        const { data: row } = await serviceClient
          .from("outbound_integrations")
          .select("sync_status")
          .eq("id", targetIntegrationId)
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
            .eq("id", targetIntegrationId);
        }
      } catch (e) {
        console.warn("[sync-calendly-events] failed to finalize syncing status:", e);
      }
    }
    async function recordSyncErrorIfSyncing(targetIntegrationId: string, msg: string) {
      try {
        const { data: row } = await serviceClient
          .from("outbound_integrations")
          .select("sync_status")
          .eq("id", targetIntegrationId)
          .single();
        if ((row?.sync_status || "").toLowerCase() === "syncing") {
          await serviceClient
            .from("outbound_integrations")
            .update({ sync_status: "error", sync_error: msg, updated_at: new Date().toISOString() })
            .eq("id", targetIntegrationId);
        }
      } catch (e) {
        console.warn("[sync-calendly-events] failed to record error status:", e);
      }
    }

    async function syncSingleIntegration(opts: { id: string; team_id: string; token: string; lookbackDays: number }) {
      const { id: integId, team_id: teamId, token, lookbackDays } = opts;

      // Resolve user URI for scoping; fallback to org-only when present
      let userUri: string | null = null;
      try {
        const me = await fetchJson(token, "/users/me");
        userUri = typeof me?.resource?.uri === "string" ? me.resource.uri : null;
      } catch (e) {
        console.warn("[sync-calendly-events] /users/me failed (continuing with no userUri):", e instanceof Error ? e.message : String(e));
      }

      const end = new Date();
      const start = new Date(end.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);
      const min_start_time = toIso(start);

      // List scheduled events (newest first). Scope by user when known.
      const params: Record<string, string | number> = {
        count: PAGE_SIZE,
        sort: "start_time:desc",
        min_start_time,
      };
      if (userUri) params["user"] = userUri;

      let eventsUpserted = 0;
      let inferenceWritten = 0;

      // Calendly paginates with next_page_token
      let nextPageToken: string | undefined = undefined;
      let pages = 0;
      const MAX_PAGES = 50;
      do {
        const pageParams = { ...params, ...(nextPageToken ? { page_token: nextPageToken } : {}) };
        const data = await fetchJson(token, "/scheduled_events", pageParams);
        const items: any[] = Array.isArray(data?.collection) ? data.collection : [];
        nextPageToken = typeof data?.pagination?.next_page === "string" ? data.pagination.next_page : undefined;
        pages++;

        for (const ev of items) {
          const evUuid = extractUuidFromUri(ev?.uri) ?? "";
          if (!evUuid) continue;
          const evName = typeof ev?.name === "string" ? ev.name : null;
          const evStatus = String(ev?.status ?? "active").toLowerCase();
          const startTime = typeof ev?.start_time === "string" ? ev.start_time : null;
          const endTime = typeof ev?.end_time === "string" ? ev.end_time : null;

          // Fetch invitees for this scheduled event
          let invitees: any[] = [];
          try {
            const inv = await fetchJson(token, `/scheduled_events/${encodeURIComponent(evUuid)}/invitees`, { count: 100 });
            invitees = Array.isArray(inv?.collection) ? inv.collection : [];
          } catch (e) {
            console.warn(`[sync-calendly-events] invitees fetch failed for ${evUuid}:`, e instanceof Error ? e.message : String(e));
            continue;
          }

          for (const inv of invitees) {
            const inviteeUuid = extractUuidFromUri(inv?.uri) ?? "";
            if (!inviteeUuid) continue;
            const emailLower = typeof inv?.email === "string" && inv.email.includes("@")
              ? String(inv.email).trim().toLowerCase()
              : null;

            // Determine normalized status for this invitee
            const invCanceled = Boolean(inv?.canceled ?? inv?.cancellation);
            let status: "scheduled" | "canceled" | "completed" = "scheduled";
            if (invCanceled || evStatus === "canceled") {
              status = "canceled";
            } else if (endTime && new Date(endTime).getTime() < Date.now()) {
              status = "completed";
            }

            // MATCH-ONLY: resolve person_key by email against people
            let personKey: string | null = null;
            if (emailLower) {
              const { data: p } = await serviceClient
                .from("people")
                .select("person_key")
                .eq("team_id", teamId)
                .eq("email", emailLower)
                .limit(1)
                .maybeSingle();
              if (p?.person_key) personKey = p.person_key;
            }

            // Upsert calendly_events
            const row = {
              integration_id: integId,
              team_id: teamId,
              person_key: personKey,
              email: emailLower,
              scheduled_event_uuid: evUuid,
              invitee_uuid: inviteeUuid,
              event_name: evName,
              status,
              start_time: startTime ? new Date(startTime).toISOString() : null,
              end_time: endTime ? new Date(endTime).toISOString() : null,
              source: "poll" as const,
              raw: { event: ev, invitee: inv },
              updated_at: new Date().toISOString(),
            };
            const { error: upErr } = await serviceClient
              .from("calendly_events")
              .upsert(row, { onConflict: "integration_id,invitee_uuid" });
            if (!upErr) eventsUpserted++;

            // Best-effort inference write for scheduled bookings
            if (status === "scheduled" && personKey) {
              const occurredAt = row.start_time ?? new Date().toISOString();
              const { error: ieErr } = await serviceClient.from("inference_events").insert({
                team_id: teamId,
                person_key: personKey,
                email: personKey.includes("@") ? personKey : (emailLower ?? null),
                channel: "other",
                sequence_step_type: "meeting",
                event_type: "meeting_booked",
                intent: null,
                occurred_at: occurredAt,
                source: "sync_calendly_events",
                source_row_id: inviteeUuid,
                metadata: { event_uuid: evUuid, event_name: evName },
              });
              if (!ieErr) inferenceWritten++;
            }
          }
          await sleep(80);
        }
        if (pages >= MAX_PAGES) break;
        await sleep(120);
      } while (nextPageToken);

      await finalizeSyncingStatus(integId);
      return { eventsUpserted, inferenceWritten, window: { min_start_time } };
    }

    // Branching: single integration vs internal multi
    if (integrationId) {
      const { data: integration, error: intErr } = await db
        .from("outbound_integrations")
        .select("id, team_id, platform, api_key_encrypted")
        .eq("id", integrationId)
        .single();
      if (intErr || !integration) throw new Error("Integration not found or access denied");
      if ((integration.platform || "").toLowerCase() !== "calendly") {
        throw new Error("Integration is not a Calendly connection");
      }
      const stats = await syncSingleIntegration({
        id: integration.id,
        team_id: integration.team_id,
        token: integration.api_key_encrypted,
        lookbackDays,
      });
      return new Response(JSON.stringify({ success: true, ...stats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Missing integrationId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Internal multi-integration: iterate all Calendly outbound_integrations
    const { data: integrations, error: listErr } = await serviceClient
      .from("outbound_integrations")
      .select("id, team_id, platform, api_key_encrypted")
      .ilike("platform", "calendly");
    if (listErr) throw new Error(`Failed to list Calendly integrations: ${listErr.message || String(listErr)}`);

    const results: Array<{ id: string; team_id: string; ok: boolean; error?: string; eventsUpserted?: number; inferenceWritten?: number }> = [];
    let totalEvents = 0;
    let totalInferences = 0;
    for (const integ of integrations || []) {
      if (!integ?.id || !integ?.team_id || !integ?.api_key_encrypted) {
        results.push({ id: String(integ?.id ?? ""), team_id: String(integ?.team_id ?? ""), ok: false, error: "Missing required fields" });
        continue;
      }
      try {
        const stats = await syncSingleIntegration({
          id: String(integ.id),
          team_id: String(integ.team_id),
          token: String(integ.api_key_encrypted),
          lookbackDays,
        });
        totalEvents += stats.eventsUpserted;
        totalInferences += stats.inferenceWritten;
        results.push({ id: String(integ.id), team_id: String(integ.team_id), ok: true, eventsUpserted: stats.eventsUpserted, inferenceWritten: stats.inferenceWritten });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (integ?.id) await recordSyncErrorIfSyncing(String(integ.id), msg);
        results.push({ id: String(integ?.id ?? ""), team_id: String(integ?.team_id ?? ""), ok: false, error: msg });
      }
      await sleep(250);
    }

    return new Response(JSON.stringify({
      success: true,
      mode: "multi",
      integrationsProcessed: (integrations || []).length,
      eventsUpserted: totalEvents,
      inferenceWritten: totalInferences,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-calendly-events] error:", msg);
    if (integrationId) await recordSyncErrorIfSyncing(integrationId, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

