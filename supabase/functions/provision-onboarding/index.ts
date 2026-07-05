// [provision-onboarding v1]
//
// The money endpoint of the self-serve onboarding flow. Public (token-authed,
// no JWT), runs under service_role. Claims the onboarding token, creates the
// $0 agent subscription (prepaid path), and provisions the account chain.
//
// Request:  POST { "token": "<base64url>", "config": { ...agent_configs } }
// Response: 200 { "ok": true } | 4xx/5xx { "error": "..." }
//
// INVARIANTS (see docs/self-serve-onboarding-plan.md):
//   1. IDEMPOTENCY. The token is claimed ATOMICALLY (consumed_at) BEFORE any
//      Stripe call — a concurrent double-submit loses the claim (0 rows) and
//      aborts. Stripe customer/subscription creates carry idempotency keys
//      (keyed on user_id) so a sequential retry never makes a second
//      subscription or double-charge. On any post-claim failure we RELEASE the
//      claim so the client can retry; every downstream step is idempotent
//      (Stripe keys + DB upserts + existence guards), so retry converges.
//   2. already_paid is read from the CLAIMED TOKEN ROW only — never the body.
//   3. LOOP-SAFE. We write BOTH profiles and user_credits to active/agent
//      regardless of webhook timing (SubscriptionGuard reads user_credits,
//      ChoosePlan reads profiles — they must agree or the first login loops).

import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
  console.log(`[provision-onboarding] ${step}${detailsStr}`);
};

// 32 bytes → base64url, mirrors create-report-token.
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// "Acme Corp" -> "acme-corp-<6 rand>", matching NewClientAnalysisDialog.
function buildSlug(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(36))
    .join("")
    .slice(0, 6);
  return `${base || "client"}-${suffix}`;
}

// Whitelist the agent_configs fields we accept from the questionnaire. Anything
// else in `config` is ignored — the client can't set system columns.
function pickConfig(config: Record<string, unknown>) {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  return {
    company_name: str(config.company_name),
    company_url: str(config.company_url),
    sender_name: str(config.sender_name),
    sender_title: str(config.sender_title),
    sender_linkedin: str(config.sender_linkedin),
    sender_bio: str(config.sender_bio),
    offer_description: str(config.offer_description),
    target_icp: str(config.target_icp),
    outcome_delivered: str(config.outcome_delivered),
    desired_action: str(config.desired_action),
    communication_style: str(config.communication_style) ?? "conversational",
    sample_message: str(config.sample_message),
    avoid_phrases: Array.isArray(config.avoid_phrases)
      ? (config.avoid_phrases as unknown[])
          .map((p) => (typeof p === "string" ? p.trim() : ""))
          .filter(Boolean)
      : [],
    calendar_link: str(config.calendar_link),
    default_cc: str(config.default_cc),
    agent_knowledge: str(config.agent_knowledge),
    pricing_summary: str(config.pricing_summary),
    case_studies: str(config.case_studies),
    disqualification_criteria: str(config.disqualification_criteria),
    objection_handling_notes: str(config.objection_handling_notes),
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Release a claimed token so the client can retry after a transient failure.
  const releaseClaim = async (token: string) => {
    const { error } = await supabase
      .from("onboarding_tokens")
      .update({ consumed_at: null })
      .eq("token", token);
    if (error) logStep("Claim release failed", { error: error.message });
    else logStep("Claim released for retry");
  };

  let claimedToken: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const token = String((body as { token?: string }).token ?? "").trim();
    const config = pickConfig(
      ((body as { config?: Record<string, unknown> }).config ?? {}),
    );

    if (!token) return json({ error: "Missing token" }, 400);

    // Validate required agent_configs fields (NOT NULL columns) up front,
    // before claiming — no point burning the token on an invalid payload.
    if (!config.company_name || !config.sender_name || !config.offer_description) {
      return json(
        { error: "company_name, sender_name and offer_description are required" },
        400,
      );
    }

    // ---- Step 0: ATOMIC CLAIM (before any Stripe call) -------------------
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabase
      .from("onboarding_tokens")
      .update({ consumed_at: nowIso })
      .eq("token", token)
      .is("consumed_at", null)
      .eq("revoked", false)
      .gt("expires_at", nowIso)
      .select("user_id, email, already_paid");

    if (claimErr) {
      logStep("Claim query errored", { error: claimErr.message });
      return json({ error: "Provisioning failed" }, 500);
    }
    if (!claimed || claimed.length !== 1) {
      // 0 rows = already consumed / revoked / expired / not found.
      logStep("Claim returned no row (already used or invalid)");
      return json(
        { error: "This onboarding link is no longer valid or was already used." },
        409,
      );
    }
    claimedToken = token;
    const { user_id, email, already_paid } = claimed[0] as {
      user_id: string;
      email: string | null;
      already_paid: boolean;
    };
    logStep("Token claimed", { user_id, already_paid });

    // Non-prepaid path is Phase 5. Release the claim (don't burn the link)
    // and return a clear error.
    if (!already_paid) {
      await releaseClaim(token);
      claimedToken = null;
      return json(
        { error: "Online payment isn't available yet — please contact us to complete setup." },
        400,
      );
    }

    // ---- Step 1: Stripe ($0 agent subscription via 100%-off coupon) -----
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
    });
    const agentPriceId = Deno.env.get("STRIPE_PRICE_AGENT_MONTHLY")!;
    const coupon = Deno.env.get("STRIPE_COUPON_EXISTING_CLIENT")!;

    // Reuse an existing customer if a prior partial run stored one; else
    // create with an idempotency key so a retry returns the same customer.
    const { data: existingCredits } = await supabase
      .from("user_credits")
      .select("stripe_customer_id")
      .eq("user_id", user_id)
      .maybeSingle();

    let customerId = existingCredits?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: email ?? undefined,
          name: config.company_name,
          metadata: { supabase_user_id: user_id },
        },
        { idempotencyKey: `onboard-cust-${user_id}` },
      );
      customerId = customer.id;
      logStep("Stripe customer created", { customerId });
    }

    const subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: agentPriceId }],
        coupon,
        metadata: { supabase_user_id: user_id, plan: "agent", interval: "monthly" },
      },
      { idempotencyKey: `onboard-sub-${user_id}` },
    );
    logStep("Stripe subscription created", {
      subscriptionId: subscription.id,
      status: subscription.status,
    });
    const currentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    // ---- Step 2: LOOP-SAFE billing writes (both tables) ------------------
    const { error: profErr } = await supabase
      .from("profiles")
      .update({
        subscription_tier: "agent",
        subscription_status: "active",
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
      })
      .eq("id", user_id);
    if (profErr) throw new Error(`profiles update: ${profErr.message}`);

    const { error: credErr } = await supabase
      .from("user_credits")
      .upsert(
        {
          user_id,
          plan: "agent",
          subscription_status: "active",
          billing_interval: "monthly",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          export_credits_total: 999999,
          export_credits_used: 0,
          ai_credits_total: 999999,
          ai_credits_used: 0,
          current_period_end: currentPeriodEnd,
        },
        { onConflict: "user_id" },
      );
    if (credErr) throw new Error(`user_credits upsert: ${credErr.message}`);
    logStep("Billing state written (profiles + user_credits)");

    // ---- Step 3: agent_configs upsert (questionnaire) --------------------
    const { error: cfgErr } = await supabase
      .from("agent_configs")
      .upsert(
        {
          user_id,
          ...config,
          is_active: true,
          onboarding_complete: true,
        },
        { onConflict: "user_id" },
      );
    if (cfgErr) throw new Error(`agent_configs upsert: ${cfgErr.message}`);
    logStep("agent_configs upserted");

    // ---- Step 4: client_analysis + report_tokens (guard on existing) -----
    const { data: existingClient } = await supabase
      .from("client_analysis")
      .select("id")
      .eq("user_id", user_id)
      .limit(1)
      .maybeSingle();

    if (!existingClient) {
      const { data: newClient, error: caErr } = await supabase
        .from("client_analysis")
        .insert({
          user_id,
          display_name: config.company_name,
          slug: buildSlug(config.company_name),
          heyreach_account_ids: [],
          smartlead_campaign_ids: [],
          synced_campaign_ids: [],
        })
        .select("id")
        .single();
      if (caErr || !newClient) {
        throw new Error(`client_analysis insert: ${caErr?.message ?? "no row"}`);
      }
      const { error: rtErr } = await supabase.from("report_tokens").insert({
        token: generateToken(),
        client_id: newClient.id,
        created_by: user_id,
        revoked: false,
      });
      if (rtErr) throw new Error(`report_tokens insert: ${rtErr.message}`);
      logStep("client_analysis + report_token created", { clientId: newClient.id });
    } else {
      logStep("client_analysis already exists — skipping create", {
        clientId: existingClient.id,
      });
    }

    logStep("Provisioning complete", { user_id });
    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Fatal error — releasing claim for retry", { error: msg });
    // Release the claim so the client can retry; downstream steps are
    // idempotent (Stripe keys + upserts + existence guards).
    if (claimedToken) await releaseClaim(claimedToken);
    return json({ error: "Provisioning failed. Please try again." }, 500);
  }
});
