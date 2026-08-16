// [validate-apollo-key v1]
//
// Validates an Apollo API key before it is stored as an outbound_integrations
// row. Required, not optional: validate-api-key REJECTS platforms with no
// configured validator (a deliberate change, after unvalidated platforms leaked
// into the DB), so without this function an 'apollo' integration cannot be
// created at all.
//
// TWO CHECKS, because "the key works" and "the key works for what we need" are
// different questions here:
//
//   1. GET /auth/health   — is this a live, logged-in key at all?
//   2. POST /mixed_people/api_search (per_page 1) — Apollo's people search
//      requires a MASTER key. A scoped key passes check 1 and then 403s on
//      every search, which would surface much later as "Apollo search failed"
//      with no clue why. Catch it at the point the operator can still fix it.
//
// BOTH CHECKS COST 0 CREDITS. api_search is free (that is the whole reason the
// browse/enrich split exists), so validation never spends the client's money.
// Enrichment is never called here.

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const APOLLO_BASE = "https://api.apollo.io/api/v1";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const apiKey: unknown = (body as { apiKey?: unknown }).apiKey;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return json({ valid: false, error: "API key is required" }, 400);
    }
    const key = apiKey.trim();

    // The key travels in a header for Apollo — never in the URL, so nothing
    // here can leak it into a log line.
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": key,
    };

    // ---- 1. is the key live at all? ----------------------------------------
    const health = await fetch(`${APOLLO_BASE}/auth/health`, { headers });

    if (health.status === 401 || health.status === 403) {
      return json({ valid: false, error: "Apollo rejected this API key." });
    }
    if (!health.ok) {
      console.error(`[validate-apollo-key] auth/health HTTP ${health.status}`);
      return json({ valid: false, error: "Could not reach Apollo. Please try again." });
    }

    const healthBody = await health.json().catch(() => ({}));
    if (healthBody?.is_logged_in === false) {
      return json({ valid: false, error: "Apollo reports this key is not logged in." });
    }

    // ---- 2. is it a MASTER key? --------------------------------------------
    const probe = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
      method: "POST",
      headers,
      // A deliberately tiny, cheap query. Still 0 credits.
      body: JSON.stringify({ person_titles: ["CEO"], page: 1, per_page: 1 }),
    });

    if (probe.status === 403) {
      return json({
        valid: false,
        error:
          "This key is valid but not a MASTER key. Apollo's people search requires a master API key — " +
          "create one in Apollo under Settings → Integrations → API.",
      });
    }
    if (probe.status === 429) {
      // Rate limited, not invalid. Do not tell the operator their key is bad.
      return json({
        valid: false,
        error: "Apollo is rate-limiting this key right now. Try again in a minute.",
      });
    }
    if (!probe.ok) {
      console.error(`[validate-apollo-key] api_search probe HTTP ${probe.status}`);
      return json({ valid: false, error: "Could not verify search access. Please try again." });
    }

    console.log("[validate-apollo-key] key validated (health ok, master-key search ok)");
    return json({ valid: true });
  } catch (error) {
    console.error("[validate-apollo-key] Fatal:", error);
    return json({ valid: false, error: "Could not validate API key. Please try again." });
  }
});
