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
import { normalizeLinkedInUrl as normalizeLiKey } from "../_shared/lead-dedup.ts";

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
// Format calendar date in US Central timezone (America/Chicago) as YYYY-MM-DD
const formatCentralDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

function normalizePhoneE164(input: unknown): string | null {
  const s = typeof input === "string" ? input : String(input ?? "");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

// Build common absolute-url variants from a normalized linkedin.com key
// (no scheme/www; see normalizeLiKey). Stored values are typically absolute.
function buildLinkedInUrlVariants(key: string): string[] {
  const k = key.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return [
    `https://${k}`,
    `https://www.${k}`,
    `http://${k}`,
    `http://www.${k}`,
    k, // just in case a bare host/path was stored
  ];
}

function extractLinkedInFromCall(c: any): string | null {
  const candidates: Array<unknown> = [
    c?.linkedin_url,
    c?.linkedinUrl,
    c?.linkedin,
    c?.linked_in,
    c?.linkedIn,
    c?.linkedin_profile_url,
    c?.linkedInProfileUrl,
    c?.profile_url,
    c?.profileUrl,
    c?.contact?.linkedin_url,
    c?.contact?.linkedinUrl,
    c?.contact?.linkedInProfileUrl,
    c?.lead?.linkedin_url,
    c?.lead?.linkedinUrl,
    c?.lead?.linkedInProfileUrl,
  ];
  for (const raw of candidates) {
    const s = typeof raw === "string" ? raw : String(raw ?? "");
    if (s && /linkedin\.com/i.test(s)) {
      const key = normalizeLiKey(s);
      if (key) return key;
    }
  }
  return null;
}

function extractCompanyFromCall(c: any): string | null {
  const candidates: Array<unknown> = [
    c?.company_name,
    c?.companyName,
    c?.company,
    c?.organization,
    c?.org,
    c?.contact?.company,
    c?.lead?.company,
  ];
  for (const raw of candidates) {
    const s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (s) return s;
  }
  return null;
}

function extractFullNameFromCall(c: any): string | null {
  const candidates: Array<unknown> = [
    c?.full_name,
    c?.name,
    [c?.first_name, c?.last_name].filter((v: unknown) => typeof v === "string" && String(v).trim()).join(" "),
    c?.contact?.full_name,
    c?.contact?.name,
    [c?.contact?.first_name, c?.contact?.last_name].filter((v: unknown) => typeof v === "string" && String(v).trim()).join(" "),
    c?.lead?.full_name,
    c?.lead?.name,
    [c?.lead?.first_name, c?.lead?.last_name].filter((v: unknown) => typeof v === "string" && String(v).trim()).join(" "),
  ];
  for (const raw of candidates) {
    const s = typeof raw === "string" ? raw : String(raw ?? "");
    const t = s.trim();
    if (t) return t;
  }
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
    // Helper: finalize syncing status (syncing -> synced) for a given integration
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
        console.warn("[poll-phoneburner-calls] failed to finalize syncing status:", e);
      }
    }

    // Helper: mark error when connect-time polling fails and status is still syncing
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
        console.warn("[poll-phoneburner-calls] failed to record error status:", e);
      }
    }

    // Core poll for a single integration (re-usable for multi-run)
    async function pollSingleIntegration(opts: { id: string; team_id: string; token: string; lookbackDays: number }) {
      const { id: singleIntegrationId, team_id: teamId, token, lookbackDays } = opts;

      // Window
      const end = new Date();
      const start = new Date(end.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);
      // PhoneBurner date typing is date-based in Central time. Use YYYY-MM-DD.
      const date_start = formatCentralDate(start);
      const date_end = formatCentralDate(end);
      // Resolve team user ids (for agent_leads scoping)
      const { data: teamMembers } = await serviceClient
        .from("team_memberships")
        .select("user_id")
        .eq("team_id", teamId);
      const teamUserIds: string[] = (teamMembers ?? []).map((r: any) => r.user_id).filter(Boolean);

      // 1) List dial sessions
      const dsList = await fetchJson(token, "/dialsession", { date_start, date_end });
      try {
        console.log(`[poll-phoneburner-calls] list keys:`, Object.keys(dsList || {}));
      } catch { /* ignore */ }
      // Log list metadata (no secrets)
      try {
        const totalResults =
          (dsList?.dialsessions?.total_results ?? dsList?.total_results ?? dsList?.total ?? null);
        const typeOfDialSessions =
          Array.isArray(dsList?.dialsessions) ? "array" : typeof dsList?.dialsessions;
        console.log(
          `[poll-phoneburner-calls] list meta: total_results=${String(totalResults)} type(dialsessions)=${String(typeOfDialSessions)}`
        );
      } catch { /* ignore */ }
      // Official list shape:
      // { dialsessions: { page, total_results, dialsessions: [ { dialsession_id, ... } ] } }
      // Be defensive and accept historical/alternative shapes as well.
      const sessions: Array<any> =
        Array.isArray(dsList?.dialsessions?.dialsessions) ? dsList.dialsessions.dialsessions :
        Array.isArray(dsList?.dialsessions) ? dsList.dialsessions :
        Array.isArray(dsList?.dial_sessions) ? dsList.dial_sessions :
        Array.isArray(dsList?.dialsession?.dialsessions) ? dsList.dialsession.dialsessions :
        Array.isArray(dsList) ? dsList :
        Array.isArray(dsList?.items) ? dsList.items :
        Array.isArray(dsList?.data) ? dsList.data : [];
      const sessionIds = sessions
        .map((s) => {
          const id = (s?.dialsession_id ?? s?.id ?? null);
          return id != null ? String(id) : null;
        })
        .filter((v): v is string => !!v);
      console.log(`[poll-phoneburner-calls] integration=${singleIntegrationId} sessions=${sessionIds.length} window=${date_start}..${date_end}`);

      let eventsUpserted = 0;
      let inferenceWritten = 0;

      for (const sid of sessionIds) {
        const detail = await fetchJson(token, `/dialsession/${encodeURIComponent(sid)}`);
        // Detail can be a wrapper or nested under dialsessions.dialsessions[].calls
        let calls: any[] = [];
        // New official detail shape: dialsessions.dialsessions is an OBJECT with .calls
        const nestedDetail = (detail as any)?.dialsessions?.dialsessions;
        if (nestedDetail && !Array.isArray(nestedDetail) && Array.isArray((nestedDetail as any)?.calls)) {
          calls = (nestedDetail as any).calls;
        } else if (Array.isArray(detail?.dialsessions?.dialsessions)) {
          try {
            calls = (detail.dialsessions.dialsessions as any[]).flatMap((ds: any) =>
              Array.isArray(ds?.calls) ? ds.calls : []
            );
          } catch {
            // fallback to direct array if flatMap not applicable
            calls = [];
            for (const ds of (detail.dialsessions.dialsessions as any[])) {
              if (Array.isArray((ds as any)?.calls)) calls.push(...(ds as any).calls);
            }
          }
        } else if (Array.isArray(detail?.dialsessions?.calls)) {
          calls = detail.dialsessions.calls;
        } else if (Array.isArray(detail?.dialsession?.calls)) {
          calls = detail.dialsession.calls;
        } else if (Array.isArray(detail?.dial_session?.calls)) {
          calls = detail.dial_session.calls;
        } else if (Array.isArray(detail)) {
          calls = detail;
        } else if (Array.isArray(detail?.calls)) {
          calls = detail.calls;
        } else if (Array.isArray(detail?.data)) {
          calls = detail.data;
        } else {
          calls = [];
        }
        // Optional non-PII logging: structure + call count
        try {
          const nestedType = Array.isArray(nestedDetail) ? "array" : typeof nestedDetail;
          const dsKeys = Object.keys((detail as any)?.dialsessions ?? {});
          console.log(`[poll-phoneburner-calls] detail meta: nestedType=${nestedType} dialsessions_keys=${dsKeys.join(",")} calls=${calls.length}`);
        } catch { /* ignore */ }
        for (const c of calls) {
          const callId = String(c?.call_id ?? c?.id ?? "");
          if (!callId) continue;
          const rawPhone = c?.phone ?? c?.to ?? c?.dialed ?? null;
          const phoneE164 = normalizePhoneE164(rawPhone);
          // Optional email directly on the call payload (rare; defensive)
          const emailRaw =
            (typeof c?.email === "string" ? c.email : null) ??
            (typeof c?.email_address === "string" ? c.email_address : null) ??
            (typeof c?.contact?.email === "string" ? c.contact.email : null) ??
            null;
          const emailLower = typeof emailRaw === "string" && emailRaw.includes("@")
            ? String(emailRaw).toLowerCase()
            : null;
          const disposition = c?.disposition ?? c?.status ?? null;
          // Coerce PB "0"/"1" string fields to booleans (Boolean(\"0\") === true is wrong)
          const connected =
            typeof c?.connected === "string" ? c.connected === "1" :
            typeof c?.connected === "number" ? c.connected === 1 :
            typeof c?.connected === "boolean" ? c.connected :
            (typeof c?.answered === "boolean" ? c.answered : false);
          const voicemail =
            typeof c?.voicemail === "string" ? c.voicemail === "1" :
            typeof c?.voicemail === "number" ? c.voicemail === 1 :
            typeof c?.voicemail === "boolean" ? c.voicemail :
            (typeof c?.left_voicemail === "boolean" ? c.left_voicemail : false);
          const duration = typeof c?.duration_seconds === "number" ? c.duration_seconds
            : typeof c?.duration === "number" ? c.duration
            : null;
          const note = typeof c?.note === "string" ? c.note : null;
          const occurredAt =
            c?.ended_at || c?.end_when ||
            c?.connected_at ||
            c?.started_at || c?.start_when ||
            c?.time ||
            new Date().toISOString();
          const recordingUrl = typeof c?.recording_url === "string" ? c.recording_url : null;

          // Person match order (MATCH-ONLY):
          // 1) Email-first against existing people (team-scoped)
          // 2) Phone fallback (team-scoped): synced_contacts.phone → verify people by email
          // 3) Legacy fallback: phoneburner_contacts.phone_e164 → verify people by person_key
          let personKey: string | null = null;
          // Capture PhoneBurner contact id if present on the call payload
          let pbContactId: string | null =
            (c?.contact_user_id != null ? String(c.contact_user_id) : null) ??
            (c?.contact_id != null ? String(c.contact_id) : null) ??
            (c?.pb_contact_id != null ? String(c.pb_contact_id) : null) ??
            null;

          // 1) Email path — prefer direct email on the call, else email from local PB contact by id
          let matchedByEmail = false;
          let candidateEmailLower = emailLower;
          if (!candidateEmailLower && pbContactId) {
            // Best-effort local lookup (no provider call): PB contact stored email
            const { data: cRow } = await serviceClient
              .from("phoneburner_contacts")
              .select("email")
              .eq("integration_id", singleIntegrationId)
              .eq("pb_contact_id", pbContactId)
              .limit(1)
              .maybeSingle();
            if (typeof cRow?.email === "string" && cRow.email.includes("@")) {
              candidateEmailLower = cRow.email.toLowerCase();
            }
          }
          if (candidateEmailLower) {
            const { data: p } = await serviceClient
              .from("people")
              .select("person_key")
              .eq("team_id", teamId)
              .eq("email", candidateEmailLower)
              .limit(1)
              .maybeSingle();
            if (p?.person_key) {
              personKey = p.person_key;
              matchedByEmail = true;
            }
          }

        // 2) LinkedIn URL — normalized match to people first; then via
        // synced_contacts/agent_leads → verify in people by email.
        const liKey = extractLinkedInFromCall(c);
        const companyRaw = extractCompanyFromCall(c);
        const fullName = extractFullNameFromCall(c);
        if (!personKey && liKey) {
          const liForms = buildLinkedInUrlVariants(liKey);
          // a) direct hit in people.linkedin_url (team-scoped)
          const { data: liHit } = await serviceClient
            .from("people")
            .select("person_key")
            .eq("team_id", teamId)
            .in("linkedin_url", liForms as any)
            .limit(1)
            .maybeSingle();
          if (liHit?.person_key) {
            personKey = liHit.person_key;
          } else {
            // b) synced_contacts.linkedin_url → email → verify people
            const { data: sc } = await serviceClient
              .from("synced_contacts")
              .select("email")
              .eq("team_id", teamId)
              .in("linkedin_url", liForms as any)
              .limit(1)
              .maybeSingle();
            const scEmail = sc?.email ? String(sc.email).trim().toLowerCase() : null;
            if (scEmail) {
              const { data: p2 } = await serviceClient
                .from("people")
                .select("person_key")
                .eq("team_id", teamId)
                .eq("email", scEmail)
                .limit(1)
                .maybeSingle();
              if (p2?.person_key) personKey = p2.person_key;
            }
            // c) agent_leads.linkedin_url → email → verify people (team-scoped users)
            if (!personKey && teamUserIds.length > 0) {
              const { data: al } = await serviceClient
                .from("agent_leads")
                .select("email, linkedin_url, user_id")
                .in("user_id", teamUserIds as any)
                .in("linkedin_url", liForms as any)
                .limit(1)
                .maybeSingle();
              const alEmail = al?.email ? String(al.email).trim().toLowerCase() : null;
              if (alEmail) {
                const { data: p3 } = await serviceClient
                  .from("people")
                  .select("person_key")
                  .eq("team_id", teamId)
                  .eq("email", alEmail)
                  .limit(1)
                  .maybeSingle();
                if (p3?.person_key) personKey = p3.person_key;
              }
            }
          }
        }

          // 3) Phone path — prefer team-scoped synced_contacts.phone (normalize + verify people by email)
          if (!matchedByEmail && phoneE164) {
            const digits = phoneE164.replace(/\D+/g, "");
            if (digits) {
              const { data: scList } = await serviceClient
                .from("synced_contacts")
                .select("email, phone")
                .eq("team_id", teamId)
                .ilike("phone", `%${digits}%`)
                .limit(5);
              if (Array.isArray(scList)) {
                for (const sc of scList) {
                  const scPhone = typeof sc?.phone === "string" ? sc.phone : null;
                  const scNorm = scPhone ? normalizePhoneE164(scPhone) : null;
                  const scEmailLower = typeof sc?.email === "string" && sc.email.includes("@") ? sc.email.toLowerCase() : null;
                  if (scNorm === phoneE164 && scEmailLower) {
                    const { data: p3 } = await serviceClient
                      .from("people")
                      .select("person_key")
                      .eq("team_id", teamId)
                      .eq("email", scEmailLower)
                      .limit(1)
                      .maybeSingle();
                    if (p3?.person_key) {
                      personKey = p3.person_key;
                      break;
                    }
                  }
                }
              }
            }
            // 4) Legacy/local PB roster as a fallback: phone_e164 → person_key, then verify people row exists
            if (!personKey) {
              const { data: m } = await serviceClient
                .from("phoneburner_contacts")
                .select("person_key, pb_contact_id")
                .eq("integration_id", singleIntegrationId)
                .eq("phone_e164", phoneE164)
                .limit(1)
                .maybeSingle();
              if (m?.person_key) {
                const { data: p2 } = await serviceClient
                  .from("people")
                  .select("person_key")
                  .eq("team_id", teamId)
                  .eq("person_key", m.person_key)
                  .limit(1)
                  .maybeSingle();
                if (p2?.person_key) {
                  personKey = p2.person_key;
                  if (!pbContactId && m.pb_contact_id) pbContactId = m.pb_contact_id;
                }
              }
            }
          }

          // 5) Company — WEAK alone. Only when:
          //    (a) company + full name match a people row; OR
          //    (b) company is unique in people for this team (exactly one row).
          if (!personKey && companyRaw) {
            const company = companyRaw.trim();
            if (company) {
              if (fullName) {
                const { data: byBoth } = await serviceClient
                  .from("people")
                  .select("person_key")
                  .eq("team_id", teamId)
                  .ilike("company_name", company)
                  .ilike("full_name", fullName)
                  .limit(2);
                const rows = Array.isArray(byBoth) ? byBoth : [];
                if (rows.length === 1 && rows[0]?.person_key) {
                  personKey = rows[0].person_key;
                }
              }
              if (!personKey) {
                const { data: byCompany } = await serviceClient
                  .from("people")
                  .select("person_key")
                  .eq("team_id", teamId)
                  .ilike("company_name", company)
                  .limit(2);
                const rows2 = Array.isArray(byCompany) ? byCompany : [];
                if (rows2.length === 1 && rows2[0]?.person_key) {
                  personKey = rows2[0].person_key;
                }
              }
            }
          }

          // Upsert dialer_events
          const row = {
            integration_id: singleIntegrationId,
            team_id: teamId,
            person_key: personKey,
            pb_contact_id: pbContactId,
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
          if (!upErr) {
            eventsUpserted++;
          } else {
            try {
              console.error("[poll-phoneburner-calls] upsert dialer_events error", {
                integration_id: singleIntegrationId, dialsession_id: sid, call_id: callId, message: upErr?.message || String(upErr),
              });
            } catch { /* ignore */ }
          }

          // Best-effort inference write
          const mapped = mapDispositionToInference(disposition);
          if (mapped && personKey) {
            const { error: ieErr } = await serviceClient.from("inference_events").insert({
              team_id: teamId,
              person_key: personKey,
              email: personKey.includes("@") ? personKey : null,
              channel: "other",
              sequence_step_type: "call",
              event_type: mapped.event_type,
              intent: "intent" in mapped ? mapped.intent : null,
              occurred_at: new Date(occurredAt).toISOString(),
              source: "poll_phoneburner_calls",
              source_row_id: callId,
              metadata: { disposition, reason: mapped.reason, dialsession_id: sid, phone_e164: phoneE164 },
            });
            if (!ieErr) {
              inferenceWritten++;
            } else {
              try {
                console.error("[poll-phoneburner-calls] insert inference_events error", {
                  integration_id: singleIntegrationId, dialsession_id: sid, call_id: callId, message: ieErr?.message || String(ieErr),
                });
              } catch { /* ignore */ }
            }
          }
        }
        await sleep(150);
      }

      // finalize syncing status for this integration
      await finalizeSyncingStatus(singleIntegrationId);

      return {
        sessions: sessionIds.length,
        eventsUpserted,
        inferenceWritten,
        window: { date_start, date_end },
      };
    }

    // Branching: integrationId provided vs. not provided
    if (integrationId) {
      // Load single integration using scoped client based on auth mode
      const { data: integration, error: intErr } = await db
        .from("outbound_integrations")
        .select("id, team_id, platform, api_key_encrypted")
        .eq("id", integrationId)
        .single();
      if (intErr || !integration) throw new Error("Integration not found or access denied");
      if ((integration.platform || "").toLowerCase() !== "phoneburner") {
        throw new Error("Integration is not a PhoneBurner connection");
      }
      const stats = await pollSingleIntegration({
        id: integration.id,
        team_id: integration.team_id,
        token: integration.api_key_encrypted,
        lookbackDays,
      });
      return new Response(JSON.stringify({ success: true, ...stats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No integrationId given
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Missing integrationId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Internal multi-integration path: iterate all PhoneBurner outbound_integrations
    const { data: integrations, error: listErr } = await serviceClient
      .from("outbound_integrations")
      .select("id, team_id, platform, api_key_encrypted")
      .ilike("platform", "phoneburner");
    if (listErr) throw new Error(`Failed to list PhoneBurner integrations: ${listErr.message || String(listErr)}`);

    const results: Array<{ id: string; team_id: string; ok: boolean; error?: string; sessions?: number; eventsUpserted?: number; inferenceWritten?: number }> = [];
    let totalSessions = 0;
    let totalEvents = 0;
    let totalInferences = 0;
    for (const integ of integrations || []) {
      if (!integ?.id || !integ?.team_id || !integ?.api_key_encrypted) {
        results.push({ id: String(integ?.id ?? ""), team_id: String(integ?.team_id ?? ""), ok: false, error: "Missing required fields" });
        continue;
      }
      try {
        const stats = await pollSingleIntegration({
          id: String(integ.id),
          team_id: String(integ.team_id),
          token: String(integ.api_key_encrypted),
          lookbackDays,
        });
        totalSessions += stats.sessions;
        totalEvents += stats.eventsUpserted;
        totalInferences += stats.inferenceWritten;
        results.push({ id: String(integ.id), team_id: String(integ.team_id), ok: true, sessions: stats.sessions, eventsUpserted: stats.eventsUpserted, inferenceWritten: stats.inferenceWritten });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Connect-time error marking (if applicable)
        if (integ?.id) await recordSyncErrorIfSyncing(String(integ.id), msg);
        results.push({ id: String(integ?.id ?? ""), team_id: String(integ?.team_id ?? ""), ok: false, error: msg });
      }
      // Gentle pacing between integrations to avoid provider rate spikes
      await sleep(250);
    }

    return new Response(JSON.stringify({
      success: true,
      mode: "multi",
      integrationsProcessed: (integrations || []).length,
      sessions: totalSessions,
      eventsUpserted: totalEvents,
      inferenceWritten: totalInferences,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[poll-phoneburner-calls] error:", msg);
    // Only mark error if status is still 'syncing' (connect-time clear) in single-id path
    if (integrationId) await recordSyncErrorIfSyncing(integrationId, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

