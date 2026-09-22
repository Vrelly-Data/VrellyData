// [backfill-smartlead-sends v1]
//
// One-shot/resumable backfill of Smartlead OUTBOUND "SENT" messages into
// public.inference_events (event_type='sent', channel='email'), plus additive
// people upserts from synced_contacts. Idempotent per provider message id
// using the shared computeSentSourceId helper.
//
// Scope:
// - Team-scoped: choose one Smartlead integration by integrationId OR all active
//   Smartlead integrations for a given teamId.
// - Campaigns: capture_enabled=true only (safety). Can be widened later.
// - Contacts: walks public.synced_contacts for the selected campaigns and fetches
//   Smartlead /message-history per lead to find "SENT" messages.
//
// Auth:
// - Internal only via x-agent-key (AGENT_API_KEY). No frontend JWT allowed.
//
// Request body:
//   {
//     integrationId?: string,   // backfill one Smartlead integration
//     teamId?: string,          // or all active Smartlead integrations for a team
//     maxLeads?: number,        // safety cap per run (default 500)
//     sinceDays?: number        // optional: restrict to synced_contacts updated in the last N days
//   }
//
// Response:
//   { integrations, campaigns, leads_scanned, messages_sent_written, messages_sent_skipped, errors }
//
// Notes:
// - Uses computeSentSourceId(provider='smartlead', message_id preferred) to build
//   a stable source_row_id so re-runs are no-ops for already-written messages.
// - Does NOT touch classify-reply or send-agent-reply or any live send path.
// - Best-effort additive upsert into public.people using synced_contacts values.
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { htmlToText } from "../_shared/html-to-text.ts";
import { stripZendeskMarker } from "../_shared/smartlead-thread.ts";

// computeSentSourceId: stable dedupe id for sent events
const { computeSentSourceId } = await import("../_shared/sent-source-id.ts");

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

type SmartleadMessage = {
  type?: "SENT" | "REPLY" | string;
  message_id?: string | number | null;
  stats_id?: string | number | null;
  email_body?: string | null;
  body?: string | null; // legacy
  time?: string | null;
  timestamp?: string | null; // legacy
  [k: string]: unknown;
};
type SmartleadHistory = { history?: SmartleadMessage[] } | SmartleadMessage[] | null;

async function fetchSmartleadHistory(apiKey: string, campaignId: string, leadId: string): Promise<SmartleadMessage[]> {
  const url = new URL(`${SMARTLEAD_API_BASE}/campaigns/${encodeURIComponent(campaignId)}/leads/${encodeURIComponent(leadId)}/message-history`);
  url.searchParams.set("api_key", apiKey);
  const resp = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Smartlead message-history ${resp.status}: ${t.substring(0, 300)}`);
  }
  const json = (await resp.json().catch(() => null)) as SmartleadHistory;
  const arr: SmartleadMessage[] = Array.isArray(json)
    ? json as SmartleadMessage[]
    : Array.isArray((json as any)?.history)
      ? ((json as any).history as SmartleadMessage[])
      : [];
  return arr;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Internal-only gate
    const agentKey = req.headers.get("x-agent-key") || "";
    const expected = Deno.env.get("AGENT_API_KEY") || "";
    if (!agentKey || !expected || agentKey !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const integrationId: string | undefined = body?.integrationId;
    const teamId: string | undefined = body?.teamId;
    const maxLeads: number = Math.max(1, Number(body?.maxLeads ?? 500));
    const sinceDaysRaw = body?.sinceDays;
    const sinceIso: string | null = Number.isFinite(Number(sinceDaysRaw))
      ? new Date(Date.now() - Number(sinceDaysRaw) * 86400_000).toISOString()
      : null;

    if (!integrationId && !teamId) {
      return new Response(JSON.stringify({ error: "Provide integrationId OR teamId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Resolve integrations
    type Integration = { id: string; team_id: string; created_by: string; api_key_encrypted: string | null };
    let integrations: Integration[] = [];
    if (integrationId) {
      const { data, error } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, created_by, api_key_encrypted")
        .eq("id", integrationId)
        .eq("platform", "smartlead")
        .eq("is_active", true)
        .maybeSingle();
      if (error || !data) throw new Error("Integration not found or inactive");
      integrations = [data as Integration];
    } else if (teamId) {
      const { data, error } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, created_by, api_key_encrypted")
        .eq("team_id", teamId)
        .eq("platform", "smartlead")
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      integrations = (data ?? []) as Integration[];
      if (integrations.length === 0) {
        return new Response(JSON.stringify({ error: "No active Smartlead integrations for team" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let totalCampaigns = 0;
    let leadsScanned = 0;
    let messagesSentWritten = 0;
    let messagesSentSkipped = 0;
    let errors = 0;

    // Helper: additive people upsert from synced_contacts row
    const putNonEmpty = (obj: Record<string, unknown>, key: string, val: unknown) => {
      const s = typeof val === "string" ? val : String(val ?? "");
      const t = s.trim();
      if (t && t !== "0") obj[key] = t;
    };

    for (const integ of integrations) {
      if (!integ.api_key_encrypted) continue;
      const apiKey = integ.api_key_encrypted;

      // Campaigns for this integration (safety: capture_enabled only)
      const { data: campaigns, error: cErr } = await supabase
        .from("synced_campaigns")
        .select("id, team_id, external_campaign_id, name")
        .eq("integration_id", integ.id)
        .eq("capture_enabled", true)
        .eq("source", "smartlead");
      if (cErr) throw new Error(cErr.message);
      totalCampaigns += (campaigns ?? []).length;

      for (const camp of campaigns ?? []) {
        // Page synced_contacts for this campaign
        let offset = 0;
        const PAGE = 100;
        while (true) {
          const sel =
            "id, team_id, email, external_contact_id, first_name, last_name, company, job_title, industry, company_size, city, state, country, phone, linkedin_url, updated_at";
          let q = supabase
            .from("synced_contacts")
            .select(sel)
            .eq("campaign_id", (camp as any).id)
            .order("updated_at", { ascending: false, nullsFirst: false })
            .range(offset, offset + PAGE - 1);
          if (sinceIso) q = q.gte("updated_at", sinceIso);
          const { data: contacts, error: sErr } = await q;
          if (sErr) { errors++; break; }
          const rows = Array.isArray(contacts) ? contacts : [];
          if (rows.length === 0) break;

          for (const sc of rows) {
            if (leadsScanned >= maxLeads) break;
            leadsScanned++;
            const leadId = (sc as any)?.external_contact_id ? String((sc as any).external_contact_id) : null;
            const email = typeof (sc as any)?.email === "string" ? (sc as any).email.trim().toLowerCase() : "";
            if (!leadId || !email) continue;
            try {
              const messages = await fetchSmartleadHistory(apiKey, String((camp as any).external_campaign_id), leadId);
              for (const m of messages) {
                if ((m?.type ?? "").toString().toUpperCase() !== "SENT") continue;
                const raw = (m.email_body ?? m.body ?? "") as string | null;
                const clean = stripZendeskMarker(htmlToText(raw || ""));
                const occurredAt = (m.time ?? m.timestamp ?? new Date().toISOString()) as string;
                const providerMessageId = m?.message_id !== undefined && m?.message_id !== null ? String(m.message_id) : null;
                const providerThreadId = m?.stats_id !== undefined && m?.stats_id !== null ? String(m.stats_id) : null;

                // Stable id for idempotency
                const copyFingerprint = await (await import("../_shared/copy-fingerprint.ts")).computeCopyFingerprint(clean, null);
                const sourceRowId = await computeSentSourceId({
                  provider: "smartlead",
                  personKey: email,
                  occurredAt,
                  providerThreadId,
                  providerMessageId,
                  copyFingerprint,
                  tag: `message_history:${String((camp as any).external_campaign_id)}:${leadId}`,
                });

                // Upsert inference_events (dedup on source,source_row_id,event_type)
                const { error: ieErr } = await supabase
                  .from("inference_events")
                  // @ts-ignore onConflict supports column-list
                  .upsert({
                    team_id: (camp as any).team_id,
                    person_key: email,
                    email,
                    linkedin_url: (sc as any)?.linkedin_url ?? null,
                    full_name: [String((sc as any)?.first_name ?? "").trim(), String((sc as any)?.last_name ?? "").trim()]
                      .filter(Boolean).join(" ") || null,
                    job_title: (sc as any)?.job_title ?? null,
                    company_name: (sc as any)?.company ?? null,
                    industry: (sc as any)?.industry ?? null,
                    city: (sc as any)?.city ?? null,
                    state: (sc as any)?.state ?? null,
                    country: (sc as any)?.country ?? null,
                    company_size: (sc as any)?.company_size ?? null,
                    channel: "email",
                    campaign_external_id: String((camp as any).external_campaign_id ?? ""),
                    campaign_name: (camp as any)?.name ?? null,
                    sequence_step_type: "email",
                    copy_fingerprint: copyFingerprint,
                    subject: null,
                    event_type: "sent",
                    intent: null,
                    is_objection: null,
                    pipeline_stage: "sent",
                    disposition_tag: null,
                    occurred_at: occurredAt,
                    source: "smartlead_message_history",
                    source_row_id: sourceRowId,
                    metadata: {
                      provider: "smartlead",
                      provider_thread_id: providerThreadId,
                      provider_message_id: providerMessageId,
                    },
                  }, { onConflict: "source,source_row_id,event_type" });
                if (ieErr) {
                  // Unique violation → treated as skip (already present)
                  messagesSentSkipped++;
                } else {
                  messagesSentWritten++;
                }

                // Best-effort additive people upsert (write-only)
                const p: Record<string, unknown> = {
                  team_id: (camp as any).team_id,
                  person_key: email,
                  email,
                  linkedin_url: (sc as any)?.linkedin_url ?? null,
                };
                putNonEmpty(p, "full_name", [String((sc as any)?.first_name ?? "").trim(), String((sc as any)?.last_name ?? "").trim()].filter(Boolean).join(" "));
                putNonEmpty(p, "company_name", (sc as any)?.company);
                putNonEmpty(p, "job_title", (sc as any)?.job_title);
                putNonEmpty(p, "industry", (sc as any)?.industry);
                putNonEmpty(p, "company_size", (sc as any)?.company_size);
                putNonEmpty(p, "city", (sc as any)?.city);
                putNonEmpty(p, "state", (sc as any)?.state);
                putNonEmpty(p, "country", (sc as any)?.country);
                putNonEmpty(p, "phone", (sc as any)?.phone);
                await supabase.from("people")
                  // @ts-ignore onConflict supports column-list
                  .upsert(p, { onConflict: "team_id,person_key" });
              }

              // Gentle pacing — Smartlead rate limits bursty runs
              await new Promise((r) => setTimeout(r, 150));
            } catch (e) {
              console.warn("[backfill-smartlead-sends] history fetch failed:", (e as Error).message);
              errors++;
              await new Promise((r) => setTimeout(r, 250));
            }
            if (leadsScanned >= maxLeads) break;
          }

          offset += rows.length;
          if (rows.length < PAGE || leadsScanned >= maxLeads) break;
        }
        if (leadsScanned >= maxLeads) break;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      integrations: integrations.length,
      campaigns: totalCampaigns,
      leads_scanned: leadsScanned,
      messages_sent_written: messagesSentWritten,
      messages_sent_skipped: messagesSentSkipped,
      errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill-smartlead-sends] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

