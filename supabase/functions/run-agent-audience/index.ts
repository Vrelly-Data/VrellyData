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
// DESTINATION IS PER-RUN, not per-audience. The caller may pass platform +
// synced_campaign_id; otherwise the audience's DEFAULT destination is used.
// A scheduled run has nobody to ask, which is why the activation guard refuses
// to arm an audience that has no default. One run = one destination.
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
// TWO SOURCES (agent_audiences.source):
//   apollo  search (free) -> enrich (credits) -> push, as described above.
//   vrelly  ONE database call replaces search+enrich: public.prospects rows are
//           already complete, so steps 4-6 collapse into vrelly_audience_search
//           (_shared/vrelly-audience.ts), which also drops everyone this user
//           already pushed, already has as a lead, or already has as a synced
//           contact. No Apollo call is made and credits_spent stays 0. Matches
//           come back in id order, so successive runs walk the list.
//   The live preflight (step 3) runs FIRST for both: a dead campaign must stop
//   a Vrelly run just as it stops an Apollo one, because the push burns the
//   prospect either way.
//
// APOLLO GUARDRAILS. The shared APOLLO_API_KEY pays for every client without a
// key of their own, so on that key a client may spend at most
// agent_configs.apollo_monthly_credit_cap credits per calendar month (UTC),
// counted from agent_audience_runs. A run that would cross it enriches only up
// to the cap and ends 'partial' with reason 'monthly_cap'; Apollo answering
// 422 "insufficient credits" ends it 'partial' with reason
// 'apollo_insufficient_credits'. Either way whatever was already enriched is
// still pushed — those credits are spent. The reason is shown on the audience
// card and in Admin (admin_apollo_credit_alerts).
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
import { getApolloKeyForUser, ApolloKeyMissingError } from "../_shared/apollo-key.ts";
import { compileVrellyFilters, searchVrelly, VrellyFilterError } from "../_shared/vrelly-audience.ts";

type RunReason = "monthly_cap" | "apollo_insufficient_credits";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First instant of the current calendar month, UTC. */
function monthStartUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

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
      ? [...new Set<string>(body.person_ids.map((s: unknown) => String(s).trim()).filter(Boolean))]
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
      .select("id, user_id, agent_config_id, source, filters, max_per_run, max_total, total_pushed, default_platform, default_synced_campaign_id, last_run_status, last_run_at, consecutive_failures")
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

    // ---- 2. resolve the destination, then open the run row -------------------
    // A run targets exactly ONE destination. A manual caller states it; a
    // scheduled run falls back to the audience default, which the activation
    // guard requires before an audience can be armed. Splitting a batch across
    // two platforms is two runs — that keeps every counter on this row meaning
    // one thing.
    const platform: string | null = body.platform ?? claimed.default_platform ?? null;
    const campaignId: string | null =
      body.synced_campaign_id ?? claimed.default_synced_campaign_id ?? null;

    if (!platform || !campaignId) {
      // Released rather than left claimed: no run row exists yet, so leaving
      // last_run_status='running' would wedge the audience until the stale
      // timeout.
      await supabase.from("agent_audiences")
        .update({ last_run_status: claimed.last_run_status, last_run_at: claimed.last_run_at })
        .eq("id", claimed.id);
      return json({
        error: "No destination for this run",
        detail: "Pass platform + synced_campaign_id, or set a default destination on the audience.",
      }, 400);
    }

    const { data: run } = await supabase
      .from("agent_audience_runs")
      .insert({
        audience_id: claimed.id, user_id: userId, trigger, status: "running",
        platform, synced_campaign_id: campaignId,
      })
      .select("id").single();
    runId = run?.id ?? null;

    const finish = async (
      status: "success" | "partial" | "failed",
      errorDetail: Record<string, unknown> | null,
      reason: RunReason | null = null,
    ) => {
      if (runId) {
        await supabase.from("agent_audience_runs").update({
          status, finished_at: new Date().toISOString(), ...counters,
          error_detail: errorDetail, reason,
        }).eq("id", runId);
      }
      const failures = status === "failed";
      await supabase.from("agent_audiences").update({
        last_run_status: status,
        last_run_error: errorDetail ? JSON.stringify(errorDetail).slice(0, 500) : null,
        last_run_reason: reason,
        consecutive_failures: failures ? (claimed.consecutive_failures ?? 0) + 1 : 0,
      }).eq("id", claimed.id);
    };

    // max_per_run, and max_total against the trigger-maintained total_pushed.
    let allowance = claimed.max_per_run;
    if (claimed.max_total !== null && claimed.max_total !== undefined) {
      allowance = Math.min(allowance, Math.max(0, claimed.max_total - claimed.total_pushed));
    }

    // The irreversible step, shared by both sources.
    const push = async (contacts: Record<string, unknown>[]) => {
      const pr = await fetch(`${supabaseUrl}/functions/v1/add-contacts-to-sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": agentApiKey },
        body: JSON.stringify({
          user_id: userId, audience_id: claimed.id, run_id: runId,
          platform, synced_campaign_id: campaignId, contacts,
        }),
      });
      if (!pr.ok) {
        return { ok: false as const, detail: (await pr.text().catch(() => "")).slice(0, 300) };
      }
      return { ok: true as const, body: await pr.json() };
    };

    // ---- 3. PREFLIGHT — live, before any spend ------------------------------
    const { data: campaign } = await supabase
      .from("synced_campaigns")
      .select("id, external_campaign_id, name, source, integration_id")
      .eq("id", campaignId).maybeSingle();

    if (!campaign?.external_campaign_id) {
      await finish("failed", { stage: "preflight", reason: "campaign not found, or missing its external id" });
      return json({ error: "Campaign not found, or missing its external id", run_id: runId }, 400);
    }

    const { data: integration } = await supabase
      .from("outbound_integrations")
      .select("api_key_encrypted").eq("id", campaign.integration_id).eq("is_active", true).maybeSingle();

    if (!integration?.api_key_encrypted) {
      await finish("failed", { stage: "preflight", reason: "no active integration for the linked campaign" });
      return json({ error: "No active integration for the linked campaign", run_id: runId }, 400);
    }

    const pf = await preflightCampaign(
      platform, String(campaign.external_campaign_id), integration.api_key_encrypted,
    );
    console.log(
      `[run-agent-audience] preflight audience=${claimed.id} platform=${platform} ` +
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

    // ---- 4v. VRELLY: one query replaces search + enrich ---------------------
    if ((claimed.source ?? "apollo") === "vrelly") {
      let query;
      try {
        query = compileVrellyFilters(claimed.filters);
      } catch (e) {
        if (!(e instanceof VrellyFilterError)) throw e;
        await finish("failed", { stage: "filters", detail: e.message });
        return json({ error: "Invalid Vrelly filters", detail: e.message, run_id: runId }, 400);
      }
      // Manual pushes name prospects by id; anything that is not a uuid cannot
      // be a prospect (an Apollo id here means the caller has the wrong source).
      const prospectIds = explicitIds && explicitIds.length > 0 ? explicitIds.filter((id) => UUID_RE.test(id)) : null;
      if (explicitIds && explicitIds.length > 0 && prospectIds!.length !== explicitIds.length) {
        await finish("failed", { stage: "search", detail: "person_ids are not Vrelly prospect ids" });
        return json({ error: "person_ids are not Vrelly prospect ids", run_id: runId }, 400);
      }
      if (allowance <= 0) {
        await finish("success", null);
        return json({ success: true, run_id: runId, ...counters, note: "audience cap reached — nothing to push" });
      }

      let found;
      try {
        found = await searchVrelly(supabase, {
          userId: userId!, query, limit: allowance, prospectIds,
        });
      } catch (e) {
        const d = e instanceof Error ? e.message : String(e);
        await finish("failed", { stage: "search", detail: d.slice(0, 300) });
        return json({ error: "Vrelly search failed", detail: d, run_id: runId }, 502);
      }
      counters.searched = found.people.length;
      // A ticked person the search no longer returns was excluded since the
      // preview (already pushed, now a lead/contact) or no longer matches.
      if (prospectIds) counters.skipped_duplicate = prospectIds.length - found.people.length;

      if (found.people.length === 0) {
        await finish("success", null);
        return json({ success: true, run_id: runId, ...counters, note: "nobody new matches — everyone matching is already pushed, a lead or a contact" });
      }

      const pr = await push(found.people.map((p) => ({
        prospect_id: p.prospect_id, email: p.email,
        first_name: p.first_name, last_name: p.last_name, linkedin_url: p.linkedin_url,
        title: p.title, company_name: p.company_name, company_domain: p.company_domain,
        city: p.city, state: p.state, country: p.country,
      })));
      if (!pr.ok) {
        await finish("failed", { stage: "push", detail: pr.detail });
        return json({ error: "Push failed", detail: pr.detail, run_id: runId, ...counters }, 502);
      }
      counters.pushed = Number(pr.body.pushed ?? 0);
      counters.skipped_duplicate += Number(pr.body.tally?.skipped_duplicate ?? 0);
      counters.failed += Number(pr.body.tally?.failed ?? 0);
      const vStatus = counters.failed > 0 ? (counters.pushed > 0 ? "partial" : "failed") : "success";
      await finish(vStatus, counters.failed > 0 ? { stage: "push", tally: pr.body.tally } : null);
      console.log(
        `[run-agent-audience] audience=${claimed.id} source=vrelly trigger=${trigger} status=${vStatus} ` +
          Object.entries(counters).map(([k, v]) => `${k}=${v}`).join(" "),
      );
      return json({ success: true, run_id: runId, status: vStatus, source: "vrelly", ...counters, results: pr.body.results });
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
    candidateIds = candidateIds.slice(0, allowance);

    if (candidateIds.length === 0) {
      await finish("success", null);
      return json({ success: true, run_id: runId, ...counters, note: "nothing new to push" });
    }

    // ---- 5b. monthly credit budget (shared key only) ---------------------------
    // A client's own key draws down their own Apollo balance and is not ours to
    // cap. On the shared key, credits already spent this month by this client's
    // runs are subtracted from the cap; Apollo charges at most one credit per
    // record, so enriching N more records can never cost more than N.
    let keySource: "client" | "shared";
    try {
      keySource = (await getApolloKeyForUser(supabase, userId!)).source;
    } catch (e) {
      if (!(e instanceof ApolloKeyMissingError)) throw e;
      await finish("failed", { stage: "enrich", reason: "Apollo is not configured for this account" });
      return json({ error: "Apollo is not configured for this account", run_id: runId }, 503);
    }
    if (runId) await supabase.from("agent_audience_runs").update({ apollo_key_source: keySource }).eq("id", runId);

    let budget = Number.POSITIVE_INFINITY;
    if (keySource === "shared") {
      const { data: cfg, error: cfgErr } = await supabase
        .from("agent_configs").select("apollo_monthly_credit_cap").eq("id", claimed.agent_config_id).maybeSingle();
      const { data: spentRows, error: spentErr } = await supabase
        .from("agent_audience_runs")
        .select("credits_spent")
        .eq("user_id", userId)
        // Runs from before apollo_key_source existed carry null; they all used
        // the shared key (no client had their own), so they count.
        .or("apollo_key_source.eq.shared,apollo_key_source.is.null")
        .gte("started_at", monthStartUtc());
      if (cfgErr || spentErr) {
        // Fail closed: an unknown budget is not permission to spend.
        const d = (cfgErr ?? spentErr)!.message;
        await finish("failed", { stage: "budget", detail: d });
        return json({ error: "Could not read the Apollo credit budget", detail: d, run_id: runId }, 500);
      }
      const cap = Number(cfg?.apollo_monthly_credit_cap ?? 200);
      const used = (spentRows ?? []).reduce((n: number, r: { credits_spent: number }) => n + Number(r.credits_spent ?? 0), 0);
      budget = Math.max(0, cap - used);
      console.log(`[run-agent-audience] apollo budget user=${userId} cap=${cap} used_this_month=${used} remaining=${budget}`);
    }

    // ---- 6. enrich (COSTS MONEY) --------------------------------------------
    const contacts: Record<string, unknown>[] = [];
    let reason: RunReason | null = null;
    let enrichDetail: Record<string, unknown> | null = null;
    let i = 0;
    while (i < candidateIds.length) {
      const remaining = budget - counters.credits_spent;
      if (remaining <= 0) {
        reason = "monthly_cap";
        enrichDetail = {
          stage: "enrich", reason: "monthly_cap",
          detail: `monthly Apollo credit cap reached; ${candidateIds.length - i} candidate(s) not enriched`,
        };
        break;
      }
      const chunk = candidateIds.slice(i, i + Math.min(ENRICH_MAX_PER_CALL, remaining));
      i += chunk.length;
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
      if (ej.insufficient_credits === true) {
        // Apollo refused for lack of credits. Keep what this chunk did return
        // (if anything), then stop: every further call would 422 too.
        reason = "apollo_insufficient_credits";
        enrichDetail = { stage: "enrich", reason: "apollo_insufficient_credits", key_source: keySource };
        counters.failed += (ej.failed_chunks ?? []).reduce((n: number, c: { ids: string[] }) => n + c.ids.length, 0);
      }
      for (const p of ej.people ?? []) {
        counters.enriched++;
        if (!p.email) continue; // no work email -> nothing to enrol
        contacts.push({
          apollo_person_id: p.apollo_person_id, email: p.email,
          first_name: p.first_name, last_name: p.last_name, linkedin_url: p.linkedin_url,
          title: p.title, company_name: p.organization_name, company_domain: p.organization_domain,
          city: p.city, state: p.state, country: p.country,
        });
      }
      if (reason === "apollo_insufficient_credits") break;
    }

    if (contacts.length === 0) {
      // A budget stop is 'partial' even with nothing pushed: the run did not do
      // what it was asked, and the card has to say why.
      await finish(reason ? "partial" : counters.failed > 0 ? "partial" : "success", enrichDetail, reason);
      return json({
        success: true, run_id: runId, status: reason ? "partial" : undefined, reason, ...counters,
        note: reason === "monthly_cap"
          ? "monthly Apollo credit cap reached — nothing enriched"
          : reason === "apollo_insufficient_credits"
          ? "Apollo has no credits left — nothing enriched"
          : "no enriched contacts with an email",
      });
    }

    // ---- 7. push (IRREVERSIBLE) ---------------------------------------------
    const pr = await push(contacts);
    if (!pr.ok) {
      await finish("failed", { stage: "push", detail: pr.detail }, reason);
      return json({ error: "Push failed", detail: pr.detail, run_id: runId, ...counters }, 502);
    }
    const pj = pr.body;
    counters.pushed = Number(pj.pushed ?? 0);
    counters.skipped_duplicate += Number(pj.tally?.skipped_duplicate ?? 0);
    counters.failed += Number(pj.tally?.failed ?? 0);

    // ---- 8. close ------------------------------------------------------------
    const status = reason
      ? "partial"
      : counters.failed > 0 ? (counters.pushed > 0 ? "partial" : "failed") : "success";
    await finish(
      status,
      enrichDetail ?? (counters.failed > 0 ? { stage: "push", tally: pj.tally } : null),
      reason,
    );

    console.log(
      `[run-agent-audience] audience=${claimed.id} trigger=${trigger} status=${status} ` +
        Object.entries(counters).map(([k, v]) => `${k}=${v}`).join(" "),
    );

    return json({ success: true, run_id: runId, status, reason, ...counters, results: pj.results });
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
