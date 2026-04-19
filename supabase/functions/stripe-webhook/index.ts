import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// Credit allocations per plan
const PLAN_CREDITS: Record<string, { export_credits: number; ai_credits: number }> = {
  starter:      { export_credits: 10000,  ai_credits: 50   },
  professional: { export_credits: 25000,  ai_credits: 250  },
  enterprise:   { export_credits: 999999, ai_credits: 1250 }, // 999999 = internal "unlimited" flag
  agent:        { export_credits: 999999, ai_credits: 999999 },
};

// Map Stripe Product IDs to tiers (backward compatibility)
const TIER_CONFIG: Record<string, string> = {
  'prod_TMHGcnFjx5n8DZ': 'starter',
  'prod_TMHHjUdtt2Xbdl': 'professional',
  'prod_TMHItV1NP0yBYU': 'enterprise',
  'prod_UHwCt3x8a3cLlt': 'agent',
};

// Map Stripe price IDs to plan names
function getPlanFromPriceId(priceId: string): string | null {
  const map: Record<string, string> = {
    [Deno.env.get('STRIPE_PRICE_STARTER_MONTHLY') || '']:      'starter',
    [Deno.env.get('STRIPE_PRICE_STARTER_ANNUAL') || '']:       'starter',
    [Deno.env.get('STRIPE_PRICE_PROFESSIONAL_MONTHLY') || '']: 'professional',
    [Deno.env.get('STRIPE_PRICE_PROFESSIONAL_ANNUAL') || '']:  'professional',
    [Deno.env.get('STRIPE_PRICE_ENTERPRISE_MONTHLY') || '']:   'enterprise',
    [Deno.env.get('STRIPE_PRICE_ENTERPRISE_ANNUAL') || '']:    'enterprise',
    'price_1TJMK4K2suFUahyvNqIdkFjZ': 'agent',
    'price_1TJMK4K2suFUahyvq3MH04v3': 'agent',
  };
  return map[priceId] ?? null;
}

function getBillingInterval(priceId: string): string {
  const annualIds = [
    Deno.env.get('STRIPE_PRICE_STARTER_ANNUAL'),
    Deno.env.get('STRIPE_PRICE_PROFESSIONAL_ANNUAL'),
    Deno.env.get('STRIPE_PRICE_ENTERPRISE_ANNUAL'),
    'price_1TJMK4K2suFUahyvq3MH04v3',
  ];
  return annualIds.includes(priceId) ? 'annual' : 'monthly';
}

function resolvePlanFromProduct(productId: string): string {
  return TIER_CONFIG[productId] || 'starter';
}

async function provisionCredits(
  supabase: any,
  userId: string,
  plan: string,
  interval: string,
  subscriptionId: string,
  customerId: string,
  periodEnd: Date,
) {
  const credits = PLAN_CREDITS[plan] || PLAN_CREDITS.starter;
  const now = new Date();

  await supabase.from('user_credits').upsert({
    user_id: userId,
    plan,
    billing_interval: interval,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    subscription_status: 'active',
    current_period_end: periodEnd.toISOString(),
    export_credits_total: credits.export_credits,
    export_credits_used: 0,
    export_credits_reset_at: now.toISOString(),
    ai_credits_total: credits.ai_credits,
    ai_credits_used: 0,
    ai_credits_reset_at: now.toISOString(),
    enterprise_daily_exports: 0,
    enterprise_daily_reset_at: now.toISOString(),
  }, { onConflict: 'user_id' });
}

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
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      throw new Error('Missing stripe-signature header');
    }

    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    logStep(`Processing event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        const metaPlan = session.metadata?.plan;
        const metaInterval = session.metadata?.interval;

        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const priceId = subscription.items.data[0].price.id;
          const productId = subscription.items.data[0].price.product as string;

          const plan = metaPlan || getPlanFromPriceId(priceId) || resolvePlanFromProduct(productId);
          const interval = metaInterval || getBillingInterval(priceId);
          const periodEnd = new Date(subscription.current_period_end * 1000);
          const customerId = session.customer as string;

          logStep('Provisioning credits for checkout', { userId, plan, interval });
          await provisionCredits(supabase, userId, plan, interval, subscription.id, customerId, periodEnd);

          // Also update profiles table for backward compatibility
          await supabase.from('profiles').update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            subscription_tier: plan,
            monthly_credit_limit: PLAN_CREDITS[plan]?.export_credits || 10000,
            credits: PLAN_CREDITS[plan]?.export_credits || 10000,
            credits_used_this_month: 0,
            billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            billing_period_end: periodEnd.toISOString(),
          }).eq('id', userId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;
        const productId = subscription.items.data[0]?.price?.product as string;

        const plan = getPlanFromPriceId(priceId) || resolvePlanFromProduct(productId);
        const interval = getBillingInterval(priceId);
        const periodEnd = new Date(subscription.current_period_end * 1000);

        logStep('Subscription event', { customerId, plan, status: subscription.status });

        // Find user by stripe_customer_id in user_credits
        const { data: creditRow } = await supabase
          .from('user_credits')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        // Fallback: find in profiles
        let userId = creditRow?.user_id || subscription.metadata.supabase_user_id;
        if (!userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();
          userId = profile?.id;
        }

        if (userId) {
          const isActivatable = subscription.status === 'active' || subscription.status === 'trialing';
          const isNewSub = event.type === 'customer.subscription.created';

          if (isActivatable || isNewSub) {
            // Check if this is a new billing period (renewal)
            const { data: existingCredits } = await supabase
              .from('user_credits')
              .select('current_period_end, subscription_status')
              .eq('user_id', userId)
              .single();

            const isNewPeriod = !existingCredits?.current_period_end ||
              new Date(existingCredits.current_period_end) < new Date(subscription.current_period_start * 1000);

            if (isNewSub || isNewPeriod) {
              // For new subs arriving as 'incomplete', provision credits but keep actual status.
              // checkout.session.completed will set status to 'active'.
              // Preserve 'active' if it was already set (handles checkout.session.completed
              // arriving before customer.subscription.created).
              const effectiveStatus = isActivatable
                ? 'active'
                : (existingCredits?.subscription_status === 'active'
                    ? 'active'
                    : subscription.status);
              const credits = PLAN_CREDITS[plan] || PLAN_CREDITS.starter;
              const now = new Date();

              await supabase.from('user_credits').upsert({
                user_id: userId,
                plan,
                billing_interval: interval,
                stripe_subscription_id: subscription.id,
                stripe_customer_id: customerId,
                subscription_status: effectiveStatus,
                current_period_end: periodEnd.toISOString(),
                export_credits_total: credits.export_credits,
                export_credits_used: 0,
                export_credits_reset_at: now.toISOString(),
                ai_credits_total: credits.ai_credits,
                ai_credits_used: 0,
                ai_credits_reset_at: now.toISOString(),
                enterprise_daily_exports: 0,
                enterprise_daily_reset_at: now.toISOString(),
              }, { onConflict: 'user_id' });
            } else {
              // Just update status and period
              await supabase.from('user_credits').update({
                subscription_status: subscription.status,
                current_period_end: periodEnd.toISOString(),
              }).eq('user_id', userId);
            }
          } else if (subscription.status !== 'incomplete') {
            // Don't let 'incomplete' overwrite an 'active' status set by checkout.session.completed
            await supabase.from('user_credits').update({
              subscription_status: subscription.status,
            }).eq('user_id', userId);
          }

          // Backward compat: update profiles
          const profileUpdates: Record<string, any> = {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
            subscription_tier: plan,
            monthly_credit_limit: PLAN_CREDITS[plan]?.export_credits || 10000,
            billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            billing_period_end: periodEnd.toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
          };

          if (event.type === 'customer.subscription.created') {
            profileUpdates.credits_used_this_month = 0;
            profileUpdates.credits = PLAN_CREDITS[plan]?.export_credits || 10000;
          }

          await supabase.from('profiles').update(profileUpdates).eq('id', userId);
          logStep('Updated subscription', { userId, plan, status: subscription.status });
        } else {
          logStep('Could not find user for customer', { customerId });
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const priceId = subscription.items.data[0].price.id;
        const productId = subscription.items.data[0].price.product as string;
        const plan = getPlanFromPriceId(priceId) || resolvePlanFromProduct(productId);
        const interval = getBillingInterval(priceId);
        const customerId = invoice.customer as string;

        // Find user by stripe_customer_id
        const { data: credits } = await supabase
          .from('user_credits')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (credits?.user_id) {
          const periodEnd = new Date(subscription.current_period_end * 1000);
          logStep('Invoice paid — resetting credits', { userId: credits.user_id, plan });
          await provisionCredits(supabase, credits.user_id, plan, interval, subscription.id, customerId, periodEnd);

          // Backward compat
          await supabase.from('profiles').update({
            subscription_status: 'active',
            credits_used_this_month: 0,
            credits: PLAN_CREDITS[plan]?.export_credits || 10000,
          }).eq('id', credits.user_id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        const customerId = invoice.customer as string;
        const { data: credits } = await supabase
          .from('user_credits')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (credits?.user_id) {
          await supabase.from('user_credits').update({
            subscription_status: 'past_due',
          }).eq('user_id', credits.user_id);

          await supabase.from('profiles').update({
            subscription_status: 'past_due',
          }).eq('id', credits.user_id);

          logStep('Payment failed', { userId: credits.user_id });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        logStep('Processing subscription deletion', { subscriptionId: subscription.id, customerId });

        const { data: credits } = await supabase
          .from('user_credits')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        const userId = credits?.user_id || subscription.metadata.supabase_user_id;

        if (userId) {
          await supabase.from('user_credits').update({
            plan: 'none',
            subscription_status: 'canceled',
            export_credits_total: 0,
            ai_credits_total: 0,
          }).eq('user_id', userId);

          // Backward compat
          await supabase.from('profiles').update({
            subscription_status: 'canceled',
            subscription_tier: 'free',
            monthly_credit_limit: 0,
            cancel_at_period_end: false,
            cancel_at: null,
          }).eq('id', userId);

          logStep('Cancelled subscription', { userId });
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
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
