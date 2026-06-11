// [fetch-heyreach-accounts v1]
//
// Returns the caller's HeyReach LinkedIn accounts (the senders, not the
// campaigns). Used by NewClientAnalysisDialog to populate a checkbox list
// so admins pick accounts by name instead of typing raw integer IDs.
//
// Auth: JWT + is_platform_admin defense-in-depth (same pattern as
// generate-client-analysis). The Data Analysis tab is admin-gated in
// the UI, and the platform-API data this function returns should match
// that posture. Read-only: reads the caller's outbound_integrations
// row to obtain the HeyReach API key, then proxies a single HeyReach
// API call. No mutations.
//
// HeyReach endpoint: POST /li_account/GetAll with {offset, limit}.
// (Same snake-cased noun + /GetAll convention as /campaign/GetAll and
// /stats/GetOverallStats used by sync-heyreach-campaigns.)
//
// Returns up to 500 accounts (5 pages × 100); accounts beyond that are
// rare for a single Vrelly admin's HeyReach workspace and a follow-up
// can add full pagination if needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

const HEYREACH_API = "https://api.heyreach.io/api/public";
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[fetch-heyreach-accounts] ${step}${detailsStr}`);
};

interface HeyReachAccount {
  id: number;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  profileUrl?: string;
  [k: string]: unknown;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Defense-in-depth admin gate. UI tab is also hidden if not admin, but
    // the function is reachable via direct API call so we enforce here too.
    // Mirrors generate-client-analysis exactly.
    const adminCheck = await userClient
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!adminCheck.data?.is_platform_admin) {
      logStep("Non-admin caller blocked", { userId: user.id });
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // First active HeyReach integration owned by the caller. Same selection
    // shape as generate-client-analysis; if the user has multiple, the
    // first row wins (no ORDER BY) — acceptable for Phase 1.
    const { data: integrations } = await userClient
      .from("outbound_integrations")
      .select("id, api_key_encrypted")
      .eq("created_by", user.id)
      .eq("platform", "heyreach")
      .eq("is_active", true)
      .limit(1);

    const apiKey = integrations?.[0]?.api_key_encrypted as string | undefined;
    if (!apiKey) {
      // 200 with an empty list is friendlier UX than 404 here — the dialog
      // can render "No HeyReach integration configured" without treating
      // the dialog open itself as an error.
      return new Response(
        JSON.stringify({ accounts: [], reason: "no_integration" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accounts: HeyReachAccount[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(`${HEYREACH_API}/li_account/GetAll`, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ offset: page * PAGE_LIMIT, limit: PAGE_LIMIT }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        logStep(`HeyReach /li_account/GetAll failed`, {
          status: res.status,
          page,
          body: errText.substring(0, 300),
        });
        // Same pattern as generate-client-analysis's HeyReach failure:
        // soft-fail with whatever we collected so far so the dialog isn't
        // blocked by a transient platform hiccup.
        break;
      }

      const body = await res.json();
      const items = (body?.items ?? []) as HeyReachAccount[];
      accounts.push(...items);

      const totalCount = Number(body?.totalCount ?? 0);
      const reachedEnd =
        items.length < PAGE_LIMIT ||
        (totalCount > 0 && accounts.length >= totalCount);
      if (reachedEnd) break;
    }

    // Project to a minimal payload. Frontend reads these fields; full
    // HeyReach record stays on the server to keep response size bounded
    // and avoid leaking fields we haven't audited.
    const projected = accounts.map((a) => ({
      id: Number(a.id),
      firstName: typeof a.firstName === "string" ? a.firstName : null,
      lastName: typeof a.lastName === "string" ? a.lastName : null,
      emailAddress: typeof a.emailAddress === "string" ? a.emailAddress : null,
      profileUrl: typeof a.profileUrl === "string" ? a.profileUrl : null,
    }));

    logStep("Returning accounts", { count: projected.length });

    return new Response(
      JSON.stringify({ accounts: projected }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Fatal error", { error: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
