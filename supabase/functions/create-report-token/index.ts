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

    // Data-analysis (incl. share links) is open to every logged-in user.
    // Authorization is per-report: the report's owner OR a platform admin.
    // Tokens are owned by the client (created_by = the client_analysis owner),
    // so the client manages their own links AND an admin can mint/revoke on
    // their behalf. callerIsAdmin is resolved here for the checks below.
    const adminCheck = await userClient
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    const callerIsAdmin = adminCheck.data?.is_platform_admin === true;

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

      // Verify the client_analysis row exists AND the caller may act on it:
      // the row owner, or a platform admin minting on the client's behalf.
      const { data: clientRow } = await supabase
        .from("client_analysis")
        .select("id, user_id")
        .eq("id", clientId)
        .maybeSingle();
      if (!clientRow || (clientRow.user_id !== user.id && !callerIsAdmin)) {
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
          // Owned by the CLIENT (row owner), not the caller — so the client
          // sees/manages their own links (owner RLS) and an admin minting on
          // their behalf doesn't hide the token under the admin's identity.
          created_by: clientRow.user_id,
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

    // Authorize revoke: the token must belong to a report the caller owns, or
    // the caller is a platform admin. Look up the token → its client_analysis
    // owner, then check owner-or-admin. We return success even when the token
    // doesn't exist / isn't authorized, so we don't leak token existence.
    const { data: tokRow } = await supabase
      .from("report_tokens")
      .select("id, client_id, client_analysis:client_id ( user_id )")
      .eq("token", targetToken)
      .maybeSingle();

    const ownerId = (tokRow?.client_analysis as { user_id?: string } | null)?.user_id;
    const mayRevoke = !!tokRow && (ownerId === user.id || callerIsAdmin);

    if (mayRevoke) {
      const { error: updateErr } = await supabase
        .from("report_tokens")
        .update({ revoked: true })
        .eq("id", tokRow.id);
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
    }

    logStep("Revoke processed", { revoked: mayRevoke });
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
