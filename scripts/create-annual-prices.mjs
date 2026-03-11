import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Product IDs (from src/config/subscriptionTiers.ts)
const PRODUCTS = {
  starter:      'prod_TMHGcnFjx5n8DZ',
  professional: 'prod_TMHHjUdtt2Xbdl',
  enterprise:   'prod_TMHItV1NP0yBYU',
};

async function main() {
  const starterAnnual = await stripe.prices.create({
    product: PRODUCTS.starter,
    unit_amount: 74900,         // $749.00
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Starter Annual',
  });

  const professionalAnnual = await stripe.prices.create({
    product: PRODUCTS.professional,
    unit_amount: 149900,        // $1,499.00
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Professional Annual',
  });

  const enterpriseAnnual = await stripe.prices.create({
    product: PRODUCTS.enterprise,
    unit_amount: 349900,        // $3,499.00
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Enterprise Annual',
  });

  console.log('Starter Annual price ID:', starterAnnual.id);
  console.log('Professional Annual price ID:', professionalAnnual.id);
  console.log('Enterprise Annual price ID:', enterpriseAnnual.id);
  console.log('\nSave these IDs — you will need them for the next tasks.');
}

main();
