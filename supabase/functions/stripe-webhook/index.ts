import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const TIER_CREDITS = {
  starter: 10000,
  professional: 25000,
  enterprise: 75000,
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

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      throw new Error('Missing stripe-signature header');
    }

    const body = await req.text();
    const event = webhookSecret
      ? stripe.webhooks.constructEvent(body, signature, webhookSecret)
      : JSON.parse(body);

    console.log(`Processing webhook event: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata.supabase_user_id;
        const tier = subscription.metadata.tier || 'starter';

        if (!userId) {
          console.error('No user ID in subscription metadata');
          break;
        }

        const updates = {
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          subscription_tier: tier,
          monthly_credit_limit: TIER_CREDITS[tier as keyof typeof TIER_CREDITS] || 10000,
          billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          billing_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        };

        // Reset credits used if it's a new billing period
        if (event.type === 'customer.subscription.updated') {
          const { data: profile } = await supabase
            .from('profiles')
            .select('billing_period_end')
            .eq('id', userId)
            .single();

          if (profile && new Date(profile.billing_period_end) < new Date(subscription.current_period_start * 1000)) {
            (updates as any).credits_used_this_month = 0;
          }
        } else {
          (updates as any).credits_used_this_month = 0;
        }

        const { error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', userId);

        if (error) {
          console.error('Error updating profile:', error);
        } else {
          console.log(`Updated subscription for user ${userId}: ${tier}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata.supabase_user_id;

        if (!userId) {
          console.error('No user ID in subscription metadata');
          break;
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_status: 'canceled',
            subscription_tier: 'free',
            monthly_credit_limit: 100,
          })
          .eq('id', userId);

        if (error) {
          console.error('Error updating profile:', error);
        } else {
          console.log(`Canceled subscription for user ${userId}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = subscription.metadata.supabase_user_id;

        if (userId) {
          await supabase
            .from('profiles')
            .update({ subscription_status: 'active' })
            .eq('id', userId);

          console.log(`Payment succeeded for user ${userId}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = subscription.metadata.supabase_user_id;

        if (userId) {
          await supabase
            .from('profiles')
            .update({ subscription_status: 'past_due' })
            .eq('id', userId);

          console.log(`Payment failed for user ${userId}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
