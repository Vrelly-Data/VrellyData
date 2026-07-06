import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const REPLY_API_BASE = "https://api.reply.io/v1";
const REPLY_API_V3 = "https://api.reply.io/v3";

interface ValidateRequest {
  platform: string;
  apiKey: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { platform, apiKey }: ValidateRequest = await req.json();

    if (!platform || !apiKey) {
      return new Response(
        JSON.stringify({ valid: false, error: "Platform and API key are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (platform === "reply.io") {
      // Reject Organization API keys (prefix "org_") BEFORE any API call.
      // They span ALL workspaces, so one client's org key would see every
      // client's data. Vrelly requires a workspace-scoped Team API key. The
      // prefix is unambiguous, so no network round-trip is needed.
      if (apiKey.trim().startsWith("org_")) {
        return new Response(
          JSON.stringify({
            valid: false,
            error:
              "This is an Organization API key, which spans all workspaces. " +
              "Vrelly needs a workspace-scoped Team API key — create one inside " +
              "the client's workspace under Team API keys.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // v3 first: GET /v3/whoami with Bearer auth. 200 => valid (modern
      // path). We fall back to the legacy v1 check on ANY non-2xx (incl.
      // 401), so pre-v3 keys still validate. Valid if EITHER succeeds.
      try {
        const whoamiRes = await fetch(`${REPLY_API_V3}/whoami`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
          },
        });
        if (whoamiRes.ok) {
          return new Response(
            JSON.stringify({ valid: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Non-2xx (incl. 401) → fall through to the legacy v1 validator.
      } catch (whoamiErr) {
        console.error("Reply.io v3 whoami error, falling back to v1:", whoamiErr);
      }

      // Legacy fallback: v1 /people + X-Api-Key (unchanged below).
      const response = await fetch(`${REPLY_API_BASE}/people?limit=1`, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (response.status === 401) {
        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: "Invalid API key. Please check your Reply.io API key in Settings → API Key." 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (response.status === 403) {
        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: "API key does not have sufficient permissions." 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Reply.io API error:", response.status, errorText);
        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: `Reply.io API error: ${response.status}` 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Success!
      return new Response(
        JSON.stringify({ valid: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Platforms need an explicit validator — Smartlead has validate-smartlead-key,
    // future ones (Instantly, Lemlist) will need their own. Silent `valid: true`
    // was a footgun: it would auto-approve any API key / garbage input for any
    // platform we hadn't explicitly implemented, leaking through to the DB.
    return new Response(
      JSON.stringify({
        valid: false,
        error:
          `No validator configured for platform "${platform}". ` +
          `Call the platform-specific validator (e.g. validate-smartlead-key for Smartlead).`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Validation error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: "Could not validate API key. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
