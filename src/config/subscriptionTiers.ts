export const SUBSCRIPTION_TIERS = {
  free: { 
    credits: 100, 
    price: 0, 
    label: 'Free',
    description: 'Get started with basic access'
  },
  starter: { 
    credits: 10000, 
    price: 99, 
    label: 'Starter',
    description: 'For growing teams'
  },
  pro: { 
    credits: 100000, 
    price: 275, 
    label: 'Pro',
    description: 'For scaling businesses'
  },
  enterprise: { 
    credits: 1000000, 
    price: 600, 
    label: 'Enterprise',
    description: 'For large organizations'
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;
