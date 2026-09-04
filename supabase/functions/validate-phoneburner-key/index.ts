// [validate-phoneburner-key v1]
//
// Validates a PhoneBurner Personal Access Token (PAT) by calling a cheap,
// read-only endpoint with Authorization: Bearer. Returns 200 with
// { valid: true } when the token is accepted; otherwise returns
// { valid: false, error } with a friendly message. Never logs the token.
//
// Endpoint choice: GET /rest/1/members (account metadata). Any 2xx means
// the PAT is valid. 401/403 → invalid/unauthorized; other statuses surface
// a generic error.

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

const PB_API_BASE = "https://www.phoneburner.com/rest/1";

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
    const token = apiKey.trim();

    let res: Response;
    try {
      res = await fetch(`${PB_API_BASE}/members`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
        },
      });
    } catch (e) {
      console.error("[validate-phoneburner-key] network error:", String(e));
      return json({ valid: false, error: "Could not reach PhoneBurner. Please try again." });
    }

    if (res.ok) {
      return json({ valid: true });
    }
    if (res.status === 401 || res.status === 403) {
      return json({ valid: false, error: "Invalid or unauthorized PhoneBurner API token." });
    }
    console.error(`[validate-phoneburner-key] unexpected HTTP ${res.status}`);
    return json({ valid: false, error: `PhoneBurner returned an unexpected error (${res.status}).` });
  } catch (err) {
    console.error("[validate-phoneburner-key] fatal:", err instanceof Error ? err.message : String(err));
    return json({ valid: false, error: "Could not validate API key. Please try again." }, 500);
  }
});

