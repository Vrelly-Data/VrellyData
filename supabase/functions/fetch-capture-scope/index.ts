// [fetch-capture-scope v2] — Capture Scope API for every platform with a
// capture gate: Reply.io, Smartlead and HeyReach. Each platform is one adapter
// in the shared registry (_shared/capture-scope*.ts); a 4th platform needs a
// new adapter and nothing here.
//
// NOT A REPLACEMENT FOR fetch-available-campaigns. That function serves
// Reply.io's ManageCampaignsDialog (is_linked, Data Analysis scope), which has
// never gated capture. This function serves the Capture Scope UI
// (capture_enabled).
//
// Modes:
//   list      (default) — every campaign for the integration, from
//                         synced_campaigns, plus skipped replies (last 14 days,
//                         not yet recaptured) per campaign and the integration's
//                         auto_capture_new_campaigns setting. No vendor call.
//   senders             — live senders for a BOUNDED page of campaign ids.
//                         Separate because Smartlead exposes senders only per
//                         campaign against a 200 req/min account limit, and
//                         SourceCo alone has 379 campaigns.
//   recapture           — for campaigns that are capture-enabled NOW, marks
//                         their skips recaptured and asks the platform's poller
//                         (adapter.recaptureFunction) to re-read the last 14
//                         days for just those campaigns. Fire-and-forget.
//
// Auth: x-agent-key for internal callers, or a user JWT. A JWT caller may use
// any integration of their own team: the integration is first read through
// the caller's RLS-scoped client (outbound_integrations is team-readable), so
// access matches exactly what the UI can see. Writes (capture_enabled, the
// auto-capture setting) are made by the UI directly under the same RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getAdapter,
  registerAdapter,
  MAX_SENDER_LOOKUP,
  normalizeCampaignId,
  RECAPTURE_LOOKBACK_DAYS,
  supportedPlatforms,
  type CaptureScopeIntegration,
} from "../_shared/capture-scope.ts";
import { smartleadCaptureScopeAdapter } from "../_shared/capture-scope-smartlead.ts";
import { heyreachCaptureScopeAdapter } from "../_shared/capture-scope-heyreach.ts";
import { replyioCaptureScopeAdapter } from "../_shared/capture-scope-replyio.ts";

// Every platform whose capture is gated must be registered here: the UI shows
// the Capture Scope button for exactly these platforms.
registerAdapter(replyioCaptureScopeAdapter);
registerAdapter(smartleadCaptureScopeAdapter);
registerAdapter(heyreachCaptureScopeAdapter);

const MAX_RECAPTURE_CAMPAIGNS = 50;

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

    // deno-lint-ignore no-explicit-any
    let userClient: any = null;
    if (!isInternal) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
    }

    // === Body ===============================================================
    const body = await req.json().catch(() => ({}));
    const integrationId = (body as { integrationId?: string }).integrationId;
    const mode = ((body as { mode?: string }).mode ?? "list").toLowerCase();
    const externalIds = Array.isArray((body as { externalIds?: string[] }).externalIds)
      ? (body as { externalIds: string[] }).externalIds.map(String)
      : [];

    if (!integrationId) return json({ error: "Missing integrationId" }, 400);
    if (mode !== "list" && mode !== "senders" && mode !== "recapture") {
      return json({ error: `Unknown mode '${mode}' (expected 'list', 'senders' or 'recapture')` }, 400);
    }

    // === Integration ========================================================
    // JWT callers: the integration must be visible through THEIR RLS-scoped
    // client (team members, not just the creator). Everything after that uses
    // the service client, scoped to this one integration id.
    if (userClient) {
      const { data: visible, error: visErr } = await userClient
        .from("outbound_integrations")
        .select("id")
        .eq("id", integrationId)
        .maybeSingle();
      if (visErr) return json({ error: `Integration lookup failed: ${visErr.message}` }, 500);
      if (!visible) return json({ error: "Integration not found or access denied" }, 404);
    }
    const db = createClient(supabaseUrl, serviceKey);
    const { data: integration, error: intErr } = await db
      .from("outbound_integrations")
      .select("id, team_id, platform, api_key_encrypted, created_by, is_active, auto_capture_new_campaigns")
      .eq("id", integrationId)
      .maybeSingle();
    if (intErr) return json({ error: `Integration lookup failed: ${intErr.message}` }, 500);
    if (!integration) return json({ error: "Integration not found or access denied" }, 404);

    const adapter = getAdapter(String(integration.platform ?? "").trim().toLowerCase());
    if (!adapter) {
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

    // === recapture ==========================================================
    if (mode === "recapture") {
      const requested = [...new Set(externalIds.map((id) => normalizeCampaignId(id)).filter((id): id is string => !!id))];
      if (requested.length === 0) return json({ error: "externalIds required for mode 'recapture'" }, 400);
      if (requested.length > MAX_RECAPTURE_CAMPAIGNS) {
        return json({ error: `Too many campaigns in one recapture (${requested.length} > ${MAX_RECAPTURE_CAMPAIGNS})` }, 400);
      }
      // Only campaigns that are capture-enabled NOW: a recapture must never
      // pull in replies for a campaign the user has switched off.
      const { data: enabledRows, error: enErr } = await db
        .from("synced_campaigns")
        .select("external_campaign_id")
        .eq("integration_id", integration.id)
        .eq("capture_enabled", true)
        .in("external_campaign_id", requested);
      if (enErr) return json({ error: `Campaign lookup failed: ${enErr.message}` }, 500);
      const campaignIds = (enabledRows ?? []).map((r: { external_campaign_id: string }) => String(r.external_campaign_id));
      if (campaignIds.length === 0) {
        return json({ error: "None of these campaigns is capture-enabled", requested }, 400);
      }

      const agentApiKey = Deno.env.get("AGENT_API_KEY") || "";
      const run = fetch(`${supabaseUrl}/functions/v1/${adapter.recaptureFunction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": agentApiKey },
        body: JSON.stringify({
          mode: "recapture",
          integrationId: integration.id,
          campaignIds,
          lookbackDays: RECAPTURE_LOOKBACK_DAYS,
        }),
      })
        .then(async (res) => {
          const text = await res.text().catch(() => "");
          console.log(`[fetch-capture-scope] recapture ${adapter.recaptureFunction} integration=${integration.id} campaigns=${campaignIds.length} -> HTTP ${res.status} ${text.slice(0, 300)}`);
        })
        .catch((e) => console.error(`[fetch-capture-scope] recapture call failed: ${e instanceof Error ? e.message : String(e)}`));
      // @ts-ignore EdgeRuntime is provided by Supabase
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-ignore
        EdgeRuntime.waitUntil(run);
      } else {
        await run;
      }

      // The badge counts skips not yet recaptured; a newer skip clears this.
      const { error: markErr } = await db
        .from("capture_scope_skips")
        .update({ recaptured_at: new Date().toISOString() })
        .eq("integration_id", integration.id)
        .in("campaign_external_id", campaignIds)
        .is("recaptured_at", null);
      if (markErr) console.warn(`[fetch-capture-scope] could not mark skips recaptured: ${markErr.message}`);

      return json({
        platform: integration.platform,
        integrationId: integration.id,
        recapture: { started: true, campaignIds, lookbackDays: RECAPTURE_LOOKBACK_DAYS, function: adapter.recaptureFunction },
        skippedNotEnabled: requested.filter((id) => !campaignIds.includes(id)),
      }, 202);
    }

    // === list ===============================================================
    const listed = await adapter.listCampaigns(db, scopeIntegration);

    // Skipped replies per campaign: last 14 days, not yet recaptured.
    const skipSince = new Date(Date.now() - RECAPTURE_LOOKBACK_DAYS * 86400_000).toISOString();
    const skipsByCampaign = new Map<string, { count: number; lastAt: string }>();
    {
      const { data: skips, error: skipErr } = await db
        .from("capture_scope_skips")
        .select("campaign_external_id, occurred_at")
        .eq("integration_id", integration.id)
        .gte("occurred_at", skipSince)
        .is("recaptured_at", null)
        .limit(5000);
      if (skipErr) console.warn(`[fetch-capture-scope] skip lookup failed (badges omitted): ${skipErr.message}`);
      for (const s of (skips ?? []) as { campaign_external_id: string; occurred_at: string }[]) {
        const key = String(s.campaign_external_id);
        const cur = skipsByCampaign.get(key) ?? { count: 0, lastAt: s.occurred_at };
        cur.count++;
        if (s.occurred_at > cur.lastAt) cur.lastAt = s.occurred_at;
        skipsByCampaign.set(key, cur);
      }
    }
    const campaigns = listed.map((c) => {
      const s = skipsByCampaign.get(c.externalId);
      return { ...c, skippedReplies: s ? { count: s.count, lastAt: s.lastAt } : null };
    });

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
        skippedReplies: campaigns.reduce((n, c) => n + (c.skippedReplies?.count ?? 0), 0),
      },
      autoCaptureNewCampaigns: integration.auto_capture_new_campaigns !== false,
      skippedRepliesWindowDays: RECAPTURE_LOOKBACK_DAYS,
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
