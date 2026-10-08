// vrelly-audience-search — preview a Vrelly-source audience. FREE: no credits,
// nothing withheld, nothing written.
//
// Mirrors apollo-search's role for the Apollo source: the preview dialog calls
// this, and run-agent-audience runs the SAME compile + search (via
// _shared/vrelly-audience.ts) so a scheduled run takes exactly the people the
// preview showed, in the same order.
//
// The people returned already exclude everyone a run would skip for this user
// (already pushed, already an agent lead, already a synced contact), so the
// count is "people a run could still add".
//
// ROWS AND COUNT ARE SEPARATE DATABASE CALLS, in parallel. The rows query is a
// short walk of an id-ordered index (tens of ms); an exact count has to visit
// every match and can take seconds on a cold cache. Splitting them means a
// slow or failed count never costs the operator the preview — total_entries is
// simply null and the table still renders.
//
// Body: { filters: VrellyAudienceFilters, page?: number, per_page?: number }
// Auth: user JWT, or x-agent-key + user_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  compileVrellyFilters,
  searchVrelly,
  VrellyFilterError,
  VRELLY_COUNT_CAP,
} from "../_shared/vrelly-audience.ts";

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

const MAX_PER_PAGE = 100;
// OFFSET paging degrades with depth; nobody pages a preview this far.
const MAX_PAGE = 200;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let userId: string | null = null;
    const agentKey = req.headers.get("x-agent-key");
    const expectedKey = Deno.env.get("AGENT_API_KEY");
    const authHeader = req.headers.get("authorization");
    const body = await req.json().catch(() => ({}));

    if (agentKey && expectedKey && agentKey === expectedKey) {
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

    let query;
    try {
      query = compileVrellyFilters(body.filters);
    } catch (e) {
      if (e instanceof VrellyFilterError) return json({ error: e.message }, 400);
      throw e;
    }

    const perPage = Math.max(1, Math.min(MAX_PER_PAGE, Math.floor(Number(body.per_page)) || 25));
    const page = Math.max(1, Math.min(MAX_PAGE, Math.floor(Number(body.page)) || 1));
    const t0 = Date.now();

    const [rows, count] = await Promise.allSettled([
      searchVrelly(supabase, { userId, query, limit: perPage, offset: (page - 1) * perPage }),
      searchVrelly(supabase, { userId, query, limit: 0, count: true }),
    ]);

    if (rows.status === "rejected") {
      const msg = rows.reason instanceof Error ? rows.reason.message : String(rows.reason);
      console.error(`[vrelly-audience-search] rows failed: ${msg}`);
      // The function raises 22023 for filters it cannot run (e.g. a keyword
      // made only of stop words); surface that text, it is meant for the operator.
      const userFacing = /common words|at least one filter/i.test(msg);
      return json({ error: userFacing ? msg.replace(/^vrelly_audience_search failed: /, "") : "Vrelly search failed" }, userFacing ? 400 : 502);
    }
    if (count.status === "rejected") {
      console.warn(`[vrelly-audience-search] count failed (preview still served): ${count.reason}`);
    }

    const c = count.status === "fulfilled" ? count.value : null;
    const total = c?.total ?? null;
    console.log(
      `[vrelly-audience-search] user=${userId} page=${page} returned=${rows.value.people.length} ` +
        `total=${total ?? "n/a"}${c?.total_capped ? "+" : ""}${c?.total_is_estimate ? "~" : ""} ms=${Date.now() - t0}`,
    );

    return json({
      source: "vrelly",
      people: rows.value.people,
      pagination: {
        page,
        per_page: perPage,
        total_entries: total,
        total_pages: total !== null ? Math.max(1, Math.ceil(total / perPage)) : null,
        total_is_lower_bound: c?.total_capped ?? false,
        total_is_estimate: c?.total_is_estimate ?? false,
        count_cap: VRELLY_COUNT_CAP,
      },
      notice:
        "Vrelly database — free, complete records. Already pushed, existing leads and your teams' synced contacts are excluded.",
      credits_consumed: 0,
    });
  } catch (error) {
    console.error("[vrelly-audience-search] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
