// [backfill-smartlead-sends v2]
//
// One-shot/resumable backfill of Smartlead OUTBOUND "SENT" messages into
// public.inference_events (event_type='sent', channel='email'), plus additive
// people upserts from provider lead roster. Idempotent per provider message id
// using the shared computeSentSourceId helper.
//
// Scope:
// - Team-scoped: choose one Smartlead integration by integrationId OR all active
//   Smartlead integrations for a given teamId.
// - Campaigns: capture_enabled=true only (safety). Can be widened later.
// - Roster: PULLS LEADS DIRECTLY FROM PROVIDER (Smartlead /campaigns/{id}/leads)
//   so every capture_enabled campaign’s leads are reachable regardless of
//   synced_contacts size.
//
// Auth:
// - Internal only via x-agent-key (AGENT_API_KEY). No frontend JWT allowed.
//
// Request body:
//   {
//     integrationId?: string,   // backfill one Smartlead integration
//     teamId?: string,          // or all active Smartlead integrations for a team
//     maxLeads?: number,        // per-run cap (default 5000)
//     cursor?: { integrationIndex?: number; campaignIndex?: number; leadOffset?: number } | string(base64-json)
//   }
//
// Response:
//   {
//     integrations, campaigns, leads_scanned,
//     messages_sent_written, messages_sent_skipped, errors,
//     hasMore, nextCursor: { integrationIndex, campaignIndex, leadOffset }
//   }
//
// Notes:
// - Uses computeSentSourceId(provider='smartlead', message_id preferred) to build
//   a stable source_row_id so re-runs are no-ops for already-written messages.
// - Does NOT touch classify-reply or send-agent-reply or any live send path.
// - Best-effort additive upsert into public.people using provider roster values.
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

type SmartleadLeadEnvelope = {
  total_leads?: number;
  data?: Array<{
    campaign_lead_map_id?: number | string;
    lead?: {
      id?: number | string;
      email?: string;
      phone_number?: string | null;
      linkedin_profile?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      company_name?: string | null;
      custom_fields?: Record<string, unknown> | null;
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  }>;
};

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

Deno.env.get;

// Safe GET wrapper that appends api_key via URLSearchParams and never logs the full URL.
async function smartleadGet(pathWithLeadingSlash: string, apiKey: string): Promise<Response> {
  const url = new URL(`${SMARTLEAD_API_BASE}${pathWithLeadingSlash}`);
  url.searchParams.set("api_key", apiKey);
  return fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
}

// Extract minimal firmographics from Smartlead custom_fields (aliases; non-empty only)
function extractSmartleadFirmographics(customFields: unknown): {
  job_title?: string;
  industry?: string;
  company_size?: string;
  city?: string;
  state?: string;
  country?: string;
} {
  const result: Record<string, string | undefined> = {};
  const norm = (v: unknown): string | undefined => {
    const s = typeof v === "string" ? v : String(v ?? "");
    const t = s.trim();
    if (!t || t === "0") return undefined;
    return t;
  };
  const nkey = (k: string) => k.trim().toLowerCase().replace(/\s+/g, " ").replace(/[_-]+/g, " ").trim();
  const setFirst = (field: string, v: unknown) => {
    if (result[field] === undefined) result[field] = norm(v);
  };
  if (customFields && typeof customFields === "object") {
    for (const [rawK, rawV] of Object.entries(customFields as Record<string, unknown>)) {
      const k = nkey(rawK);
      if (["title", "job title", "job_title"].includes(k)) setFirst("job_title", rawV);
      if (["industry", "vertical", "sector", "company industry"].includes(k)) setFirst("industry", rawV);
      if (
        ["company size", "company_size", "employees", "employee count", "headcount", "employee range", "company headcount"].includes(k)
      )
        setFirst("company_size", rawV);
      if (["city", "location", "company city", "hq city"].includes(k)) setFirst("city", rawV);
      if (["state", "region", "province", "company state", "hq state"].includes(k)) setFirst("state", rawV);
      if (["country", "company country", "hq country"].includes(k)) setFirst("country", rawV);
    }
  }
  return result as {
    job_title?: string;
    industry?: string;
    company_size?: string;
    city?: string;
    state?: string;
    country?: string;
  };
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
    const maxLeads: number = Math.max(1, Number(body?.maxLeads ?? 5000));
    // Optional resumable cursor
    let startIntegration = 0;
    let startCampaign = 0;
    let startLeadOffset = 0;
    if (body?.cursor) {
      try {
        const curObj = typeof body.cursor === "string"
          ? JSON.parse(Buffer.from(String(body.cursor), "base64").toString("utf8"))
          : body.cursor;
        startIntegration = Number(curObj?.integrationIndex ?? 0) || 0;
        startCampaign = Number(curObj?.campaignIndex ?? 0) || 0;
        startLeadOffset = Number(curObj?.leadOffset ?? 0) || 0;
      } catch {
        // ignore malformed cursor
      }
    }

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
    let hasMore = false;
    let nextCursor: { integrationIndex: number; campaignIndex: number; leadOffset: number } | null = null;

    // Helper: additive people upsert from provider row
    const putNonEmpty = (obj: Record<string, unknown>, key: string, val: unknown) => {
      const s = typeof val === "string" ? val : String(val ?? "");
      const t = s.trim();
      if (t && t !== "0") obj[key] = t;
    };

    for (let i = startIntegration; i < integrations.length; i++) {
      const integ = integrations[i];
      if (!integ?.api_key_encrypted) continue;
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

      for (let j = (i === startIntegration ? startCampaign : 0); j < (campaigns ?? []).length; j++) {
        const camp = (campaigns ?? [])[j] as { id: string; team_id: string; external_campaign_id: string; name?: string | null };
        // Page provider leads for this campaign
        let offset = (i === startIntegration && j === startCampaign) ? startLeadOffset : 0;
        const PAGE = 100; // Smartlead page size
        while (true) {
          // Fetch one page of campaign leads from Smartlead
          let page: SmartleadLeadEnvelope | null = null;
          try {
            const res = await smartleadGet(`/campaigns/${encodeURIComponent(camp.external_campaign_id)}/leads?limit=${PAGE}&offset=${offset}`, apiKey!);
            if (!res.ok) {
              const bodyText = await res.text().catch(() => "");
              throw new Error(`Smartlead /campaigns/${camp.external_campaign_id}/leads failed (${res.status}): ${bodyText.substring(0, 300)}`);
            }
            page = await res.json().catch(() => ({} as SmartleadLeadEnvelope));
          } catch (e) {
            console.warn("[backfill-smartlead-sends] leads page fetch failed:", (e as Error).message);
            errors++;
            break;
          }
          const rows = Array.isArray(page?.data) ? page!.data! : [];
          if (rows.length === 0) break;

          for (const row of rows) {
            if (leadsScanned >= maxLeads) break;
            leadsScanned++;
            const lead = row?.lead ?? null;
            const leadId = lead?.id !== undefined && lead?.id !== null ? String(lead.id) : null;
            const email = typeof lead?.email === "string" ? lead!.email.trim().toLowerCase() : "";
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
                    linkedin_url: (typeof lead?.linkedin_profile === "string" && lead.linkedin_profile.trim()) ? lead.linkedin_profile.trim() : null,
                    full_name: [String(lead?.first_name ?? "").trim(), String(lead?.last_name ?? "").trim()]
                      .filter(Boolean).join(" ") || null,
                    // Firmographics snapshot best-effort from custom_fields
                    ...((): Record<string, unknown> => {
                      const fx = extractSmartleadFirmographics(lead?.custom_fields ?? {});
                      return {
                        job_title: fx.job_title ?? null,
                        industry: fx.industry ?? null,
                        company_size: fx.company_size ?? null,
                        city: fx.city ?? null,
                        state: fx.state ?? null,
                        country: fx.country ?? null,
                      };
                    })(),
                    company_name: (typeof lead?.company_name === "string" && lead.company_name.trim()) ? lead.company_name.trim() : null,
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
                  linkedin_url: (typeof lead?.linkedin_profile === "string" && lead.linkedin_profile.trim()) ? lead.linkedin_profile.trim() : null,
                };
                putNonEmpty(p, "full_name", [String(lead?.first_name ?? "").trim(), String(lead?.last_name ?? "").trim()].filter(Boolean).join(" "));
                putNonEmpty(p, "company_name", (lead as any)?.company_name);
                const fx = extractSmartleadFirmographics(lead?.custom_fields ?? {});
                putNonEmpty(p, "job_title", fx.job_title);
                putNonEmpty(p, "industry", fx.industry);
                putNonEmpty(p, "company_size", fx.company_size);
                putNonEmpty(p, "city", fx.city);
                putNonEmpty(p, "state", fx.state);
                putNonEmpty(p, "country", fx.country);
                putNonEmpty(p, "phone", (lead as any)?.phone_number);
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
        if (leadsScanned >= maxLeads) {
          hasMore = true;
          nextCursor = { integrationIndex: i, campaignIndex: j, leadOffset: offset };
          break;
        }
      }
      if (leadsScanned >= maxLeads) break;
    }

    return new Response(JSON.stringify({
      success: true,
      integrations: integrations.length,
      campaigns: totalCampaigns,
      leads_scanned: leadsScanned,
      messages_sent_written: messagesSentWritten,
      messages_sent_skipped: messagesSentSkipped,
      errors,
      hasMore,
      nextCursor,
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

