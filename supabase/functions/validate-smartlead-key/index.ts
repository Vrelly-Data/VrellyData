// [validate-smartlead-key v1]
// Validates a Smartlead API key by calling the cheapest authenticated
// endpoint (GET /campaigns). Smartlead auth goes in the QUERY STRING
// (?api_key=...) — never in a header, and the full URL must never be
// logged because it contains the credential.

import { createClient as _createClient } from "https://esm.sh/@supabase/supabase-js@2";

// createClient is imported for parity with other functions; not used here
// because no DB writes happen during validation.
void _createClient;

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

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const apiKey: unknown = (body as { apiKey?: unknown }).apiKey;

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return new Response(
        JSON.stringify({ valid: false, error: "API key is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build the URL with URLSearchParams so the api_key is properly encoded.
    // NEVER log this URL — it contains the credential.
    const url = new URL(`${SMARTLEAD_API_BASE}/campaigns`);
    url.searchParams.set("api_key", apiKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (response.status === 401 || response.status === 403) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: "Invalid or unauthorized Smartlead API key.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!response.ok) {
      // Log the status and body snippet, but never the URL (contains api_key).
      const bodyText = await response.text();
      console.error(
        "[validate-smartlead-key v1] Smartlead API error:",
        response.status,
        bodyText.substring(0, 500),
      );
      return new Response(
        JSON.stringify({
          valid: false,
          error: `Smartlead API returned ${response.status}. Check the key and try again.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Shape check: /campaigns typically returns an array (or {data: [...]}).
    // We don't extract an account name — Smartlead /campaigns doesn't return
    // one. Future: call a different endpoint for account metadata if needed.
    const data = await response.json().catch(() => null);
    const looksValid =
      Array.isArray(data) ||
      Array.isArray((data as { data?: unknown })?.data) ||
      Array.isArray((data as { campaigns?: unknown })?.campaigns);

    if (!looksValid) {
      console.warn(
        "[validate-smartlead-key v1] Unexpected response shape, accepting key anyway:",
        data ? Object.keys(data).slice(0, 10) : "null body",
      );
    }

    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[validate-smartlead-key v1] Error:", err);
    return new Response(
      JSON.stringify({
        valid: false,
        error: "Could not validate API key. Please try again.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
