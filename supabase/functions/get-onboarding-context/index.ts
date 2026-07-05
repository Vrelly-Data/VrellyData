// [get-onboarding-context v1]
//
// Public, no-auth. Backs the /onboard/:token questionnaire. Given a token,
// returns just enough to render the form (prefill + already_paid) OR a
// terminal status the page can message on. Runs under the service role and
// reads onboarding_tokens directly — same posture as get-client-report.
//
// Does NOT consume the token. Only provision-onboarding (Phase 3) claims it.
//
// Request:  POST { "token": "<base64url>" }
// Response: 200 { "status": "valid", "email", "displayName", "company", "alreadyPaid" }
//           200 { "status": "consumed" | "expired" | "invalid" }
//
// We return 200 with a status discriminator (not HTTP error codes) so the
// client page can branch on the reason without treating it as a network
// failure. "invalid" covers both not-found and revoked — no existence leak.

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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String((body as { token?: string }).token ?? "").trim();
    if (!token) return json({ status: "invalid" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: row } = await supabase
      .from("onboarding_tokens")
      .select("email, display_name, company, already_paid, consumed_at, expires_at, revoked")
      .eq("token", token)
      .maybeSingle();

    // Not found or revoked → generic invalid (no existence leak).
    if (!row || row.revoked) return json({ status: "invalid" });
    if (row.consumed_at) return json({ status: "consumed" });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return json({ status: "expired" });
    }

    return json({
      status: "valid",
      email: row.email,
      displayName: row.display_name,
      company: row.company,
      alreadyPaid: row.already_paid,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[get-onboarding-context] Fatal error - ${msg}`);
    return json({ error: msg }, 500);
  }
});
