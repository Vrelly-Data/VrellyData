export const SUBSCRIPTION_TIERS = {
  starter: {
    credits: 10000,
    aiCredits: 50,
    price: 75,
    annualPrice: 62,       // per month, billed annually ($749/yr)
    annualTotal: 749,
    label: 'Starter',
    description: 'For growing teams',
    isAgentTier: false,
  },
  professional: {
    credits: 25000,
    aiCredits: 250,
    price: 150,
    annualPrice: 125,
    annualTotal: 1499,
    label: 'Professional',
    description: 'For scaling businesses',
    isAgentTier: false,
  },
  enterprise: {
    credits: 100000,       // daily backend cap; frontend shows "Unlimited"
    aiCredits: 1250,
    price: 350,
    annualPrice: 292,
    annualTotal: 3499,
    label: 'Enterprise',
    description: 'For large organizations',
    isAgentTier: false,
  },
  agent: {
    credits: 100000,
    aiCredits: 5000,
    price: 2500,
    annualPrice: 2083,
    annualTotal: 25000,
    label: 'Agent',
    description: 'Fully managed AI outbound agent',
    isAgentTier: true,
    features: [
      'Everything in Enterprise',
      'Dedicated AI outbound agent',
      'Weekly automated audience + campaign generation',
      'AI-powered reply handling',
      'LinkedIn co-pilot inbox',
      'Pipeline management',
    ],
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// Stripe Price IDs for each tier — monthly
export const PRICE_IDS = {
  starter: 'price_1SPYhwRvAXonKS41WFHowijk',
  professional: 'price_1SPYjHRvAXonKS41B0eriTUC',
  enterprise: 'price_1SPYjTRvAXonKS41RdJr9r7I',
  agent: 'AGENT_MONTHLY_PRICE_ID',  // placeholder
} as const;

// Stripe Price IDs — annual (populated after running scripts/create-annual-prices.mjs)
export const ANNUAL_PRICE_IDS = {
  starter: 'price_1T9TqvRvAXonKS41LFgEf983',
  professional: 'price_1T9TqwRvAXonKS41vRpnp2xU',
  enterprise: 'price_1T9TqwRvAXonKS41G4SCT11j',
  agent: 'AGENT_ANNUAL_PRICE_ID',   // placeholder
} as const;

// Stripe Product IDs for tier mapping
export const PRODUCT_IDS = {
  starter: 'prod_TMHGcnFjx5n8DZ',
  professional: 'prod_TMHHjUdtt2Xbdl',
  enterprise: 'prod_TMHItV1NP0yBYU',
  agent: 'AGENT_PRODUCT_ID',        // placeholder
} as const;
