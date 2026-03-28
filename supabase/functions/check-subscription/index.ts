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
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

// Tier configuration mapping product IDs to tier info
const TIER_CONFIG: Record<string, { tier: string; credits: number }> = {
  "prod_TMHGcnFjx5n8DZ": { tier: "starter", credits: 10000 },
  "prod_TMHHjUdtt2Xbdl": { tier: "professional", credits: 25000 },
  "prod_TMHItV1NP0yBYU": { tier: "enterprise", credits: 75000 },
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      logStep("No customer found");
      
      // Update profile to free tier
      await supabaseClient
        .from('profiles')
        .update({
          subscription_status: 'inactive',
          subscription_tier: 'free',
          stripe_customer_id: null,
          stripe_subscription_id: null,
          monthly_credit_limit: 0,
        })
        .eq('id', user.id);
      
      return new Response(JSON.stringify({ 
        subscribed: false,
        tier: 'free',
        credits: 0
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    
    const hasActiveSub = subscriptions.data.length > 0;
    let tier = 'free';
    let credits = 0;
    let subscriptionEnd = null;
    let subscriptionId = null;
    let cancelAtPeriodEnd = false;
    let cancelAt = null;

    if (hasActiveSub) {
      const subscription = subscriptions.data[0];
      subscriptionId = subscription.id;
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      cancelAtPeriodEnd = subscription.cancel_at_period_end;
      cancelAt = subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null;
      const productId = subscription.items.data[0].price.product as string;
      
      const tierInfo = TIER_CONFIG[productId];
      if (tierInfo) {
        tier = tierInfo.tier;
        credits = tierInfo.credits;
      }
      logStep("Active subscription found", { subscriptionId, tier, credits, endDate: subscriptionEnd, cancelAtPeriodEnd, cancelAt });

      // Get current profile to check if billing period has changed
      const { data: currentProfile } = await supabaseClient
        .from('profiles')
        .select('billing_period_start, billing_period_end')
        .eq('id', user.id)
        .single();

      const newPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
      const shouldResetCredits = !currentProfile?.billing_period_start || 
                                  new Date(currentProfile.billing_period_start) < new Date(newPeriodStart);

      // Update profile with subscription info
      const updateData: any = {
        subscription_status: 'active',
        subscription_tier: tier,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        monthly_credit_limit: credits,
        billing_period_start: newPeriodStart,
        billing_period_end: subscriptionEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        cancel_at: cancelAt,
      };

      // Reset credits_used_this_month if new billing period started
      if (shouldResetCredits) {
        updateData.credits_used_this_month = 0;
        updateData.credits = credits;
        logStep("Resetting credits for new billing period", { credits });
      }

      await supabaseClient
        .from('profiles')
        .update(updateData)
        .eq('id', user.id);
    } else {
      logStep("No active subscription found");
      
      // Update profile to free tier
      await supabaseClient
        .from('profiles')
        .update({
          subscription_status: 'inactive',
          subscription_tier: 'free',
          stripe_customer_id: customerId,
          stripe_subscription_id: null,
          monthly_credit_limit: 0,
        })
        .eq('id', user.id);
    }

    return new Response(JSON.stringify({
      subscribed: hasActiveSub,
      tier,
      credits,
      subscription_end: subscriptionEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      cancel_at: cancelAt,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
