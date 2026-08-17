// run-agent-audience — one run of an audience, manual or scheduled.
//
// Wires search -> enrich -> push into a SINGLE agent_audience_runs row, which
// is also what unlocks automation: the activation trigger will not let an
// audience go active until a run has completed with status='success'.
//
// TWO ENTRY SHAPES, one code path:
//   MANUAL  { audience_id, person_ids: [...] }  the operator ticked specific
//           people in the preview table, so search is skipped entirely and the
//           chosen ids are used verbatim.
//   CRON    { audience_id }                     unattended, so it runs the
//           saved filters itself and takes the top N (N = max_per_run).
//
// ORDER MATTERS, and it is ordered around SPEND and HARM:
//   1. claim the audience          (no two runs of the same audience at once)
//   2. open the run row            (so a crash leaves evidence, not silence)
//   3. PREFLIGHT the campaign      LIVE call — see below
//   4. search (cron only)          free
//   5. drop already-pushed ids     free, and saves paying to enrich someone we
//                                  would only skip at the push gate
//   6. enrich                      COSTS REAL MONEY
//   7. push                        IRREVERSIBLE
//   8. close the run row
//
// WHY PREFLIGHT COMES BEFORE ENRICHMENT. synced_campaigns.status is not a
// safety signal — proved both ways on 2026-08-16. A Reply.io sequence marked
// 'skipped' held an automatic zero-delay email step and was inert only because
// no mailbox was attached; another marked 'active' had no email account at all.
// Smartlead 2219737 is 'COMPLETED' with 4 steps and 0 accounts. So the runner
// asks the PLATFORM, every run, and refuses to spend Apollo credits enrolling
// people into a campaign that cannot contact them. Enrolling into a dead
// campaign is worse than doing nothing: the push succeeds, the ledger records
// it, and because dedup is client-wide that prospect is burned for every future
// audience while never having been contacted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { preflightCampaign } from "../_shared/campaign-preflight.ts";
import { ENRICH_MAX_PER_CALL } from "../_shared/apollo.ts";

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

const STALE_CLAIM_MINUTES = 50;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const agentApiKey = Deno.env.get("AGENT_API_KEY") || "";
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let runId: string | null = null;
  const counters = {
    searched: 0, enriched: 0, credits_spent: 0,
    pushed: 0, skipped_duplicate: 0, failed: 0,
  };

  try {
    // ---- auth --------------------------------------------------------------
    let userId: string | null = null;
    let trigger: "manual" | "cron" = "manual";
    const agentKey = req.headers.get("x-agent-key");
    const authHeader = req.headers.get("authorization");
    const body = await req.json().catch(() => ({}));

    if (agentKey && agentApiKey && agentKey === agentApiKey) {
      userId = body.user_id ?? null;
      trigger = body.trigger === "manual" ? "manual" : "cron";
      if (!userId) return json({ error: "user_id required when using x-agent-key" }, 400);
    } else if (authHeader?.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
      trigger = "manual";
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const audienceId: string | undefined = body.audience_id;
    if (!audienceId) return json({ error: "audience_id is required" }, 400);
    const explicitIds: string[] | null = Array.isArray(body.person_ids)
      ? [...new Set(body.person_ids.map((s: unknown) => String(s).trim()).filter(Boolean))]
      : null;

    // ---- 1. claim -----------------------------------------------------------
    // COMPARE-AND-SWAP, read then guarded write.
    //
    // The first version expressed this as a single UPDATE with a PostgREST
    // `.or(...)` guard. Two things went wrong and both were invisible: a
    // brand-new audience has last_run_status = NULL and `NULL <> 'running'` is
    // NULL rather than true, so a `neq.running` arm silently matched nothing and
    // EVERY first run was rejected as "already in progress"; and the surrounding
    // code discarded the PostgREST error, so a malformed filter looked exactly
    // like a lost race. Read-then-swap is longer but every branch is legible,
    // and the error is no longer thrown away.
    //
    // Concurrency is still guaranteed: the UPDATE re-asserts the status we read,
    // so if another run claimed it in between, our update matches 0 rows.
    const staleBefore = Date.now() - STALE_CLAIM_MINUTES * 60_000;

    const { data: current, error: readErr } = await supabase
      .from("agent_audiences")
      .select("id, user_id, platform, synced_campaign_id, filters, max_per_run, max_total, total_pushed, last_run_status, last_run_at, consecutive_failures")
      .eq("id", audienceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (readErr) {
      console.error(`[run-agent-audience] audience read failed: ${readErr.message}`);
      return json({ error: "Could not load the audience", detail: readErr.message }, 500);
    }
    if (!current) return json({ error: "Audience not found" }, 404);

    const heldRecently = current.last_run_at
      ? Date.parse(current.last_run_at) > staleBefore
      : false;
    if (current.last_run_status === "running" && heldRecently) {
      return json({ error: "A run is already in progress for this audience", skipped: true }, 409);
    }

    // Re-assert the exact status we read. PostgREST needs .is() for NULL and
    // .eq() otherwise — they are not interchangeable.
    let swap = supabase
      .from("agent_audiences")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "running" })
      .eq("id", audienceId)
      .eq("user_id", userId);
    swap = current.last_run_status === null
      ? swap.is("last_run_status", null)
      : swap.eq("last_run_status", current.last_run_status);

    const { data: claimedRows, error: claimErr } = await swap.select("id");
    if (claimErr) {
      console.error(`[run-agent-audience] claim failed: ${claimErr.message}`);
      return json({ error: "Could not claim the audience", detail: claimErr.message }, 500);
    }
    if (!claimedRows || claimedRows.length === 0) {
      return json({ error: "A run is already in progress for this audience", skipped: true }, 409);
    }
    const claimed = current;

    // ---- 2. open the run row ------------------------------------------------
    const { data: run } = await supabase
      .from("agent_audience_runs")
      .insert({ audience_id: claimed.id, user_id: userId, trigger, status: "running" })
      .select("id").single();
    runId = run?.id ?? null;

    const finish = async (
      status: "success" | "partial" | "failed",
      errorDetail: Record<string, unknown> | null,
    ) => {
      if (runId) {
        await supabase.from("agent_audience_runs").update({
          status, finished_at: new Date().toISOString(), ...counters,
          error_detail: errorDetail,
        }).eq("id", runId);
      }
      const failures = status === "failed";
      await supabase.from("agent_audiences").update({
        last_run_status: status,
        last_run_error: errorDetail ? JSON.stringify(errorDetail).slice(0, 500) : null,
        consecutive_failures: failures ? (claimed.consecutive_failures ?? 0) + 1 : 0,
      }).eq("id", claimed.id);
    };

    // ---- 3. PREFLIGHT — live, before any spend ------------------------------
    const { data: campaign } = await supabase
      .from("synced_campaigns")
      .select("id, external_campaign_id, name, source, integration_id")
      .eq("id", claimed.synced_campaign_id).maybeSingle();

    if (!campaign?.external_campaign_id) {
      await finish("failed", { stage: "preflight", reason: "audience has no usable linked campaign" });
      return json({ error: "Audience has no usable linked campaign", run_id: runId }, 400);
    }

    const { data: integration } = await supabase
      .from("outbound_integrations")
      .select("api_key_encrypted").eq("id", campaign.integration_id).eq("is_active", true).maybeSingle();

    if (!integration?.api_key_encrypted) {
      await finish("failed", { stage: "preflight", reason: "no active integration for the linked campaign" });
      return json({ error: "No active integration for the linked campaign", run_id: runId }, 400);
    }

    const pf = await preflightCampaign(
      claimed.platform, String(campaign.external_campaign_id), integration.api_key_encrypted,
    );
    console.log(
      `[run-agent-audience] preflight audience=${claimed.id} platform=${claimed.platform} ` +
        `campaign=${campaign.external_campaign_id} exists=${pf.exists} status=${pf.status} ` +
        `emailAccounts=${pf.emailAccounts} steps=${pf.steps} canSendEmail=${pf.canSendEmail}`,
    );

    if (pf.checkError) {
      await finish("failed", { stage: "preflight", check_error: pf.checkError });
      return json({ error: "Could not verify the campaign", detail: pf.checkError, run_id: runId }, 502);
    }
    if (!pf.canSendEmail) {
      // Deliberately a FAILURE, not a warning. Pushing here would consume
      // prospects permanently (dedup is client-wide) for a campaign that cannot
      // contact them.
      await finish("failed", {
        stage: "preflight", reason: pf.reason,
        platform_status: pf.status, email_accounts: pf.emailAccounts, steps: pf.steps,
      });
      return json({
        error: "Campaign cannot send",
        detail: pf.reason,
        note: "Checked live against the platform — a stored campaign status is not a reliable signal.",
        preflight: pf, run_id: runId,
      }, 409);
    }

    // ---- 4. candidate ids ---------------------------------------------------
    let candidateIds: string[] = [];
    if (explicitIds && explicitIds.length > 0) {
      candidateIds = explicitIds;
    } else {
      const searchRes = await fetch(`${supabaseUrl}/functions/v1/apollo-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": agentApiKey },
        body: JSON.stringify({
          user_id: userId, filters: claimed.filters ?? {},
          page: 1, per_page: Math.min(100, Math.max(1, claimed.max_per_run * 3)),
        }),
      });
      if (!searchRes.ok) {
        const d = (await searchRes.text().catch(() => "")).slice(0, 200);
        await finish("failed", { stage: "search", detail: d });
        return json({ error: "Apollo search failed", detail: d, run_id: runId }, 502);
      }
      const sj = await searchRes.json();
      // Over-fetch (3x) because dedup below will remove some, and a run that
      // returns fewer than max_per_run purely from prior pushes is wasteful.
      candidateIds = (sj.people ?? []).map((p: { apollo_person_id: string }) => p.apollo_person_id);
    }
    counters.searched = candidateIds.length;

    // ---- 5. drop already-pushed BEFORE paying to enrich ---------------------
    // The push path dedups too, but by then the credit is already spent.
    if (candidateIds.length > 0) {
      const { data: known } = await supabase
        .from("agent_audience_pushes")
        .select("apollo_person_id")
        .eq("user_id", userId)
        .in("apollo_person_id", candidateIds);
      const seen = new Set((known ?? []).map((k: { apollo_person_id: string }) => k.apollo_person_id));
      counters.skipped_duplicate = candidateIds.filter((id) => seen.has(id)).length;
      candidateIds = candidateIds.filter((id) => !seen.has(id));
    }

    // ---- caps ---------------------------------------------------------------
    let allowance = claimed.max_per_run;
    if (claimed.max_total !== null && claimed.max_total !== undefined) {
      allowance = Math.min(allowance, Math.max(0, claimed.max_total - claimed.total_pushed));
    }
    candidateIds = candidateIds.slice(0, allowance);

    if (candidateIds.length === 0) {
      await finish("success", null);
      return json({ success: true, run_id: runId, ...counters, note: "nothing new to push" });
    }

    // ---- 6. enrich (COSTS MONEY) --------------------------------------------
    const contacts: Record<string, unknown>[] = [];
    for (let i = 0; i < candidateIds.length; i += ENRICH_MAX_PER_CALL) {
      const chunk = candidateIds.slice(i, i + ENRICH_MAX_PER_CALL);
      const er = await fetch(`${supabaseUrl}/functions/v1/apollo-enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": agentApiKey },
        body: JSON.stringify({ user_id: userId, person_ids: chunk }),
      });
      if (!er.ok) {
        counters.failed += chunk.length;
        console.error(`[run-agent-audience] enrich chunk failed: ${er.status}`);
        continue;
      }
      const ej = await er.json();
      counters.credits_spent += Number(ej.credits_spent ?? 0);
      for (const p of ej.people ?? []) {
        counters.enriched++;
        if (!p.email) continue; // no work email -> nothing to enrol
        contacts.push({
          apollo_person_id: p.apollo_person_id, email: p.email,
          first_name: p.first_name, last_name: p.last_name, linkedin_url: p.linkedin_url,
        });
      }
    }

    if (contacts.length === 0) {
      await finish(counters.failed > 0 ? "partial" : "success", null);
      return json({ success: true, run_id: runId, ...counters, note: "no enriched contacts with an email" });
    }

    // ---- 7. push (IRREVERSIBLE) ---------------------------------------------
    const pr = await fetch(`${supabaseUrl}/functions/v1/add-contacts-to-sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": agentApiKey },
      body: JSON.stringify({ user_id: userId, audience_id: claimed.id, run_id: runId, contacts }),
    });
    if (!pr.ok) {
      const d = (await pr.text().catch(() => "")).slice(0, 300);
      await finish("failed", { stage: "push", detail: d });
      return json({ error: "Push failed", detail: d, run_id: runId, ...counters }, 502);
    }
    const pj = await pr.json();
    counters.pushed = Number(pj.pushed ?? 0);
    counters.skipped_duplicate += Number(pj.tally?.skipped_duplicate ?? 0);
    counters.failed += Number(pj.tally?.failed ?? 0);

    // ---- 8. close ------------------------------------------------------------
    const status = counters.failed > 0 ? (counters.pushed > 0 ? "partial" : "failed") : "success";
    await finish(status, counters.failed > 0 ? { stage: "push", tally: pj.tally } : null);

    console.log(
      `[run-agent-audience] audience=${claimed.id} trigger=${trigger} status=${status} ` +
        Object.entries(counters).map(([k, v]) => `${k}=${v}`).join(" "),
    );

    return json({ success: true, run_id: runId, status, ...counters, results: pj.results });
  } catch (error) {
    console.error("[run-agent-audience] Fatal:", error);
    if (runId) {
      await supabase.from("agent_audience_runs").update({
        status: "failed", finished_at: new Date().toISOString(), ...counters,
        error_detail: { stage: "fatal", message: error instanceof Error ? error.message : String(error) },
      }).eq("id", runId);
    }
    return json({ error: "Internal error", run_id: runId }, 500);
  }
});
