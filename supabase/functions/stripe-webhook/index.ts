import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// Map Stripe Product IDs to tiers and credits
const TIER_CONFIG: Record<string, { tier: string; credits: number }> = {
  'prod_TMHGcnFjx5n8DZ': { tier: 'starter', credits: 10000 },
  'prod_TMHHjUdtt2Xbdl': { tier: 'professional', credits: 25000 },
  'prod_TMHItV1NP0yBYU': { tier: 'enterprise', credits: 75000 },
};

// Backward compatibility with tier names
const TIER_CREDITS: Record<string, number> = {
  starter: 10000,
  professional: 25000,
  enterprise: 75000,
  // Legacy names
  pro: 25000,
  premium: 75000,
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

Deno.serve(async (req) => {
  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!stripeKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured - webhook signature verification required');
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      throw new Error('Missing stripe-signature header');
    }

    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    logStep(`Processing webhook event: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        
        logStep('Processing subscription event', { 
          subscriptionId: subscription.id, 
          customerId,
          status: subscription.status 
        });

        // Get product ID from subscription items
        const productId = subscription.items.data[0]?.price?.product as string;
        logStep('Subscription product', { productId });

        // Look up tier from product ID or fallback to metadata
        let tier = 'starter';
        let credits = 10000;
        
        if (productId && TIER_CONFIG[productId]) {
          tier = TIER_CONFIG[productId].tier;
          credits = TIER_CONFIG[productId].credits;
          logStep('Tier from product ID', { productId, tier, credits });
        } else if (subscription.metadata.tier) {
          tier = subscription.metadata.tier;
          credits = TIER_CREDITS[tier] || 10000;
          logStep('Tier from metadata', { tier, credits });
        }

        // Find user by Stripe customer ID
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, billing_period_end')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profileError || !profile) {
          // Try finding by user ID in metadata
          const userId = subscription.metadata.supabase_user_id;
          if (!userId) {
            logStep('Could not find user', { customerId, error: profileError?.message });
            break;
          }
          
          const updates: Record<string, any> = {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            subscription_tier: tier,
            monthly_credit_limit: credits,
            billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            billing_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          };

          // Reset credits for new subscription
          if (event.type === 'customer.subscription.created') {
            updates.credits_used_this_month = 0;
          }

          const { error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId);

          if (error) {
            logStep('Error updating profile by user ID', { userId, error: error.message });
          } else {
            logStep('Updated subscription for user', { userId, tier, credits });
          }
          break;
        }

        const userId = profile.id;
        const updates: Record<string, any> = {
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          subscription_tier: tier,
          monthly_credit_limit: credits,
          billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          billing_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
        };

        // Reset credits used if it's a new billing period
        if (event.type === 'customer.subscription.updated') {
          if (profile.billing_period_end && new Date(profile.billing_period_end) < new Date(subscription.current_period_start * 1000)) {
            updates.credits_used_this_month = 0;
            logStep('Resetting credits for new billing period');
          }
        } else {
          updates.credits_used_this_month = 0;
        }

        const { error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', userId);

        if (error) {
          logStep('Error updating profile', { userId, error: error.message });
        } else {
          logStep('Updated subscription', { userId, tier, credits, status: subscription.status });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        logStep('Processing subscription deletion', { subscriptionId: subscription.id, customerId });

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        const userId = profile?.id || subscription.metadata.supabase_user_id;

        if (!userId) {
          logStep('No user ID found for subscription deletion');
          break;
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_status: 'canceled',
            subscription_tier: 'free',
            monthly_credit_limit: 0,
            cancel_at_period_end: false,
            cancel_at: null,
          })
          .eq('id', userId);

        if (error) {
          logStep('Error updating profile on cancellation', { userId, error: error.message });
        } else {
          logStep('Canceled subscription', { userId });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const customerId = subscription.customer as string;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        const userId = profile?.id || subscription.metadata.supabase_user_id;

        if (userId) {
          await supabase
            .from('profiles')
            .update({ subscription_status: 'active' })
            .eq('id', userId);

          logStep('Payment succeeded', { userId });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const customerId = subscription.customer as string;

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        const userId = profile?.id || subscription.metadata.supabase_user_id;

        if (userId) {
          await supabase
            .from('profiles')
            .update({ subscription_status: 'past_due' })
            .eq('id', userId);

          logStep('Payment failed', { userId });
        }
        break;
      }

      default:
        logStep(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    logStep('Webhook error', { error: error instanceof Error ? error.message : 'Unknown error' });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
