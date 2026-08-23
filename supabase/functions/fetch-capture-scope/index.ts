// [fetch-capture-scope v1] — Capture Scope read path. Stage 2 of 5.
//
// READ-ONLY. Writes nothing, changes no capture behaviour. Stage 3 consumes it
// from the UI; Stages 4-5 add enforcement.
//
// NOT A REPLACEMENT FOR fetch-available-campaigns. That function serves
// Reply.io's ManageCampaignsDialog and is deliberately untouched and never
// redeployed by this feature. This is a separate function for the platforms
// that have no capture control at all today (Smartlead, HeyReach), so a bug
// here cannot reach Reply.io.
//
// Modes:
//   list    (default) — every campaign for the integration, from
//                       synced_campaigns. One query; no vendor API call.
//   senders           — live senders for a BOUNDED page of campaign ids.
//                       Separate because Smartlead exposes senders only per
//                       campaign against a 200 req/min account limit, and
//                       SourceCo alone has 379 campaigns.
//
// Auth mirrors sync-smartlead-campaigns: x-agent-key for internal callers, or
// a user JWT, in which case the integration lookup is scoped to created_by.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getAdapter,
  registerAdapter,
  MAX_SENDER_LOOKUP,
  supportedPlatforms,
  type CaptureScopeIntegration,
} from "../_shared/capture-scope.ts";
import { smartleadCaptureScopeAdapter } from "../_shared/capture-scope-smartlead.ts";
import { heyreachCaptureScopeAdapter } from "../_shared/capture-scope-heyreach.ts";

// Registering only implemented adapters keeps the error message honest: an
// unsupported platform (reply.io) gets a clear 400 rather than failing deeper.
registerAdapter(smartleadCaptureScopeAdapter);
registerAdapter(heyreachCaptureScopeAdapter);

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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // === Auth ===============================================================
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternal = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);

    let userId: string | null = null;
    if (!isInternal) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    // === Body ===============================================================
    const body = await req.json().catch(() => ({}));
    const integrationId = (body as { integrationId?: string }).integrationId;
    const mode = ((body as { mode?: string }).mode ?? "list").toLowerCase();
    const externalIds = Array.isArray((body as { externalIds?: string[] }).externalIds)
      ? (body as { externalIds: string[] }).externalIds.map(String)
      : [];

    if (!integrationId) return json({ error: "Missing integrationId" }, 400);
    if (mode !== "list" && mode !== "senders") {
      return json({ error: `Unknown mode '${mode}' (expected 'list' or 'senders')` }, 400);
    }

    // === Integration ========================================================
    const db = createClient(supabaseUrl, serviceKey);
    let q = db
      .from("outbound_integrations")
      .select("id, team_id, platform, api_key_encrypted, created_by, is_active")
      .eq("id", integrationId);
    // JWT callers only see their own integrations; the service client bypasses
    // RLS, so this scoping is what replaces it.
    if (userId) q = q.eq("created_by", userId);

    const { data: integration, error: intErr } = await q.maybeSingle();
    if (intErr) return json({ error: `Integration lookup failed: ${intErr.message}` }, 500);
    if (!integration) return json({ error: "Integration not found or access denied" }, 404);

    const adapter = getAdapter(integration.platform);
    if (!adapter) {
      // Reply.io lands here by design — it is served by the untouched
      // fetch-available-campaigns path, not this one.
      return json({
        error: `Capture Scope does not manage '${integration.platform}' integrations`,
        supported: supportedPlatforms(),
      }, 400);
    }

    const scopeIntegration: CaptureScopeIntegration = {
      id: integration.id,
      team_id: integration.team_id,
      platform: integration.platform,
      api_key_encrypted: integration.api_key_encrypted ?? null,
    };

    // === senders ============================================================
    if (mode === "senders") {
      if (!adapter.listSenders) {
        return json({ error: `${integration.platform} cannot list senders per campaign`, senders: {} });
      }
      if (externalIds.length === 0) return json({ error: "externalIds required for mode 'senders'" }, 400);
      if (externalIds.length > MAX_SENDER_LOOKUP) {
        return json({
          error: `Too many campaigns in one request (${externalIds.length} > ${MAX_SENDER_LOOKUP}). Page the request.`,
          max: MAX_SENDER_LOOKUP,
        }, 400);
      }
      const senders = await adapter.listSenders(scopeIntegration, externalIds);
      return json({ platform: integration.platform, senders });
    }

    // === list ===============================================================
    const campaigns = await adapter.listCampaigns(db, scopeIntegration);

    // Group summary so the UI can render tenant sections without re-scanning.
    const groups = new Map<string, { id: string; label: string; campaignCount: number }>();
    let ungrouped = 0;
    for (const c of campaigns) {
      if (!c.group) { ungrouped++; continue; }
      const g = groups.get(c.group.id) ?? { ...c.group, campaignCount: 0 };
      g.campaignCount++;
      groups.set(c.group.id, g);
    }

    return json({
      platform: integration.platform,
      integrationId: integration.id,
      campaigns,
      groups: [...groups.values()].sort((a, b) => b.campaignCount - a.campaignCount),
      ungroupedCount: ungrouped,
      counts: {
        total: campaigns.length,
        captureEnabled: campaigns.filter((c) => c.captureEnabled).length,
        captureDisabled: campaigns.filter((c) => !c.captureEnabled).length,
      },
      // Two DIFFERENT questions, and conflating them hid HeyReach's senders:
      //   sendersAvailable — can this platform show senders at all? Drives
      //     whether the UI renders the reveal control.
      //   sendersDeferred  — must the UI make a second call to get them?
      //     True for Smartlead (one API call per campaign, rate-limited so it
      //     has to be lazy and paged); false for HeyReach, whose campaigns
      //     carry campaignAccountIds in already-synced raw_data and so arrive
      //     fully populated from `list`.
      sendersAvailable: !!adapter.listSenders || campaigns.some((c) => c.senders.length > 0),
      sendersDeferred: !!adapter.listSenders,
      maxSenderLookup: MAX_SENDER_LOOKUP,
    });
  } catch (e) {
    console.error("[fetch-capture-scope] error:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
