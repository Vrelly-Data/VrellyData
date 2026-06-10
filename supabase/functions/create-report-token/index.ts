// [create-report-token v1]
//
// Admin-only token manager for the public client-report endpoint
// (get-client-report). Single function handles both create and revoke via
// an `action` field. Auth posture matches generate-client-analysis exactly:
// JWT-required + defense-in-depth is_platform_admin check, even though
// RLS would also enforce it.
//
// Requests:
//   POST { "action": "create", "clientId": "<uuid>" }
//     → 200 { "token": "<base64url>", "id": "<uuid>" }
//   POST { "action": "revoke", "token": "<base64url>" }
//     → 200 { "revoked": true }
//
// Token shape: 32 random bytes, base64url-encoded (no padding). 43 chars
// of URL-safe entropy — ~256 bits, far beyond brute-force range.
//
// Storage note: tokens are stored in plaintext. If leak-resistance becomes
// a hard requirement (DB dump = exposure), switch to storing a SHA-256 of
// the token; the admin-side caller can no longer re-display the token
// after mint, but the public lookup compares hashes instead. Out of scope
// for v1.

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

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[create-report-token] ${step}${detailsStr}`);
};

// 32 bytes → 256 bits of entropy → 43-char base64url string.
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  // Deno's btoa is binary-safe on the latin-1 string view we build below.
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(bin)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth check with the anon client + the caller's JWT — same pattern as
    // generate-client-analysis, so RLS policies engage on subsequent reads.
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Defense-in-depth admin gate. RLS already enforces is_platform_admin
    // via the policy, but we 403 explicitly here so the error message is
    // clear instead of a generic "row not found".
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

    const body = await req.json().catch(() => ({}));
    const action = (body as { action?: string }).action;

    if (action !== "create" && action !== "revoke") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid action (create|revoke)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Service-role client for the actual writes — bypasses RLS, which we've
    // already enforced above + via the explicit ownership checks below.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "create") {
      const clientId = (body as { clientId?: string }).clientId;
      if (!clientId) {
        return new Response(
          JSON.stringify({ error: "Missing clientId" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Verify the client_analysis row exists AND belongs to the caller.
      // Stops one admin from minting tokens for another admin's clients.
      const { data: clientRow } = await supabase
        .from("client_analysis")
        .select("id, user_id")
        .eq("id", clientId)
        .maybeSingle();
      if (!clientRow || clientRow.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "Client not found" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const newToken = generateToken();
      const { data: inserted, error: insertErr } = await supabase
        .from("report_tokens")
        .insert({
          token: newToken,
          client_id: clientId,
          created_by: user.id,
          revoked: false,
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        logStep("Insert failed", { error: insertErr?.message });
        return new Response(
          JSON.stringify({ error: "Failed to mint token" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      logStep("Minted token", { tokenId: inserted.id, clientId });
      return new Response(
        JSON.stringify({ token: newToken, id: inserted.id }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // action === "revoke"
    const targetToken = (body as { token?: string }).token;
    if (!targetToken) {
      return new Response(
        JSON.stringify({ error: "Missing token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Scope by created_by so an admin can't revoke another admin's token.
    // If the WHERE matches zero rows, supabase returns no error — we return
    // success either way so we don't leak whether the token existed.
    const { error: updateErr } = await supabase
      .from("report_tokens")
      .update({ revoked: true })
      .eq("token", targetToken)
      .eq("created_by", user.id);

    if (updateErr) {
      logStep("Revoke failed", { error: updateErr.message });
      return new Response(
        JSON.stringify({ error: "Failed to revoke token" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    logStep("Revoke processed");
    return new Response(JSON.stringify({ revoked: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Fatal error", { error: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
