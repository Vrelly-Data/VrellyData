// apollo-search — browse Apollo's people database. Stateless, FREE, read-only.
//
// Costs 0 Apollo credits and writes NOTHING to our database: the search itself
// is never persisted. Saved audiences store the FILTERS
// (agent_audiences.filters); results are re-fetched on demand.
//
// Returns no email and no phone, because Apollo's api_search does not return
// them — see _shared/apollo.ts. The UI must present these rows as
// preview-only (blurred surname, "has email" as a boolean badge) and NOT imply
// a contact is reachable until apollo-enrich has run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getApolloKeyForUser, ApolloKeyMissingError } from "../_shared/apollo-key.ts";
import {
  APOLLO_BASE,
  apolloHeaders,
  buildSearchBody,
  mapSearchPerson,
  readTotalEntries,
  SEARCH_MAX_PAGE,
  SEARCH_MAX_PER_PAGE,
  type ApolloSearchFilters,
} from "../_shared/apollo.ts";

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
    // Auth: JWT for the UI, x-agent-key for the Stage 4 cron runner.
    let userId: string | null = null;
    const agentKey = req.headers.get("x-agent-key");
    const expectedKey = Deno.env.get("AGENT_API_KEY");
    const authHeader = req.headers.get("authorization");

    const body = await req.json().catch(() => ({}));

    if (agentKey && expectedKey && agentKey === expectedKey) {
      // Service path: the caller states whose behalf it acts on.
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

    const filters: ApolloSearchFilters = body.filters ?? {};
    const page = Number(body.page ?? 1);
    const perPage = Number(body.per_page ?? 25);

    if (page > SEARCH_MAX_PAGE) {
      return json(
        { error: `page ${page} exceeds Apollo's display cap of ${SEARCH_MAX_PAGE} pages` },
        400,
      );
    }

    // Refuse a filterless search. Apollo would happily return its entire
    // database a page at a time, which is never what anyone meant.
    const searchBody = buildSearchBody(filters, page, perPage);
    const filterKeys = Object.keys(searchBody).filter((k) => k !== "page" && k !== "per_page");
    if (filterKeys.length === 0) {
      return json({ error: "At least one search filter is required" }, 400);
    }

    let apollo;
    try {
      apollo = await getApolloKeyForUser(supabase, userId);
    } catch (e) {
      if (e instanceof ApolloKeyMissingError) {
        console.error(`[apollo-search] ${e.message}`);
        return json({ error: "Apollo is not configured for this account" }, 503);
      }
      throw e;
    }

    const t0 = Date.now();
    const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
      method: "POST",
      headers: apolloHeaders(apollo.key),
      body: JSON.stringify(searchBody),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`[apollo-search] Apollo HTTP ${res.status}: ${detail}`);
      // 403 on this endpoint almost always means a non-master key.
      const hint = res.status === 403
        ? "Apollo rejected the key. api_search requires a MASTER API key."
        : res.status === 429
        ? "Apollo rate limit reached, try again shortly."
        : undefined;
      return json({ error: `Apollo search failed (${res.status})`, hint }, 502);
    }

    const data = await res.json();
    const rawPeople: unknown[] = Array.isArray(data.people) ? data.people : [];
    const people = rawPeople.map(mapSearchPerson).filter(Boolean);

    // total_entries is top-level; there is no pagination object. See
    // readTotalEntries. total_pages is derived, and bounded by Apollo's
    // 500-page display cap so the UI never offers an unreachable page.
    const totalEntries = readTotalEntries(data);
    const effPerPage = Number(searchBody.per_page) || perPage;
    const totalPages = totalEntries === null
      ? null
      : Math.min(SEARCH_MAX_PAGE, Math.ceil(totalEntries / effPerPage));

    console.log(
      `[apollo-search] user=${userId} key_source=${apollo.source} page=${page} ` +
        `per_page=${effPerPage} returned=${people.length} total=${totalEntries ?? "?"} ` +
        `filters=${filterKeys.join(",")} ms=${Date.now() - t0}`,
    );

    return json({
      success: true,
      people,
      pagination: {
        page: Number(searchBody.page) || page,
        per_page: effPerPage,
        total_entries: totalEntries,
        total_pages: totalPages,
      },
      // Surfaced so the UI never has to guess why a surname is masked, and so
      // the operator understands nothing has been charged yet.
      notice: "Search returns no email or phone and masks surnames. Enrichment is a separate, paid step.",
      credits_consumed: 0,
      key_source: apollo.source,
    });
  } catch (error) {
    console.error("[apollo-search] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
