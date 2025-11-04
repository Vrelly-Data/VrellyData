import Stripe from 'https://esm.sh/stripe@14.21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProductTier {
  name: string;
  priceMonthly: number;
  credits: number;
  description: string;
}

const TIERS: ProductTier[] = [
  {
    name: 'Starter',
    priceMonthly: 9900, // $99 in cents
    credits: 10000,
    description: '10,000 credits per month - Perfect for small teams',
  },
  {
    name: 'Pro',
    priceMonthly: 29900, // $299 in cents
    credits: 25000,
    description: '25,000 credits per month - For growing businesses',
  },
  {
    name: 'Premium',
    priceMonthly: 49900, // $499 in cents
    credits: 75000,
    description: '75,000 credits per month - For large organizations',
  },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured');
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });

    console.log('Creating Stripe products and prices...');
    const results = [];

    for (const tier of TIERS) {
      // Create product
      const product = await stripe.products.create({
        name: `Audience Lab ${tier.name}`,
        description: tier.description,
        metadata: {
          tier: tier.name.toLowerCase(),
          credits: tier.credits.toString(),
        },
      });

      console.log(`Created product: ${product.id} - ${tier.name}`);

      // Create recurring price
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: tier.priceMonthly,
        currency: 'usd',
        recurring: {
          interval: 'month',
        },
        metadata: {
          tier: tier.name.toLowerCase(),
        },
      });

      console.log(`Created price: ${price.id} - $${tier.priceMonthly / 100}/month`);

      results.push({
        tier: tier.name,
        productId: product.id,
        priceId: price.id,
        amount: tier.priceMonthly,
        credits: tier.credits,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        products: results,
        message: 'Products and prices created successfully',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error creating products:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
