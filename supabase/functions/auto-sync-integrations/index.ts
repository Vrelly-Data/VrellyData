// [auto-sync-integrations v2] — hourly campaign sync + 6-hourly contact sync.
//
// WHY A FAN-OUT. v1 awaited every integration's sync one after another inside
// ONE invocation. A single big Reply.io workspace (Avania, 134 sequences) takes
// ~150-190s to sync, so the dispatcher hit the edge wall-clock limit partway
// through the list every hour and the integrations after it (Vrelly Reply,
// Rockside, Qalified, Amerifund, …) silently stopped syncing — Vrelly Reply had
// not synced since 2026-09-24, and its new sequences were invisible to Capture
// Scope. HeyReach was never in this job at all.
//
// v2 never waits on a sync. Each integration's sync is its own edge invocation,
// started in parallel; this function returns 202 as soon as they are started.
// A child invocation keeps running after its caller returns (verified on prod:
// a sync whose caller had already timed out still completed and stamped
// last_synced_at), and EdgeRuntime.waitUntil keeps this worker around to log
// each child's result while its budget allows.
//
// Scopes (body.scope):
//   campaigns (hourly cron) — campaign sync for EVERY active Reply.io,
//       Smartlead and HeyReach integration, in parallel.
//   full (6-hourly cron)    — contact sync: one 'contacts' invocation per active
//       Reply.io integration, in parallel. (Campaigns already run hourly; v1
//       re-ran them here too, at the same minute as the hourly job.)
//   contacts (internal)     — contact sync for ONE integration (integrationId),
//       campaign by campaign, inside a time budget. Campaign order is shuffled
//       each run so a workspace too big for one budget is covered over runs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Stay well inside the edge wall-clock limit for one integration's contacts.
const CONTACTS_BUDGET_MS = 300_000;
const CONTACTS_DELAY_MS = 500;

type Job = { platform: string; integrationId: string | null; fn: string; body: Record<string, unknown> };

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // Auth: x-agent-key header
  const agentKey = req.headers.get("x-agent-key");
  const expectedKey = Deno.env.get("AGENT_API_KEY");
  if (!agentKey || agentKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const agentApiKey = Deno.env.get("AGENT_API_KEY") ?? "";
  // Service role as Authorization; x-agent-key tells the sync functions to use
  // their service-role client.
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
    "x-agent-key": agentApiKey,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  let body: { scope?: string; integrationId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body — default scope
  }
  const scope = body.scope === "campaigns" || body.scope === "contacts" ? body.scope : "full";
  console.log(`[auto-sync] starting (scope: ${scope}${body.integrationId ? `, integration ${body.integrationId}` : ""})`);

  try {
    // ── contacts: one integration, sequential within a time budget ──────────
    if (scope === "contacts") {
      if (!body.integrationId) return json({ error: "integrationId required for scope 'contacts'" }, 400);
      const { data: integration, error: intErr } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, platform, is_active")
        .eq("id", body.integrationId)
        .maybeSingle();
      if (intErr) throw new Error(`Integration lookup failed: ${intErr.message}`);
      if (!integration || !integration.is_active || integration.platform !== "reply.io") {
        return json({ error: "Not an active Reply.io integration" }, 400);
      }
      const { data: campaigns, error: campErr } = await supabase
        .from("synced_campaigns")
        .select("id, external_campaign_id")
        .eq("integration_id", integration.id);
      if (campErr) throw new Error(`Campaign lookup failed: ${campErr.message}`);

      const started = Date.now();
      const result = { integrationId: integration.id, campaigns: campaigns?.length ?? 0, synced: 0, contacts: 0, errors: 0, stoppedForBudget: false };
      for (const campaign of shuffle(campaigns ?? [])) {
        if (Date.now() - started > CONTACTS_BUDGET_MS) {
          result.stoppedForBudget = true;
          break;
        }
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/sync-reply-contacts`, {
            method: "POST",
            headers,
            body: JSON.stringify({ integrationId: integration.id, campaignId: campaign.id }),
          });
          if (!res.ok) {
            result.errors++;
            console.error(`[auto-sync] contacts sync failed for campaign ${campaign.external_campaign_id}: HTTP ${res.status}`);
          } else {
            const data = await res.json().catch(() => ({}));
            result.synced++;
            result.contacts += Number(data?.contactsSynced) || 0;
          }
        } catch (e) {
          result.errors++;
          console.error(`[auto-sync] contacts sync error for campaign ${campaign.external_campaign_id}:`, e instanceof Error ? e.message : e);
        }
        await new Promise((r) => setTimeout(r, CONTACTS_DELAY_MS));
      }
      console.log(`[auto-sync] contacts done:`, JSON.stringify(result));
      return json(result);
    }

    // ── campaigns / full: fan out, one invocation per job ───────────────────
    const { data: integrations, error: intError } = await supabase
      .from("outbound_integrations")
      .select("id, platform, team_id")
      .eq("is_active", true)
      .in("platform", ["reply.io", "smartlead", "heyreach"]);
    if (intError) throw new Error(`Failed to fetch integrations: ${intError.message}`);

    const jobs: Job[] = [];
    if (scope === "campaigns") {
      for (const i of integrations ?? []) {
        if (i.platform === "reply.io") {
          jobs.push({ platform: i.platform, integrationId: i.id, fn: "sync-reply-campaigns", body: { integrationId: i.id } });
        } else if (i.platform === "smartlead") {
          jobs.push({ platform: i.platform, integrationId: i.id, fn: "sync-smartlead-campaigns", body: { integrationId: i.id, skipAnalytics: true } });
        }
      }
      // sync-heyreach-campaigns syncs every active HeyReach integration in one
      // call when invoked with the agent key.
      if ((integrations ?? []).some((i) => i.platform === "heyreach")) {
        jobs.push({ platform: "heyreach", integrationId: null, fn: "sync-heyreach-campaigns", body: {} });
      }
    } else {
      for (const i of integrations ?? []) {
        if (i.platform !== "reply.io") continue;
        jobs.push({ platform: i.platform, integrationId: i.id, fn: "auto-sync-integrations", body: { scope: "contacts", integrationId: i.id } });
      }
    }

    // Start every job now; log each outcome in the background. Nothing here
    // waits for a sync to finish before starting the next one.
    const runs = jobs.map((job) => {
      const t0 = Date.now();
      return fetch(`${supabaseUrl}/functions/v1/${job.fn}`, { method: "POST", headers, body: JSON.stringify(job.body) })
        .then(async (res) => {
          const text = await res.text().catch(() => "");
          console.log(`[auto-sync] ${job.fn} ${job.integrationId ?? "(all)"} -> HTTP ${res.status} in ${Date.now() - t0}ms ${res.ok ? "" : text.slice(0, 200)}`);
        })
        .catch((e) => console.error(`[auto-sync] ${job.fn} ${job.integrationId ?? "(all)"} failed to start/complete:`, e instanceof Error ? e.message : e));
    });
    const all = Promise.allSettled(runs);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(all);
    } else {
      await all;
    }

    const dispatched = jobs.map((j) => ({ fn: j.fn, platform: j.platform, integrationId: j.integrationId }));
    console.log(`[auto-sync] dispatched ${jobs.length} job(s) (scope: ${scope})`);
    return json({ scope, dispatched }, 202);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[auto-sync] fatal error:", errorMessage);
    return json({ error: errorMessage }, 500);
  }
});
