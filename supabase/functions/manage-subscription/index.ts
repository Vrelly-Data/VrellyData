import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIER_CONFIG = {
  starter: { priceId: 'price_starter', credits: 10000 },
  professional: { priceId: 'price_professional', credits: 25000 },
  enterprise: { priceId: 'price_enterprise', credits: 75000 },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!stripeKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Invalid user token');
    }

    const { action, tier, priceId } = await req.json();
    console.log(`Processing subscription action: ${action} for user ${user.id}`);

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    let result;

    if (action === 'create') {
      // Create Stripe customer if doesn't exist
      let customerId = profile.stripe_customer_id;
      
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;

        await supabase
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', user.id);
      }

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          supabase_user_id: user.id,
          tier: tier,
        },
      });

      result = {
        subscriptionId: subscription.id,
        clientSecret: (subscription.latest_invoice as any).payment_intent.client_secret,
      };

    } else if (action === 'update') {
      if (!profile.stripe_subscription_id) {
        throw new Error('No active subscription found');
      }

      // Update subscription with new price
      const subscription = await stripe.subscriptions.update(
        profile.stripe_subscription_id,
        {
          items: [{
            id: (await stripe.subscriptions.retrieve(profile.stripe_subscription_id)).items.data[0].id,
            price: priceId,
          }],
          proration_behavior: 'create_prorations',
          metadata: { tier },
        }
      );

      result = { subscriptionId: subscription.id, status: subscription.status };

    } else if (action === 'cancel') {
      if (!profile.stripe_subscription_id) {
        throw new Error('No active subscription found');
      }

      // Cancel at period end
      const subscription = await stripe.subscriptions.update(
        profile.stripe_subscription_id,
        { cancel_at_period_end: true }
      );

      result = { subscriptionId: subscription.id, cancelAt: subscription.cancel_at };
    }

    console.log(`Subscription ${action} successful:`, result);

    return new Response(
      JSON.stringify({ success: true, ...result }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Subscription management error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
