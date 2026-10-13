// signal-audience-preview — preview a Signals-source audience: signal ->
// company -> people, with where each person came from. FREE: nothing is
// enriched and nothing is written.
//
// Runs the SAME compile (_shared/signal-audience.ts), candidate query and
// resolver (_shared/signal-resolver.ts) as run-agent-audience, in 'preview'
// mode: Vrelly and the signal's own person come back complete; companies with
// nobody there are searched on Apollo (free api_search) and their candidates
// come back as 'pending', counted into estimated_credits — the most a run would
// spend on this page. People this user already pushed, has as leads or synced
// contacts are already excluded.
//
// Visibility is the signals RLS rule for the caller, applied in SQL: a client
// never sees an admin-only or another team's signal here, even by id.
//
// Body: { filters: SignalAudienceFilters, page?: number, per_page?: number (<= 25),
//         signal_ids?: string[], audience_id?: string }
//   audience_id  excludes signals that audience already used (as a run would).
// Auth: user JWT, or x-agent-key + user_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { compileSignalAudience, SignalFilterError } from "../_shared/signal-audience.ts";
import { type CandidateSignal, resolveSignals } from "../_shared/signal-resolver.ts";
import { readApolloBudget, supabaseResolverDeps } from "../_shared/signal-resolver-supabase.ts";

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

const MAX_PER_PAGE = 25;
const MAX_PAGE = 40;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const agentApiKey = Deno.env.get("AGENT_API_KEY") || "";
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let userId: string | null = null;
    const agentKey = req.headers.get("x-agent-key");
    const authHeader = req.headers.get("authorization");
    const body = await req.json().catch(() => ({}));
    if (agentKey && agentApiKey && agentKey === agentApiKey) {
      userId = body.user_id ?? null;
      if (!userId) return json({ error: "user_id required when using x-agent-key" }, 400);
    } else if (authHeader?.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    let compiled;
    try {
      compiled = compileSignalAudience(body.filters);
    } catch (e) {
      if (e instanceof SignalFilterError) return json({ error: e.message }, 400);
      throw e;
    }

    const signalIds: string[] | null = Array.isArray(body.signal_ids)
      ? body.signal_ids.map(String).filter((s: string) => UUID_RE.test(s)).slice(0, 200)
      : null;
    let audienceId: string | null = null;
    let agentConfigId: string | null = null;
    if (body.audience_id) {
      const { data: a } = await supabase.from("agent_audiences")
        .select("id, agent_config_id").eq("id", String(body.audience_id)).eq("user_id", userId).maybeSingle();
      if (!a) return json({ error: "Audience not found" }, 404);
      audienceId = a.id;
      agentConfigId = a.agent_config_id;
    } else {
      const { data: cfg } = await supabase.from("agent_configs").select("id").eq("user_id", userId).limit(1).maybeSingle();
      agentConfigId = cfg?.id ?? null;
    }

    const perPage = Math.max(1, Math.min(MAX_PER_PAGE, Math.floor(Number(body.per_page)) || 10));
    const page = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(body.page)) || 1));
    const t0 = Date.now();

    const { data: cand, error: candErr } = await supabase.rpc("signals_audience_candidates", {
      p_user_id: userId, p_query: compiled.candidates, p_audience_id: audienceId, p_signal_ids: signalIds,
      p_limit: perPage, p_offset: (page - 1) * perPage, p_count: true,
    });
    if (candErr) {
      console.error(`[signal-audience-preview] candidates failed: ${candErr.message}`);
      return json({ error: "Could not load signals" }, 502);
    }
    const signals = (cand?.signals ?? []) as CandidateSignal[];

    // The budget is shown beside the estimate; reading it never spends.
    let budget: { key_source: string; remaining: number | null; cap: number | null; used: number } | null = null;
    let apolloKey: string | null = null;
    if (compiled.useApollo && compiled.apollo && agentConfigId) {
      try {
        const b = await readApolloBudget(supabase, userId, agentConfigId);
        if (b) {
          apolloKey = b.key;
          budget = { key_source: b.keySource, remaining: Number.isFinite(b.remaining) ? b.remaining : null, cap: b.cap, used: b.used };
        }
      } catch (e) {
        console.warn(`[signal-audience-preview] budget read failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!apolloKey) compiled = { ...compiled, useApollo: false };

    const deps = supabaseResolverDeps(supabase, { userId, compiled, apolloKey, supabaseUrl, agentApiKey });
    const outcome = await resolveSignals(signals, { mode: "preview", compiled, budget: 0 }, deps);

    const bySource = { vrelly: 0, signal: 0, apollo: 0 };
    for (const r of outcome.resolved) for (const p of r.people) bySource[p.source]++;
    console.log(
      `[signal-audience-preview] user=${userId} page=${page} signals=${signals.length} total=${cand?.total ?? "n/a"} ` +
        `vrelly=${bySource.vrelly} signal=${bySource.signal} apollo=${bySource.apollo} ` +
        `est_credits=${outcome.estimated_credits} apollo_searches=${outcome.apollo_calls.search} ms=${Date.now() - t0}`,
    );

    return json({
      source: "signals",
      signals: outcome.resolved,
      pagination: {
        page, per_page: perPage, total_entries: typeof cand?.total === "number" ? cand.total : null,
        total_pages: typeof cand?.total === "number" ? Math.max(1, Math.ceil(cand.total / perPage)) : null,
      },
      people_by_source: bySource,
      estimated_credits: outcome.estimated_credits,
      apollo_budget: budget,
      apollo_enabled: compiled.useApollo,
      notice: "Vrelly and signal contacts are free. Apollo contacts are found free and cost up to one credit each when a run enriches them; nothing is spent by this preview.",
      credits_consumed: 0,
    });
  } catch (error) {
    console.error("[signal-audience-preview] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
