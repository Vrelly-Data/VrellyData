export const SUBSCRIPTION_TIERS = {
  starter: {
    credits: 10000,
    aiCredits: 50,
    price: 75,
    annualPrice: 62,       // per month, billed annually ($749/yr)
    annualTotal: 749,
    label: 'Starter',
    description: 'For growing teams',
  },
  professional: {
    credits: 25000,
    aiCredits: 250,
    price: 150,
    annualPrice: 125,
    annualTotal: 1499,
    label: 'Professional',
    description: 'For scaling businesses',
  },
  enterprise: {
    credits: 100000,       // daily backend cap; frontend shows "Unlimited"
    aiCredits: 1250,
    price: 350,
    annualPrice: 292,
    annualTotal: 3499,
    label: 'Enterprise',
    description: 'For large organizations',
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// Stripe Price IDs for each tier — monthly
export const PRICE_IDS = {
  starter: 'price_1SPYhwRvAXonKS41WFHowijk',
  professional: 'price_1SPYjHRvAXonKS41B0eriTUC',
  enterprise: 'price_1SPYjTRvAXonKS41RdJr9r7I',
} as const;

// Stripe Price IDs — annual (populated after running scripts/create-annual-prices.mjs)
export const ANNUAL_PRICE_IDS = {
  starter: 'price_1T9TqvRvAXonKS41LFgEf983',
  professional: 'price_1T9TqwRvAXonKS41vRpnp2xU',
  enterprise: 'price_1T9TqwRvAXonKS41G4SCT11j',
} as const;

// Stripe Product IDs for tier mapping
export const PRODUCT_IDS = {
  starter: 'prod_TMHGcnFjx5n8DZ',
  professional: 'prod_TMHHjUdtt2Xbdl',
  enterprise: 'prod_TMHItV1NP0yBYU',
} as const;
