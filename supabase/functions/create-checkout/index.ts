import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

const PRICE_MAP: Record<string, Record<string, string>> = {
  starter: {
    monthly: Deno.env.get('STRIPE_PRICE_STARTER_MONTHLY')!,
    annual: Deno.env.get('STRIPE_PRICE_STARTER_ANNUAL')!,
  },
  professional: {
    monthly: Deno.env.get('STRIPE_PRICE_PROFESSIONAL_MONTHLY')!,
    annual: Deno.env.get('STRIPE_PRICE_PROFESSIONAL_ANNUAL')!,
  },
  enterprise: {
    monthly: Deno.env.get('STRIPE_PRICE_ENTERPRISE_MONTHLY')!,
    annual: Deno.env.get('STRIPE_PRICE_ENTERPRISE_ANNUAL')!,
  },
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const body = await req.json();

    // Support both old format (priceId) and new format (plan + interval)
    let priceId: string;
    let plan: string | undefined;
    let interval: string | undefined;

    if (body.priceId) {
      // Legacy: direct price ID
      priceId = body.priceId;
      logStep("Using legacy priceId", { priceId });
    } else if (body.plan && body.interval) {
      // New: plan + interval
      plan = body.plan;
      interval = body.interval;
      if (!PRICE_MAP[plan] || !PRICE_MAP[plan][interval]) {
        throw new Error(`Invalid plan "${plan}" or interval "${interval}"`);
      }
      priceId = PRICE_MAP[plan][interval];
      logStep("Resolved price from plan+interval", { plan, interval, priceId });
    } else {
      throw new Error("Either priceId or (plan + interval) is required");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2023-10-16",
    });

    // Get or create Stripe customer
    const { data: credits } = await supabaseClient
      .from('user_credits')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    let customerId = credits?.stripe_customer_id;

    if (!customerId) {
      // Check if customer exists in Stripe by email
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        logStep("Existing Stripe customer found", { customerId });
      } else {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;
        logStep("Created new Stripe customer", { customerId });
      }

      // Save customer ID to user_credits
      await supabaseClient
        .from('user_credits')
        .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
    }

    const appUrl = Deno.env.get('APP_URL') || req.headers.get("origin") || "http://localhost:8080";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        ...(plan && { plan }),
        ...(interval && { interval }),
      },
    });
    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
