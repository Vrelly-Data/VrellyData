// [backfill-provider-tags v2]
//
// Backfill provider "interested" / stage / reply-type tags into
// public.inference_events as first-class 'classified' outcomes, without relying
// on Vrelly classify-reply. Pilot implements Smartlead; Reply.io can be added
// in a follow-up using /v3/contacts/{id}/statuses.
//
// Auth: internal only via x-agent-key (AGENT_API_KEY). No frontend JWT allowed.
//
// Request body:
//   {
//     platform: "smartlead",          // required (pilot)
//     integrationId?: string,         // run for one integration...
//     teamId?: string,                // ...or all active integrations on a team
//     maxLeads?: number,              // per-run cap (default 5000)
//     cursor?: { integrationIndex?: number; campaignIndex?: number; leadOffset?: number } | string(base64-json)
//   }
//
// Mapping (provider → standardized intent):
//   interested, positive                    -> interested
//   not_interested, negative                -> not_interested
//   referral                                -> referral
//   out_of_office, ooo                      -> out_of_office
//   maybe_later, follow_up, needs_followup  -> needs_more_info
//   unsubscribed, do_not_contact, opted_out -> (event_type='opted_out')  // not 'classified'
//
// Storage:
//   - inference_events:
//       event_type: 'classified' (or 'opted_out')
//       intent: one of the standardized values above (null for opted_out)
//       source: 'smartlead_provider_tag' (pilot)
//       source_row_id: "smartlead:lead:{lead_id}:tag:{PROVIDER_TAG}"
//       channel: 'email'
//       metadata.provider_tag: original provider tag
//   - people upsert: additive, write-only (no null-clobber)
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function mapProviderTagToIntent(raw: string): { event_type: "classified" | "opted_out"; intent: string | null } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!s) return null;
  if (["interested", "positive"].includes(s)) return { event_type: "classified", intent: "interested" };
  if (["not_interested", "notinterested", "negative"].includes(s)) return { event_type: "classified", intent: "not_interested" };
  if (["referral"].includes(s)) return { event_type: "classified", intent: "referral" };
  if (["out_of_office", "ooo"].includes(s)) return { event_type: "classified", intent: "out_of_office" };
  if (["maybe_later", "follow_up", "followup", "needs_followup", "needs_more_info"].includes(s)) return { event_type: "classified", intent: "needs_more_info" };
  if (["unsubscribed", "do_not_contact", "dnc", "opted_out", "optout"].includes(s)) return { event_type: "opted_out", intent: null };
  return null;
}

async function smartleadGet(pathWithLeadingSlash: string, apiKey: string): Promise<Response> {
  const url = new URL(`${SMARTLEAD_API_BASE}${pathWithLeadingSlash}`);
  url.searchParams.set("api_key", apiKey);
  return fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });
}

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
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  }>;
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const agentKey = req.headers.get("x-agent-key") || "";
    const expected = Deno.env.get("AGENT_API_KEY") || "";
    if (!agentKey || !expected || agentKey !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const platform = String(body?.platform || "").toLowerCase();
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

    if (!platform || (platform !== "smartlead")) {
      return new Response(JSON.stringify({ error: "platform must be 'smartlead' (pilot)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!integrationId && !teamId) {
      return new Response(JSON.stringify({ error: "Provide integrationId OR teamId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let leadsScanned = 0;
    let eventsWritten = 0;
    let eventsSkipped = 0;
    let errors = 0;
    let hasMore = false;
    let nextCursor: { integrationIndex: number; campaignIndex: number; leadOffset: number } | null = null;

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
      const { data: campaigns } = await supabase
        .from("synced_campaigns")
        .select("id, team_id, external_campaign_id, name")
        .eq("integration_id", integ.id)
        .eq("capture_enabled", true)
        .eq("source", "smartlead");

      for (let j = (i === startIntegration ? startCampaign : 0); j < (campaigns ?? []).length; j++) {
        const camp = (campaigns ?? [])[j] as { id: string; team_id: string; external_campaign_id: string; name?: string | null };
        let offset = (i === startIntegration && j === startCampaign) ? startLeadOffset : 0;
        const PAGE = 100;
        while (true) {
          // Fetch provider roster for this campaign
          let page: SmartleadLeadEnvelope | null = null;
          try {
            const res = await smartleadGet(`/campaigns/${encodeURIComponent(camp.external_campaign_id)}/leads?limit=${PAGE}&offset=${offset}`, apiKey!);
            if (!res.ok) {
              const bodyText = await res.text().catch(() => "");
              throw new Error(`Smartlead /campaigns/${camp.external_campaign_id}/leads failed (${res.status}): ${bodyText.substring(0, 300)}`);
            }
            page = await res.json().catch(() => ({} as SmartleadLeadEnvelope));
          } catch (e) {
            console.warn("[backfill-provider-tags] leads page fetch failed:", (e as Error).message);
            errors++;
            break;
          }
          const rows = Array.isArray(page?.data) ? page!.data! : [];
          if (rows.length === 0) break;

          for (const row of rows) {
            if (leadsScanned >= maxLeads) break;
            leadsScanned++;
            const lead = row?.lead ?? null;
            const email = typeof lead?.email === "string" ? lead!.email.trim().toLowerCase() : "";
            if (!email) continue;
            try {
              // Fetch Smartlead lead by email; extract a category/status-like field
              const leadsUrl = new URL(`${SMARTLEAD_API_BASE}/leads/`);
              leadsUrl.searchParams.set("api_key", apiKey);
              leadsUrl.searchParams.set("email", email);
              const res = await fetch(leadsUrl.toString(), { headers: { Accept: "application/json" } });
              if (!res.ok) { eventsSkipped++; continue; }
              const body = await res.json().catch(() => null);
              const lead = Array.isArray(body) ? body[0] : body;
              if (!lead || typeof lead !== "object") { eventsSkipped++; continue; }

              // Probe common keys; tolerate various shapes (string or nested)
              let providerTag: string | null = null;
              const get = (k: string) => (lead as any)[k];
              const candidates = [
                get("lead_category"),
                get("category"),
                get("reply_type"),
                get("status"),
                get("stage"),
              ].filter(Boolean);
              for (const c of candidates) {
                if (typeof c === "string" && c.trim()) { providerTag = c.trim(); break; }
                if (c && typeof c === "object") {
                  for (const v of Object.values(c)) {
                    if (typeof v === "string" && v.trim()) { providerTag = v.trim(); break; }
                  }
                }
                if (providerTag) break;
              }
              if (!providerTag) { eventsSkipped++; continue; }
              const mapped = mapProviderTagToIntent(providerTag);
              if (!mapped) { eventsSkipped++; continue; }

              const teamId = (camp as any).team_id as string;
              const occurredAt =
                (typeof (lead as any)?.updated_at === "string" && (lead as any).updated_at) ||
                new Date().toISOString();
              const sourceRowId = `smartlead:lead:${(lead as any)?.id ?? email}:tag:${providerTag.toLowerCase()}`;

              // Upsert event
              const { error: ieErr } = await supabase
                .from("inference_events")
                // @ts-ignore onConflict supports column-list
                .upsert({
                  team_id: teamId,
                  person_key: email,
                  email,
                  linkedin_url: (typeof (row?.lead?.linkedin_profile) === "string" && (row?.lead?.linkedin_profile as string).trim())
                    ? (row?.lead?.linkedin_profile as string).trim() : null,
                  full_name: [String(row?.lead?.first_name ?? "").trim(), String(row?.lead?.last_name ?? "").trim()]
                    .filter(Boolean).join(" ") || null,
                  job_title: null,
                  company_name: (typeof row?.lead?.company_name === "string" && row?.lead?.company_name?.trim()) ? (row?.lead?.company_name as string).trim() : null,
                  industry: null,
                  city: null,
                  state: null,
                  country: null,
                  company_size: null,
                  channel: "email",
                  campaign_external_id: String((camp as any).external_campaign_id ?? ""),
                  campaign_name: (camp as any)?.name ?? null,
                  sequence_step_type: "email",
                  copy_fingerprint: null,
                  subject: null,
                  event_type: mapped.event_type,
                  intent: mapped.intent,
                  is_objection: null,
                  pipeline_stage: mapped.event_type === "classified" ? "replied" : "closed_lost",
                  disposition_tag: mapped.event_type === "opted_out" ? "opted_out" : null,
                  occurred_at: occurredAt,
                  source: "smartlead_provider_tag",
                  source_row_id: sourceRowId,
                  metadata: {
                    provider: "smartlead",
                    provider_tag: providerTag,
                  },
                }, { onConflict: "source,source_row_id,event_type" });
              if (ieErr) eventsSkipped++; else eventsWritten++;

              // Additive people upsert (optional)
              const p: Record<string, unknown> = {
                team_id: teamId,
                person_key: email,
                email,
                linkedin_url: (typeof (row?.lead?.linkedin_profile) === "string" && (row?.lead?.linkedin_profile as string).trim())
                  ? (row?.lead?.linkedin_profile as string).trim() : null,
              };
              putNonEmpty(p, "full_name", [String(row?.lead?.first_name ?? "").trim(), String(row?.lead?.last_name ?? "").trim()].filter(Boolean).join(" "));
              putNonEmpty(p, "company_name", (row?.lead as any)?.company_name);
              putNonEmpty(p, "phone", (row?.lead as any)?.phone_number);
              await supabase.from("people")
                // @ts-ignore onConflict supports column-list
                .upsert(p, { onConflict: "team_id,person_key" });

              await new Promise((r) => setTimeout(r, 150));
            } catch (e) {
              console.warn("[backfill-provider-tags] smartlead fetch failed:", (e as Error).message);
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
      platform,
      leads_scanned: leadsScanned,
      events_written: eventsWritten,
      events_skipped: eventsSkipped,
      errors,
      hasMore,
      nextCursor,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill-provider-tags] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

