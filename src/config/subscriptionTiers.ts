export const SUBSCRIPTION_TIERS = {
  starter: {
    credits: 10000, 
    price: 75, 
    label: 'Starter',
    description: 'For growing teams'
  },
  professional: { 
    credits: 25000, 
    price: 150, 
    label: 'Professional',
    description: 'For scaling businesses'
  },
  enterprise: { 
    credits: 75000, 
    price: 350, 
    label: 'Enterprise',
    description: 'For large organizations'
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// Stripe Price IDs for each tier
export const PRICE_IDS = {
  starter: 'price_1SPYhwRvAXonKS41WFHowijk',
  professional: 'price_1SPYjHRvAXonKS41B0eriTUC',
  enterprise: 'price_1SPYjTRvAXonKS41RdJr9r7I',
} as const;

// Stripe Product IDs for tier mapping
export const PRODUCT_IDS = {
  starter: 'prod_TMHGcnFjx5n8DZ',
  professional: 'prod_TMHHjUdtt2Xbdl',
  enterprise: 'prod_TMHItV1NP0yBYU',
} as const;
