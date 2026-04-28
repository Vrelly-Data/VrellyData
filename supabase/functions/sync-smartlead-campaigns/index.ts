// [sync-smartlead-campaigns v1]
//
// Manual / cron sync of Smartlead campaigns into synced_campaigns.
//
// Auth (mirrors sync-heyreach-campaigns):
//   - Frontend call: Authorization: Bearer <user-JWT>; we resolve user_id and
//     scope the integration lookup to created_by.
//   - Cron / internal: x-agent-key === AGENT_API_KEY (no JWT needed).
//
// Smartlead API:
//   - Auth in QUERY STRING: ?api_key=KEY. Never log the full URL — it
//     contains the credential. URLs built via URLSearchParams so the key
//     is properly encoded.
//   - GET /campaigns/        → list of campaigns
//   - GET /campaigns/{id}/analytics → per-campaign totals
//
// Status normalization (Smartlead → our normalized vocab):
//   ACTIVE   → in_progress
//   PAUSED   → paused
//   STOPPED  → stopped
//   ARCHIVED → archived
//   DRAFTED  → draft
// Original platform value also stored in synced_campaigns.raw_status.
//
// Note on column names (likely confusing for future readers):
//   * outbound_integrations.api_key_encrypted is misleadingly named — it is
//     stored as plaintext today (sync-heyreach-campaigns and sync-reply-
//     campaigns both use it directly). No decryption helper exists. Treat
//     this column as plaintext until/unless a project-wide encryption pass
//     lands.
//   * synced_campaigns has NO `external_id` / `source`-shape unique key.
//     The unique constraint we upsert against is
//     (integration_id, external_campaign_id) — same as HeyReach. The
//     `source` column added in the Phase A migration is informational
//     (default 'heyreach'), so we explicitly set source='smartlead' here.
//   * Per-campaign metrics live INSIDE the stats JSONB blob, with the
//     same key names HeyReach / Reply.io use (sent, opens, replies, clicks,
//     peopleCount). Smartlead-specific extras get smartlead_-prefixed keys.

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

// Smartlead → normalized status mapping. Anything outside this set falls
// through to a lowercased copy of the source value (so unknown platform
// statuses don't disappear; raw_status holds the original anyway).
function normalizeSmartleadStatus(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  const upper = raw.toUpperCase();
  switch (upper) {
    case "ACTIVE":
      return "in_progress";
    case "PAUSED":
      return "paused";
    case "STOPPED":
      return "stopped";
    case "ARCHIVED":
      return "archived";
    case "DRAFTED":
    case "DRAFT":
      return "draft";
    default:
      return raw.toLowerCase();
  }
}

// Defensive numeric extraction — Smartlead's /analytics field naming isn't
// fully documented, so we accept a small set of likely synonyms per metric
// and fall back to 0. The first real response will surface the actual keys
// in the diagnostics log below; once observed, we can tighten this.
function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

// Sum the values of a "lead status distribution" sub-object if present.
// Smartlead returns a per-status breakdown (INTERESTED / NOT_INTERESTED /
// REPLIED / etc); their sum is the total prospects ever enrolled — same
// concept as HeyReach's peopleCount.
function sumLeadDistribution(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  let total = 0;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
    else if (typeof v === "string" && !Number.isNaN(Number(v))) total += Number(v);
  }
  return total;
}

// Fetch wrapper that builds the URL with URLSearchParams (so api_key is
// safely encoded) and NEVER logs the full URL on error — only the path
// and HTTP status. The body snippet is logged for diagnostics; that's safe
// because Smartlead error bodies don't echo the api_key.
async function smartleadGet(
  pathWithLeadingSlash: string,
  apiKey: string,
): Promise<Response> {
  const url = new URL(`${SMARTLEAD_API_BASE}${pathWithLeadingSlash}`);
  url.searchParams.set("api_key", apiKey);
  return fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
}

interface SmartleadCampaign {
  id?: number | string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let integrationId: string | undefined;

  try {
    // === Auth ===============================================================
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const authHeader = req.headers.get("authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let userId: string | null = null;
    const isInternalCall = !!(
      agentKey && expectedAgentKey && agentKey === expectedAgentKey
    );

    if (!isInternalCall) {
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = user.id;
    }

    // === Body ===============================================================
    const body = await req.json().catch(() => ({}));
    integrationId = (body as { integrationId?: string }).integrationId;
    if (!integrationId) {
      return new Response(
        JSON.stringify({ error: "Missing integrationId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Integration lookup =================================================
    // Service-role client used for both reads and writes — frontend access
    // already gated by the JWT check above, and we need to bypass RLS to
    // update sync_status / write synced_campaigns rows.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let integrationQuery = supabase
      .from("outbound_integrations")
      .select("id, team_id, created_by, api_key_encrypted, platform, is_active")
      .eq("id", integrationId);
    if (userId) {
      integrationQuery = integrationQuery.eq("created_by", userId);
    }

    const { data: integration, error: integrationError } =
      await integrationQuery.maybeSingle();

    if (integrationError || !integration) {
      console.error(
        "[sync-smartlead-campaigns] Integration not found or access denied:",
        integrationError?.message,
      );
      return new Response(
        JSON.stringify({ error: "Integration not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (integration.platform !== "smartlead") {
      return new Response(
        JSON.stringify({
          error: `This function only supports Smartlead integrations (got "${integration.platform}")`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!integration.is_active) {
      return new Response(
        JSON.stringify({ error: "Integration is inactive" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = integration.api_key_encrypted as string | null;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Integration has no API key configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Mark syncing =======================================================
    await supabase
      .from("outbound_integrations")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("id", integration.id);

    console.log(
      `[sync-smartlead-campaigns] Starting sync for integration ${integration.id} (team ${integration.team_id})`,
    );

    // === Fetch campaign list ================================================
    let campaigns: SmartleadCampaign[] = [];
    try {
      const listRes = await smartleadGet("/campaigns/", apiKey);
      if (!listRes.ok) {
        const bodyText = await listRes.text();
        // Log status + body snippet only — never the URL (contains api_key).
        console.error(
          "[sync-smartlead-campaigns] /campaigns list failed:",
          listRes.status,
          bodyText.substring(0, 500),
        );
        throw new Error(`Smartlead /campaigns returned ${listRes.status}`);
      }

      const listJson = await listRes.json();
      // Smartlead /campaigns has historically returned a bare array; tolerate
      // both `[]` and `{ data: [] }` / `{ campaigns: [] }` shapes.
      campaigns = Array.isArray(listJson)
        ? listJson as SmartleadCampaign[]
        : Array.isArray((listJson as { data?: unknown }).data)
          ? (listJson as { data: SmartleadCampaign[] }).data
          : Array.isArray((listJson as { campaigns?: unknown }).campaigns)
            ? (listJson as { campaigns: SmartleadCampaign[] }).campaigns
            : [];
      console.log(
        `[sync-smartlead-campaigns] Fetched ${campaigns.length} campaigns from list`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("outbound_integrations")
        .update({
          sync_status: "error",
          sync_error: msg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Per-campaign sync ==================================================
    let synced = 0;
    let failed = 0;
    let analyticsKeysLogged = false;

    for (const c of campaigns) {
      const externalId =
        c.id !== undefined && c.id !== null ? String(c.id) : null;
      if (!externalId) {
        console.warn(
          "[sync-smartlead-campaigns] Skipping campaign with no id:",
          { keys: Object.keys(c) },
        );
        failed++;
        continue;
      }

      const name = (c.name as string | undefined) ?? "Unnamed Campaign";
      const rawStatus = (c.status as string | undefined) ?? null;
      const normalizedStatus = normalizeSmartleadStatus(rawStatus);

      // Per-campaign analytics. Failures here do NOT abort the whole sync —
      // we still upsert the campaign with zeroed stats so the row appears in
      // the playground.
      let analytics: Record<string, unknown> = {};
      try {
        const aRes = await smartleadGet(
          `/campaigns/${encodeURIComponent(externalId)}/analytics`,
          apiKey,
        );
        if (aRes.ok) {
          analytics = await aRes.json().catch(() => ({}));
          if (!analyticsKeysLogged && analytics && typeof analytics === "object") {
            console.log(
              "[sync-smartlead-campaigns] First /analytics keys:",
              Object.keys(analytics),
            );
            analyticsKeysLogged = true;
          }
        } else {
          const bodyText = await aRes.text();
          console.warn(
            `[sync-smartlead-campaigns] /analytics ${aRes.status} for campaign ${externalId}:`,
            bodyText.substring(0, 300),
          );
        }
      } catch (analyticsErr) {
        console.warn(
          `[sync-smartlead-campaigns] /analytics fetch error for campaign ${externalId}:`,
          analyticsErr,
        );
      }

      // Map analytics → stats keys. Field-name candidates are deliberately
      // generous; first real response will narrow them via the keys log.
      const sent = pickNumber(analytics, [
        "sent",
        "sent_count",
        "total_sent",
        "sent_emails",
      ]);
      const opens = pickNumber(analytics, [
        "opens",
        "open_count",
        "unique_opens",
        "unique_open_count",
        "opened",
      ]);
      const clicks = pickNumber(analytics, [
        "clicks",
        "click_count",
        "unique_clicks",
        "unique_click_count",
        "clicked",
      ]);
      const replies = pickNumber(analytics, [
        "replies",
        "reply_count",
        "unique_replies",
        "replied",
      ]);
      const bounces = pickNumber(analytics, [
        "bounces",
        "bounce_count",
        "bounced",
      ]);

      // peopleCount: prefer an explicit total field if Smartlead returns one;
      // fall back to summing the lead-status distribution. Same semantic as
      // HeyReach.peopleCount and Reply.io.peopleCount so the frontend reads
      // it without a per-platform branch.
      let peopleCount = pickNumber(analytics, [
        "total_count",
        "leads_count",
        "lead_count",
        "total_leads",
        "people_count",
        "peopleCount",
      ]);
      const leadDistribution =
        (analytics.lead_distribution as unknown) ??
        (analytics.lead_status_distribution as unknown) ??
        (analytics.leads_by_status as unknown) ??
        null;
      if (peopleCount === 0 && leadDistribution) {
        peopleCount = sumLeadDistribution(leadDistribution);
      }

      const stats = {
        // Cross-platform keys (frontend reads these directly).
        sent,
        opens,
        clicks,
        replies,
        bounces,
        peopleCount,
        // Smartlead-specific extras live under prefixed keys so future
        // platform-agnostic readers don't accidentally pick them up.
        smartlead_lead_distribution: leadDistribution ?? null,
        smartlead_raw_analytics: analytics,
      };

      const { error: upsertError } = await supabase
        .from("synced_campaigns")
        .upsert(
          {
            integration_id: integration.id,
            team_id: integration.team_id,
            external_campaign_id: externalId,
            name,
            status: normalizedStatus,
            raw_status: rawStatus,
            source: "smartlead",
            stats,
            raw_data: c,
            is_linked: true,
            // last_synced_at column doesn't exist on synced_campaigns;
            // updated_at is bumped by the existing trigger on UPDATE.
          },
          { onConflict: "integration_id,external_campaign_id" },
        );

      if (upsertError) {
        console.error(
          `[sync-smartlead-campaigns] Upsert error for campaign ${externalId}:`,
          upsertError.message,
        );
        failed++;
        continue;
      }

      synced++;

      // Gentle pacing between analytics calls.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // === Final integration status ==========================================
    const finalStatus = failed > 0 && synced === 0 ? "error" : "synced";
    const syncErrorText =
      failed > 0
        ? `Synced ${synced}/${campaigns.length} campaigns (${failed} failed)`
        : null;

    await supabase
      .from("outbound_integrations")
      .update({
        sync_status: finalStatus,
        sync_error: syncErrorText,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id);

    console.log(
      `[sync-smartlead-campaigns] Done. Integration ${integration.id}: synced=${synced}, failed=${failed}, total=${campaigns.length}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        synced,
        failed,
        total: campaigns.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-smartlead-campaigns] Fatal error:", err);

    if (integrationId) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );
        await supabase
          .from("outbound_integrations")
          .update({
            sync_status: "error",
            sync_error: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integrationId);
      } catch (updErr) {
        console.error(
          "[sync-smartlead-campaigns] Failed to update error status:",
          updErr,
        );
      }
    }

    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
