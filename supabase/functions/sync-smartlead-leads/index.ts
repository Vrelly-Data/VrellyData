// [sync-smartlead-leads]
//
// Import Smartlead leads into synced_contacts for capture-enabled campaigns only.
// Mirrors auth and API patterns from sync-smartlead-campaigns, and row shape / upsert
// identity from sync-reply-contacts.
//
// Hard constraints:
// - ONLY campaigns where synced_campaigns.capture_enabled = true (for this integration)
// - NO people creates / NO agent_leads creates
// - Upsert into synced_contacts only (email, phone, linkedin_url, names, company, campaign_id, team_id, external_contact_id)
// - Smartlead API auth via ?api_key= (query), never log full URL
// - Pagination: limit=100 with offset loop
//
// Request body: { integrationId: string }
// Response: { campaigns_processed, contacts_upserted, skipped_no_email, errors }
//
// Source: https://server.smartlead.ai/api/v1
// Endpoint: GET /campaigns/{external_campaign_id}/leads?offset=&limit=100
// Observed response:
// {
//   total_leads,
//   data: [
//     {
//       campaign_lead_map_id,
//       lead: {
//         id, email, phone_number, linkedin_profile,
//         first_name, last_name, company_name, custom_fields
//       }
//     }
//   ]
// }
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

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

// Safe GET wrapper that appends api_key via URLSearchParams and never logs the full URL.
async function smartleadGet(pathWithLeadingSlash: string, apiKey: string): Promise<Response> {
  const url = new URL(`${SMARTLEAD_API_BASE}${pathWithLeadingSlash}`);
  url.searchParams.set("api_key", apiKey);
  return fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
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
      custom_fields?: unknown;
      [k: string]: unknown;
    } | null;
    [k: string]: unknown;
  }>;
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let integrationId: string | undefined;

  try {
    // Auth: JWT (frontend) OR x-agent-key (internal cron)
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternalCall = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    let userId: string | null = null;
    if (!isInternalCall) {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    integrationId = (body?.integrationId as string | undefined) || undefined;
    if (!integrationId) {
      return new Response(JSON.stringify({ error: "Missing integrationId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service-role client for reads/writes (RLS bypass). Frontend is gated above.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Integration lookup (scoped to user for frontend calls).
    let integrationQuery = supabase
      .from("outbound_integrations")
      .select("id, team_id, created_by, api_key_encrypted, platform, is_active")
      .eq("id", integrationId);
    if (userId) {
      integrationQuery = integrationQuery.eq("created_by", userId);
    }
    const { data: integration, error: integrationError } = await integrationQuery.maybeSingle();
    if (integrationError || !integration) {
      return new Response(JSON.stringify({ error: "Integration not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (integration.platform !== "smartlead") {
      return new Response(JSON.stringify({ error: `This function only supports Smartlead integrations (got "${integration.platform}")` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!integration.is_active) {
      return new Response(JSON.stringify({ error: "Integration is inactive" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const apiKey = integration.api_key_encrypted as string | null;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Integration has no API key configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch capture-enabled campaigns for this integration.
    // NOTE: capture_enabled is cross-platform; for safety we scope by this integration_id.
    const { data: campaigns, error: campaignsError } = await supabase
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("integration_id", integration.id)
      .eq("capture_enabled", true);
    if (campaignsError) {
      return new Response(JSON.stringify({ error: `Failed to load campaigns: ${campaignsError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let campaignsProcessed = 0;
    let contactsUpserted = 0;
    let skippedNoEmail = 0;
    const errors: Array<{ campaign_id: string; external_campaign_id: string; error: string }> = [];

    // Service-role client for writes
    const serviceClient = supabase;

    // Helper to page Smartlead leads
    async function fetchLeadsPage(externalCampaignId: string, offset: number): Promise<SmartleadLeadEnvelope> {
      const res = await smartleadGet(`/campaigns/${encodeURIComponent(externalCampaignId)}/leads?limit=100&offset=${offset}`, apiKey!);
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`Smartlead /campaigns/${externalCampaignId}/leads failed (${res.status}): ${bodyText.substring(0, 300)}`);
      }
      const json = await res.json().catch(() => ({}));
      return (json || {}) as SmartleadLeadEnvelope;
    }

    for (const c of campaigns ?? []) {
      const campaignId = (c as { id: string }).id;
      const externalId = String((c as { external_campaign_id: string }).external_campaign_id || "");
      const teamId = (c as { team_id: string }).team_id;
      if (!externalId) {
        // Should not happen for synced campaigns, but be defensive.
        errors.push({ campaign_id: campaignId, external_campaign_id: externalId, error: "Missing external_campaign_id" });
        continue;
      }

      try {
        let offset = 0;
        let total = 0;
        let first = true;

        while (true) {
          const page = await fetchLeadsPage(externalId, offset);
          const data = Array.isArray(page.data) ? page.data : [];
          if (first) {
            total = typeof page.total_leads === "number" ? page.total_leads : data.length;
            first = false;
          }

          if (data.length === 0) break;

          // Map → upsert records
          const records: Array<Record<string, unknown>> = [];
          for (const row of data) {
            const lead = row?.lead ?? null;
            const email = (typeof lead?.email === "string" ? lead!.email.trim().toLowerCase() : "") || "";
            if (!email) {
              skippedNoEmail++;
              continue;
            }

            records.push({
              campaign_id: campaignId,
              team_id: teamId,
              external_contact_id: lead?.id !== undefined && lead?.id !== null ? String(lead?.id) : null,
              email,
              first_name: typeof lead?.first_name === "string" && lead.first_name.trim() ? lead.first_name.trim() : null,
              last_name: typeof lead?.last_name === "string" && lead.last_name.trim() ? lead.last_name.trim() : null,
              company: typeof lead?.company_name === "string" && lead.company_name.trim() ? lead.company_name.trim() : null,
              phone: typeof lead?.phone_number === "string" && lead.phone_number.trim() ? lead.phone_number.trim() : null,
              linkedin_url: typeof lead?.linkedin_profile === "string" && lead.linkedin_profile.trim() ? lead.linkedin_profile.trim() : null,
            });
          }

          if (records.length > 0) {
            const { error: upsertError } = await serviceClient
              .from("synced_contacts")
              .upsert(records, { onConflict: "campaign_id,email" });

            if (upsertError) {
              throw new Error(`Upsert failed for campaign ${externalId}: ${upsertError.message}`);
            }
            contactsUpserted += records.length;
          }

          offset += data.length;
          if (offset >= total) break;
          if (data.length < 100) break; // short page
          await new Promise((r) => setTimeout(r, 200)); // gentle pacing
        }

        campaignsProcessed++;
      } catch (e) {
        errors.push({
          campaign_id: campaignId,
          external_campaign_id: externalId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({
        campaigns_processed: campaignsProcessed,
        contacts_upserted: contactsUpserted,
        skipped_no_email: skippedNoEmail,
        errors,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-smartlead-leads] Fatal error:", err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

