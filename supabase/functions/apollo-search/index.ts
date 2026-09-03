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
  splitKeywordTerms,
  type ApolloSearchFilters,
  type ApolloSearchPerson,
} from "../_shared/apollo.ts";

/** An Apollo HTTP failure, carried out of a fan-out branch to one 502. */
class ApolloSearchError extends Error {
  constructor(readonly status: number, readonly hint?: string) {
    super(`Apollo search failed (${status})`);
  }
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
    const effPerPage = Number(searchBody.per_page) || perPage;

    const runSearch = async (body: Record<string, unknown>) => {
      const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
        method: "POST",
        headers: apolloHeaders(apollo.key),
        body: JSON.stringify(body),
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
        throw new ApolloSearchError(res.status, hint);
      }
      return await res.json();
    };

    const readPeople = (d: any): ApolloSearchPerson[] => {
      const raw: unknown[] = Array.isArray(d.people) ? d.people : [];
      return raw.map(mapSearchPerson).filter(Boolean) as ApolloSearchPerson[];
    };

    // OR ACROSS KEYWORDS IS BUILT HERE, because Apollo cannot express it.
    // q_keywords is one AND-ed phrase with no OR syntax at all (see
    // splitKeywordTerms for the measurements), so "finance, loans, mortgages"
    // as a single query matches records carrying all three words — in practice
    // zero. One request per term, merged below, is the only way to get a union.
    //
    // A single term takes the original single-request path untouched, which is
    // every audience that predates this change.
    const terms = splitKeywordTerms(filters.q_keywords);
    const fanOut = terms.length > 1;

    let people: ApolloSearchPerson[];
    let totalEntries: number | null;
    let totalPages: number | null;

    if (!fanOut) {
      const data = await runSearch(searchBody);
      people = readPeople(data);
      // total_entries is top-level; there is no pagination object. See
      // readTotalEntries. total_pages is derived, and bounded by Apollo's
      // 500-page display cap so the UI never offers an unreachable page.
      totalEntries = readTotalEntries(data);
      totalPages = totalEntries === null
        ? null
        : Math.min(SEARCH_MAX_PAGE, Math.ceil(totalEntries / effPerPage));
    } else {
      // Each term gets an equal share of the page rather than the page being
      // term 1 followed by whatever fits. Two reasons: the operator who typed
      // three terms wants to see all three represented, and because term T
      // always occupies term-page P, paging forward stays consistent and
      // nothing is fetched only to be thrown away.
      const perTerm = Math.max(1, Math.ceil(effPerPage / terms.length));
      const results = await Promise.all(
        terms.map((term) => runSearch(buildSearchBody({ ...filters, q_keywords: term }, page, perTerm))),
      );

      // Round-robin interleave, deduped WITHIN the page. Someone matching two
      // terms is kept once, at the position of the first term that found them.
      //
      // Across pages they can still repeat: a person may sit on finance-page 1
      // and loans-page 2, and a stateless request cannot know page 1 already
      // showed them. Harmless where it lands — the preview keys selection by
      // apollo_person_id so re-selecting is idempotent, already-pushed contacts
      // are filtered server-side at push time, and the runner only ever reads
      // page 1. Fixing it properly would mean carrying seen-ids across
      // requests, which is a lot of machinery for a cosmetic repeat.
      const lists = results.map(readPeople);
      //
      // DELIBERATELY NOT TRUNCATED TO per_page. terms * perTerm overshoots
      // whenever per_page does not divide evenly (25 over 3 terms fetches 27),
      // and cutting the tail would drop those people from EVERY page: page P+1
      // fetches term-page P+1, so nothing ever comes back for them. Returning a
      // slightly long page is visible and harmless; silently losing two people
      // per page is neither. per_page is a target here, not a ceiling — callers
      // already tolerate it, and run-agent-audience over-fetches then takes its
      // own top N regardless.
      const seen = new Set<string>();
      const merged: ApolloSearchPerson[] = [];
      const longest = Math.max(0, ...lists.map((l) => l.length));
      for (let i = 0; i < longest; i++) {
        for (const list of lists) {
          const p = list[i];
          if (!p || seen.has(p.apollo_person_id)) continue;
          seen.add(p.apollo_person_id);
          merged.push(p);
        }
      }
      people = merged;

      // AN UPPER BOUND, NOT A COUNT. Someone matching two terms is counted by
      // both and Apollo offers no way to intersect, so this can only overstate.
      // Flagged in the response so the UI says "about N" instead of asserting a
      // number it cannot stand behind.
      const totals = results.map((d) => readTotalEntries(d));
      totalEntries = totals.every((t) => t === null)
        ? null
        : totals.reduce((a: number, t) => a + (t ?? 0), 0);
      // How many merged pages actually yield anything: the deepest term decides,
      // since a term runs out of pages without ending the others.
      const perTermPages = totals.map((t) => (t === null ? 0 : Math.ceil(t / perTerm)));
      totalPages = totalEntries === null
        ? null
        : Math.min(SEARCH_MAX_PAGE, Math.max(1, ...perTermPages));
    }

    console.log(
      `[apollo-search] user=${userId} key_source=${apollo.source} page=${page} ` +
        `per_page=${effPerPage} returned=${people.length} total=${totalEntries ?? "?"}` +
        `${fanOut ? ` fanout=${terms.length}[${terms.join("|")}]` : ""} ` +
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
        // True when the count is a sum across OR-ed terms and may double-count.
        total_is_upper_bound: fanOut,
      },
      // Surfaced so the UI never has to guess why a surname is masked, and so
      // the operator understands nothing has been charged yet.
      notice: "Search returns no email or phone and masks surnames. Enrichment is a separate, paid step.",
      // Present only when the Keywords box was OR-ed, so the UI can show what
      // was actually run rather than the raw string the operator typed.
      ...(fanOut ? { keyword_terms: terms } : {}),
      credits_consumed: 0,
      key_source: apollo.source,
    });
  } catch (error) {
    // A failed term must fail the whole search. Returning the terms that did
    // succeed would silently narrow the union — fewer people, no indication —
    // which is the same silent-loss trap this fan-out exists to remove.
    if (error instanceof ApolloSearchError) {
      return json({ error: error.message, hint: error.hint }, 502);
    }
    console.error("[apollo-search] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
