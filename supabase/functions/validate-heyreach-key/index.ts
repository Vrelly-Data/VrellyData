// [validate-heyreach-key v1]
//
// Validates a HeyReach API key. Mirrors validate-smartlead-key's contract:
// POST { apiKey } -> { valid: boolean, error?: string }, always 200 except on a
// missing key, so the dialog can render a friendly message instead of a throw.
//
// AUTH SHAPE. HeyReach authenticates with an `X-API-KEY` HEADER (unlike
// Smartlead, which puts the credential in the query string). The key therefore
// never appears in a URL — but it must still never be logged.
//
// ENDPOINT CHOICE. /auth/CheckApiKey is HeyReach's documented, purpose-built
// key check and is the cheapest possible call. Some accounts/plans have been
// reported not to expose it, so on a 404/405 we fall back to
// POST /li_account/GetAll — the same endpoint fetch-heyreach-accounts:118
// already uses, which is read-only and known-good against live keys.
//
// Rate limit: HeyReach documents 300 requests/minute; a single validation is
// negligible.

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

const HEYREACH_API = "https://api.heyreach.io/api/public";

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

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return json({ valid: false, error: "API key is required" }, 400);
    }
    const key = apiKey.trim();

    // Primary: the purpose-built key check.
    let res: Response;
    try {
      res = await fetch(`${HEYREACH_API}/auth/CheckApiKey`, {
        method: "GET",
        headers: { "X-API-KEY": key, Accept: "application/json" },
      });
    } catch (e) {
      console.error("[validate-heyreach-key] network error on CheckApiKey:", String(e));
      return json({ valid: false, error: "Could not reach HeyReach. Please try again." });
    }

    // Fall back to the accounts endpoint when CheckApiKey isn't available on
    // this account/plan — never treat a routing gap as an invalid key.
    if (res.status === 404 || res.status === 405) {
      console.log("[validate-heyreach-key] CheckApiKey unavailable — falling back to li_account/GetAll");
      try {
        res = await fetch(`${HEYREACH_API}/li_account/GetAll`, {
          method: "POST",
          headers: { "X-API-KEY": key, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ offset: 0, limit: 1 }),
        });
      } catch (e) {
        console.error("[validate-heyreach-key] network error on GetAll:", String(e));
        return json({ valid: false, error: "Could not reach HeyReach. Please try again." });
      }
    }

    if (res.ok) {
      console.log("[validate-heyreach-key] key accepted");
      return json({ valid: true });
    }
    if (res.status === 401 || res.status === 403) {
      // Log status only — never the key or a body that might echo it.
      console.warn(`[validate-heyreach-key] key rejected (HTTP ${res.status})`);
      return json({ valid: false, error: "Invalid HeyReach API key." });
    }
    if (res.status === 429) {
      return json({ valid: false, error: "HeyReach rate limit hit. Please try again in a minute." });
    }
    console.error(`[validate-heyreach-key] unexpected HTTP ${res.status}`);
    return json({ valid: false, error: `HeyReach returned an unexpected error (${res.status}).` });
  } catch (err) {
    console.error("[validate-heyreach-key] fatal:", err instanceof Error ? err.message : String(err));
    return json({ valid: false, error: "Could not validate API key. Please try again." });
  }
});
