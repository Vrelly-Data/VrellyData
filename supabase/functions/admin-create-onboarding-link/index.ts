// [admin-create-onboarding-link v1]
//
// Phase 1 of the self-serve onboarding flow. Admin-only. Creates the client's
// auth user UP FRONT (so the signup triggers auto-provision profiles/team/
// user_credits) and mints an onboarding_tokens row scoped to that user. The
// admin sends the returned link to the client; Phase 2/3 handle the
// questionnaire + provisioning.
//
// Auth posture matches create-report-token exactly: JWT-required +
// defense-in-depth is_platform_admin check.
//
// Request:
//   POST { "email": "...", "displayName": "...", "company": "...",
//          "alreadyPaid": true|false }
//     → 200 { "token": "<base64url>", "userId": "<uuid>", "email": "..." }
//
// already_paid is captured HERE (admin's checkbox) and stored on the token
// row — it is the ONLY source of truth for the free-tier decision. The
// client never gets to assert it.
//
// Orphan note: the auth user exists the moment this succeeds, even if the
// client never completes onboarding. Cleanup = revoke the token + delete the
// user via admin-delete-user (an abandoned onboarding user is a normal member).

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
  console.log(`[admin-create-onboarding-link] ${step}${detailsStr}`);
};

// 32 bytes → 256 bits of entropy → 43-char base64url string. Mirrors
// create-report-token so the two token families look identical.
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(bin)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth check with the anon client + the caller's JWT.
    const jwt = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Defense-in-depth admin gate.
    const adminCheck = await userClient
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!adminCheck.data?.is_platform_admin) {
      logStep("Non-admin caller blocked", { userId: user.id });
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String((body as { email?: string }).email ?? "").trim().toLowerCase();
    const displayName = String((body as { displayName?: string }).displayName ?? "").trim();
    const company = String((body as { company?: string }).company ?? "").trim();
    const alreadyPaid = (body as { alreadyPaid?: boolean }).alreadyPaid === true;

    if (!email || !isValidEmail(email)) {
      return json({ error: "A valid email is required" }, 400);
    }

    // Service-role client for the privileged writes.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Create the auth user. email_confirm:true skips the confirmation
    //    email (admin handles login separately — via magic link / password
    //    reset). No password set here on purpose.
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: displayName || null },
    });

    if (createErr || !created?.user) {
      // Most common: the email already has an account. Surface it clearly
      // rather than as a generic 500.
      const msg = createErr?.message ?? "Failed to create user";
      const alreadyExists = /already|exists|registered|duplicate/i.test(msg);
      logStep("createUser failed", { email, error: msg });
      return json(
        { error: alreadyExists ? "A user with that email already exists" : msg },
        alreadyExists ? 409 : 500,
      );
    }

    const newUserId = created.user.id;

    // 2. Mint the onboarding token. If this fails, roll back the just-created
    //    auth user so we don't strand an orphan with no link.
    const token = generateToken();
    const { error: insertErr } = await supabase
      .from("onboarding_tokens")
      .insert({
        token,
        user_id: newUserId,
        email,
        display_name: displayName || null,
        company: company || null,
        already_paid: alreadyPaid,
        created_by: user.id,
      });

    if (insertErr) {
      logStep("Token insert failed — rolling back auth user", {
        userId: newUserId,
        error: insertErr.message,
      });
      await supabase.auth.admin.deleteUser(newUserId).catch((e) =>
        logStep("Rollback deleteUser failed", { userId: newUserId, error: String(e) })
      );
      return json({ error: "Failed to mint onboarding link" }, 500);
    }

    logStep("Onboarding link minted", { userId: newUserId, alreadyPaid });
    return json({ token, userId: newUserId, email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Fatal error", { error: msg });
    return json({ error: msg }, 500);
  }
});
