import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function main() {
  // --- Create Products ---
  const starterProduct = await stripe.products.create({
    name: 'Vrelly Starter',
  });

  const professionalProduct = await stripe.products.create({
    name: 'Vrelly Professional',
  });

  const enterpriseProduct = await stripe.products.create({
    name: 'Vrelly Enterprise',
  });

  const agentProduct = await stripe.products.create({
    name: 'Vrelly Agent',
  });

  // --- Create Prices ---

  // Starter
  const starterMonthly = await stripe.prices.create({
    product: starterProduct.id,
    unit_amount: 7500,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Starter Monthly',
  });

  const starterAnnual = await stripe.prices.create({
    product: starterProduct.id,
    unit_amount: 74900,
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Starter Annual',
  });

  // Professional
  const professionalMonthly = await stripe.prices.create({
    product: professionalProduct.id,
    unit_amount: 15000,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Professional Monthly',
  });

  const professionalAnnual = await stripe.prices.create({
    product: professionalProduct.id,
    unit_amount: 149900,
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Professional Annual',
  });

  // Enterprise
  const enterpriseMonthly = await stripe.prices.create({
    product: enterpriseProduct.id,
    unit_amount: 35000,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Enterprise Monthly',
  });

  const enterpriseAnnual = await stripe.prices.create({
    product: enterpriseProduct.id,
    unit_amount: 349900,
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Enterprise Annual',
  });

  // Agent
  const agentMonthly = await stripe.prices.create({
    product: agentProduct.id,
    unit_amount: 250000,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Agent Monthly',
  });

  const agentAnnual = await stripe.prices.create({
    product: agentProduct.id,
    unit_amount: 2500000,
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Agent Annual',
  });

  // --- Summary ---
  console.log('=== COPY THESE INTO subscriptionTiers.ts ===');
  console.log('');
  console.log('Starter product:', starterProduct.id);
  console.log('Starter monthly price:', starterMonthly.id);
  console.log('Starter annual price:', starterAnnual.id);
  console.log('');
  console.log('Professional product:', professionalProduct.id);
  console.log('Professional monthly price:', professionalMonthly.id);
  console.log('Professional annual price:', professionalAnnual.id);
  console.log('');
  console.log('Enterprise product:', enterpriseProduct.id);
  console.log('Enterprise monthly price:', enterpriseMonthly.id);
  console.log('Enterprise annual price:', enterpriseAnnual.id);
  console.log('');
  console.log('Agent product:', agentProduct.id);
  console.log('Agent monthly price:', agentMonthly.id);
  console.log('Agent annual price:', agentAnnual.id);
}

main();
