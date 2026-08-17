// dispatch-agent-audiences — the scheduled entry point.
//
// The cron calls THIS, not run-agent-audience, because run-agent-audience acts
// on exactly one audience. This function decides WHICH audiences are due and
// hands each to the runner.
//
// SELECTION IS THE ENTIRE SAFETY SURFACE. Everything this function can cause —
// Apollo spend, real prospects enrolled in real sequences — happens only for
// rows that pass the filter below. It is deliberately narrow:
//
//     is_active = true          the operator armed it, explicitly, which the
//                               activation guard only permits once a default
//                               destination is set — a scheduled run has nobody
//                               to ask which campaign to use
//     cadence  <> 'manual'      manual audiences are never scheduled
//     due by cadence            daily = 24h since last_run_at, weekly = 7d
//     consecutive_failures < 3  else it is auto-paused instead of retried
//
// is_active cannot become true by accident. It defaults false, NO code path in
// this repo writes it, and the agent_audiences_guard_activation trigger rejects
// the false->true transition unless a run has already completed with
// status='success'. So with zero armed audiences this function selects zero
// rows and does nothing but log.
//
// dry_run: true returns the selection WITHOUT invoking the runner. That is how
// the filter gets verified against real data without spending a credit or
// enrolling anyone — including for the armed case, which cannot otherwise be
// exercised safely.

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

const CADENCE_HOURS: Record<string, number> = { daily: 24, weekly: 24 * 7 };
const MAX_CONSECUTIVE_FAILURES = 3;

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

  try {
    const agentKey = req.headers.get("x-agent-key");
    if (!agentKey || !agentApiKey || agentKey !== agentApiKey) {
      console.warn("[dispatch-agent-audiences] 401 — bad or missing x-agent-key");
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // Armed, scheduled, not auto-paused. Manual audiences are excluded here
    // rather than filtered later, so a manual audience can never be picked up
    // by the schedule even if it were somehow marked active.
    const { data: candidates, error } = await supabase
      .from("agent_audiences")
      .select("id, user_id, name, cadence, last_run_at, last_run_status, consecutive_failures, default_platform, default_synced_campaign_id")
      .eq("is_active", true)
      .neq("cadence", "manual");

    if (error) {
      console.error(`[dispatch-agent-audiences] selection failed: ${error.message}`);
      return json({ error: "Could not load audiences", detail: error.message }, 500);
    }

    const now = Date.now();
    const due: typeof candidates = [];
    const paused: string[] = [];
    const notDue: string[] = [];

    for (const a of candidates ?? []) {
      if ((a.consecutive_failures ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
        paused.push(a.id);
        continue;
      }
      const hours = CADENCE_HOURS[a.cadence] ?? Number.POSITIVE_INFINITY;
      const lastMs = a.last_run_at ? Date.parse(a.last_run_at) : 0;
      if (now - lastMs >= hours * 3_600_000) due.push(a);
      else notDue.push(a.id);
    }

    // Auto-pause is a WRITE, so it is skipped on a dry run. Repeated silent
    // failure is how the HeyReach 401 stayed invisible for weeks; disarming
    // makes it visible instead of retrying forever.
    if (!dryRun && paused.length > 0) {
      await supabase.from("agent_audiences")
        .update({ is_active: false, last_run_error: `auto-paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures` })
        .in("id", paused);
      console.warn(`[dispatch-agent-audiences] auto-paused ${paused.length}: ${paused.join(",")}`);
    }

    console.log(
      `[dispatch-agent-audiences] armed=${candidates?.length ?? 0} due=${due.length} ` +
        `not_due=${notDue.length} auto_paused=${paused.length} dry_run=${dryRun}`,
    );

    if (dryRun) {
      return json({
        success: true, dry_run: true,
        armed: candidates?.length ?? 0,
        would_dispatch: due.map((a) => ({ id: a.id, name: a.name, cadence: a.cadence })),
        not_due: notDue.length, would_auto_pause: paused,
      });
    }

    // Sequential, not parallel: each run makes Apollo and platform calls, and
    // both are rate-limited per account. A dispatched run that fails is logged
    // and does not stop the others.
    const dispatched: Array<{ id: string; status: number; body: unknown }> = [];
    for (const a of due) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/run-agent-audience`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-key": agentApiKey },
          // The default destination is passed explicitly rather than left for
          // the runner to look up, so what the schedule targeted is visible in
          // this function's log too.
          body: JSON.stringify({
            audience_id: a.id, user_id: a.user_id, trigger: "cron",
            platform: a.default_platform, synced_campaign_id: a.default_synced_campaign_id,
          }),
        });
        dispatched.push({ id: a.id, status: res.status, body: await res.json().catch(() => null) });
      } catch (e) {
        console.error(`[dispatch-agent-audiences] dispatch threw for ${a.id}:`, e);
        dispatched.push({ id: a.id, status: 0, body: { error: String(e) } });
      }
    }

    return json({
      success: true,
      armed: candidates?.length ?? 0,
      dispatched: dispatched.length,
      auto_paused: paused.length,
      results: dispatched,
    });
  } catch (error) {
    console.error("[dispatch-agent-audiences] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
