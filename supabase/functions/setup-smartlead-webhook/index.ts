// [setup-smartlead-webhook v1]
//
// Registers our smartlead-webhook receiver on a Smartlead integration's
// campaigns. Mirrors setup-reply-webhook's contract: POST { integrationId },
// idempotent, always 200 with a { success, ... } body, and it writes
// webhook_status / webhook_subscription_id back onto outbound_integrations.
//
// === Why per-campaign ======================================================
// Smartlead has NO account-level webhook endpoint. Verified against the live
// API on 2026-07-29:
//   GET  /api/v1/webhooks              -> 404 "Cannot GET /api/v1/webhooks"
//   POST /api/v1/webhooks              -> 404 "Cannot POST /api/v1/webhooks"
//   POST /api/v1/campaigns/{id}/webhooks -> 200 (the only route that works)
// So one registration per campaign it is. Docs indexes that imply a global
// /webhooks resource are wrong.
//
// === Wire format (discovered against the live API, not guessed) =============
//   POST /api/v1/campaigns/{id}/webhooks?api_key=...
//     { "name": "...", "webhook_url": "...", "event_types": ["EMAIL_REPLY"] }
//   -> 200 { ok: true, id: 704949, name, webhook_url, email_campaign_id,
//            event_type_map: { EMAIL_REPLY: true }, category_id_map: {}, user_id }
//
//   GET    /api/v1/campaigns/{id}/webhooks?api_key=...   -> [ { id, name,
//            webhook_url, email_campaign_id, event_types[], categories[] } ]
//   DELETE /api/v1/campaigns/{id}/webhooks?api_key=...   body { id } -> { ok: true }
//
// EMAIL_REPLY is the correct constant — it matches both the documented event
// enum and the event_type on real inbound payloads.
//
// === Routing token =========================================================
// The callback URL carries TWO secrets:
//   ?secret=<SMARTLEAD_WEBHOOK_SECRET>  — shared, authenticates the caller
//   &t=<outbound_integrations.webhook_secret> — per-integration, identifies
//                                               WHICH client the event belongs to
// The Smartlead payload contains nothing that maps to one of our integrations,
// so without `t` the receiver would have to guess — which was a live
// cross-tenant defect. A token is minted here if the integration has none.

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

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const EVENT_TYPES = ["EMAIL_REPLY"];
const WEBHOOK_NAME = "Vrelly Agent — reply capture";

// Campaign statuses that can still produce a reply. `draft` has never sent, and
// `stopped` is terminal — registering on either just burns API calls. Overridable
// per-call so a caller can widen or narrow the sweep.
const DEFAULT_STATUSES = ["in_progress", "paused", "completed"];

// Paced so a 300-campaign sweep doesn't trip Smartlead's rate limiter.
const CALL_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fingerprint(v: string): string {
  return v && v.length >= 6 ? `…${v.slice(-6)}` : "****";
}

interface SmartleadHook {
  id?: number | string;
  name?: string;
  webhook_url?: string;
  event_types?: string[];
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // === Auth: x-agent-key ==================================================
    // Same pattern as publish-resource. This endpoint acts on a client's
    // Smartlead account using their STORED API key and only takes an
    // integrationId, so without this an anonymous caller who guessed an
    // integration UUID could re-point that client's webhooks at any URL.
    // verify_jwt is false (our own tooling and cron call it server-to-server),
    // so the key check is the only gate — reject before doing any work.
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");

    if (!expectedAgentKey) {
      console.error("[setup-smartlead-webhook] AGENT_API_KEY not configured — refusing all calls");
      return json({ success: false, error: "Server auth not configured" }, 500);
    }
    if (!agentKey || agentKey !== expectedAgentKey) {
      console.warn("[setup-smartlead-webhook] missing/invalid x-agent-key — rejecting");
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const integrationId = (body as { integrationId?: string }).integrationId;
    // Optional: restrict the sweep (e.g. re-register only newly added campaigns).
    const statuses: string[] = Array.isArray((body as { statuses?: string[] }).statuses)
      ? (body as { statuses: string[] }).statuses
      : DEFAULT_STATUSES;
    // Optional: cap the number of campaigns touched in one invocation so a very
    // large account can be swept across several calls (edge wall-clock limit).
    const limit = Number((body as { limit?: number }).limit ?? 0) || null;
    // Optional scope narrowing. A client's Smartlead account often holds
    // campaigns for several of THEIR end-clients, and we may only be engaged on
    // some of them — registering on all of it would pull unrelated prospects
    // into the agent inbox. Two ways to narrow:
    //   nameContains — case-insensitive substring on the campaign name
    //   campaignIds  — explicit allow-list of external_campaign_id (wins)
    const nameContains = String((body as { nameContains?: string }).nameContains ?? "").trim();
    const campaignIds: string[] = Array.isArray((body as { campaignIds?: string[] }).campaignIds)
      ? (body as { campaignIds: string[] }).campaignIds.map(String)
      : [];
    // dryRun reports exactly what WOULD change without calling Smartlead's
    // write endpoints.
    const dryRun = (body as { dryRun?: boolean }).dryRun === true;

    if (!integrationId) return json({ success: false, error: "Missing integrationId" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: integration, error: intErr } = await supabase
      .from("outbound_integrations")
      .select("id, name, platform, team_id, api_key_encrypted, webhook_secret, webhook_subscription_id")
      .eq("id", integrationId)
      .single();

    if (intErr || !integration) return json({ success: false, error: "Integration not found" });
    if (integration.platform !== "smartlead") {
      return json({ success: false, error: `Integration is platform '${integration.platform}', not 'smartlead'` });
    }
    if (!integration.api_key_encrypted) {
      return json({ success: false, error: "Integration has no stored API key" });
    }

    const sharedSecret = Deno.env.get("SMARTLEAD_WEBHOOK_SECRET");
    if (!sharedSecret) {
      return json({ success: false, error: "SMARTLEAD_WEBHOOK_SECRET not configured on the server" });
    }

    // --- Routing token ----------------------------------------------------
    // Reuse the integration's existing token so re-running doesn't invalidate
    // webhooks already registered against it; mint one on first setup.
    let routingToken = (integration.webhook_secret ?? "").trim();
    if (!routingToken) {
      routingToken = crypto.randomUUID().replace(/-/g, "");
      if (!dryRun) {
        const { error } = await supabase
          .from("outbound_integrations")
          .update({ webhook_secret: routingToken })
          .eq("id", integration.id);
        if (error) return json({ success: false, error: `Could not persist routing token: ${error.message}` });
      }
      console.log(`[setup-smartlead-webhook] minted routing token ${fingerprint(routingToken)} for ${integration.name}`);
    }

    const callbackUrl =
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/smartlead-webhook` +
      `?secret=${encodeURIComponent(sharedSecret)}&t=${encodeURIComponent(routingToken)}`;

    // --- Campaigns to register on ----------------------------------------
    // Capture Scope enforcement point 2 of 4: never register a webhook on a
    // campaign the operator has switched capture off for. Cheaper and cleaner
    // than registering and then rejecting the events at ingest — though point 3
    // in smartlead-webhook still rejects them, because a registration can also
    // exist from a failed deregistration or from outside Vrelly entirely.
    //
    // Scoped by source too: capture_enabled is meaningless on a reply_io row
    // (Reply.io's capture scope is unmanaged by design and its rows keep the
    // column default), so an unscoped filter here would be reading a column
    // that platform never populates.
    let campaignQuery = supabase
      .from("synced_campaigns")
      .select("external_campaign_id, name, status")
      .eq("team_id", integration.team_id)
      .eq("source", "smartlead")
      .eq("capture_enabled", true)
      .in("status", statuses)
      .order("created_at", { ascending: false });
    if (campaignIds.length > 0) campaignQuery = campaignQuery.in("external_campaign_id", campaignIds);
    else if (nameContains) campaignQuery = campaignQuery.ilike("name", `%${nameContains}%`);
    if (limit) campaignQuery = campaignQuery.limit(limit);
    const { data: campaigns, error: campErr } = await campaignQuery;

    if (campErr) return json({ success: false, error: `Campaign lookup failed: ${campErr.message}` });
    if (!campaigns || campaigns.length === 0) {
      const scope = campaignIds.length
        ? `campaignIds [${campaignIds.slice(0, 5).join(", ")}…]`
        : nameContains
        ? `name containing "${nameContains}"`
        : "any name";
      return json({
        success: false,
        error: `No campaigns matched: status in [${statuses.join(", ")}] AND ${scope}`,
      });
    }

    console.log(
      `[setup-smartlead-webhook] ${integration.name}: ${campaigns.length} campaign(s), ` +
      `statuses=[${statuses.join(",")}], ` +
      `scope=${campaignIds.length ? `${campaignIds.length} explicit ids` : nameContains ? `name~"${nameContains}"` : "all names"}, ` +
      `dryRun=${dryRun}`,
    );

    const key = integration.api_key_encrypted;
    const registeredIds: string[] = [];
    const failures: { campaign: string; stage: string; detail: string }[] = [];
    let replaced = 0;
    let created = 0;
    let skipped = 0;

    for (const c of campaigns) {
      const cid = c.external_campaign_id;
      const base = `${SMARTLEAD_API}/campaigns/${encodeURIComponent(cid)}/webhooks?api_key=${key}`;

      // 1. Read existing hooks so a re-run replaces OURS rather than stacking
      //    duplicates — and never touches a hook the client added themselves.
      let existing: SmartleadHook[] = [];
      try {
        const res = await fetch(base);
        if (!res.ok) {
          failures.push({ campaign: cid, stage: "list", detail: `HTTP ${res.status}` });
          continue;
        }
        const parsed = await res.json();
        existing = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
      } catch (e) {
        failures.push({ campaign: cid, stage: "list", detail: e instanceof Error ? e.message : String(e) });
        continue;
      }

      // Ours == points at our smartlead-webhook function, regardless of which
      // secret/token it carries (so stale tokens get cleaned up too).
      const ours = existing.filter((h) => String(h.webhook_url ?? "").includes("/functions/v1/smartlead-webhook"));
      const alreadyCorrect = ours.some(
        (h) => String(h.webhook_url) === callbackUrl && (h.event_types ?? []).includes("EMAIL_REPLY"),
      );

      if (alreadyCorrect) {
        skipped++;
        for (const h of ours) if (h.id != null) registeredIds.push(`${cid}:${h.id}`);
        continue;
      }

      if (dryRun) {
        created++;
        continue;
      }

      // 2. Delete any stale copy of ours (wrong token, wrong events).
      for (const h of ours) {
        if (h.id == null) continue;
        try {
          await fetch(base, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: h.id }),
          });
          replaced++;
          await sleep(CALL_DELAY_MS);
        } catch {
          // Non-fatal: the create below still yields a working webhook.
          console.warn(`[setup-smartlead-webhook] could not delete stale hook ${h.id} on campaign ${cid}`);
        }
      }

      // 3. Register.
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: WEBHOOK_NAME, webhook_url: callbackUrl, event_types: EVENT_TYPES }),
        });
        const text = await res.text();
        if (!res.ok) {
          failures.push({ campaign: cid, stage: "create", detail: `HTTP ${res.status} ${text.slice(0, 120)}` });
        } else {
          let hookId: unknown = null;
          try { hookId = JSON.parse(text)?.id ?? null; } catch { /* keep null */ }
          if (hookId != null) registeredIds.push(`${cid}:${hookId}`);
          created++;
        }
      } catch (e) {
        failures.push({ campaign: cid, stage: "create", detail: e instanceof Error ? e.message : String(e) });
      }

      await sleep(CALL_DELAY_MS);
    }

    // --- Persist status ---------------------------------------------------
    // 'active' only when at least one campaign is registered. Partial failures
    // still count as active (capture works for the rest) but are reported and
    // recorded in sync_error so they are not silently forgotten.
    const anyRegistered = registeredIds.length > 0;
    const status = anyRegistered ? "active" : "error";

    if (!dryRun) {
      const { error: updErr } = await supabase
        .from("outbound_integrations")
        .update({
          webhook_status: status,
          // "campaignId:hookId" pairs — needed to delete individually later,
          // since Smartlead's DELETE is campaign-scoped.
          webhook_subscription_id: anyRegistered ? registeredIds.join(",") : null,
          sync_error: failures.length
            ? `webhook registration: ${failures.length} campaign(s) failed (e.g. ${failures[0].campaign}: ${failures[0].detail})`
            : null,
        })
        .eq("id", integration.id);
      if (updErr) console.error("[setup-smartlead-webhook] status write failed:", updErr.message);
    }

    console.log(
      `[setup-smartlead-webhook] done: created=${created} replaced=${replaced} ` +
      `alreadyCorrect=${skipped} failed=${failures.length} status=${status}`,
    );

    return json({
      success: anyRegistered || dryRun,
      dryRun,
      integration: { id: integration.id, name: integration.name },
      campaignsConsidered: campaigns.length,
      statuses,
      scope: campaignIds.length
        ? { campaignIds: campaignIds.length }
        : nameContains
        ? { nameContains }
        : { nameContains: null },
      created,
      replacedStale: replaced,
      alreadyCorrect: skipped,
      failed: failures.length,
      failures: failures.slice(0, 10),
      webhook_status: dryRun ? "(unchanged)" : status,
      routingTokenFingerprint: fingerprint(routingToken),
      eventTypes: EVENT_TYPES,
      // On a dry run the whole point is to eyeball WHICH campaigns matched
      // before touching anything, so return the full list rather than a count.
      ...(dryRun
        ? {
            matchedCampaigns: campaigns.map((c) => ({
              external_campaign_id: c.external_campaign_id,
              name: c.name,
              status: c.status,
            })),
          }
        : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[setup-smartlead-webhook] fatal:", msg);
    return json({ success: false, error: msg });
  }
});
