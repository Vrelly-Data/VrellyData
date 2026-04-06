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
  starter: 'price_1TJMK2K2suFUahyv6qI9xgH8',
  professional: 'price_1TJMK3K2suFUahyvFqnoDpn5',
  enterprise: 'price_1TJMK3K2suFUahyvlHEyW7oc',
  agent: 'price_1TJMK4K2suFUahyvNqIdkFjZ',
} as const;

// Stripe Price IDs — annual
export const ANNUAL_PRICE_IDS = {
  starter: 'price_1TJMK3K2suFUahyvjsbF0EFL',
  professional: 'price_1TJMK3K2suFUahyv6HUBovHt',
  enterprise: 'price_1TJMK4K2suFUahyvESiFTK02',
  agent: 'price_1TJMK4K2suFUahyvq3MH04v3',
} as const;

// Stripe Product IDs for tier mapping
export const PRODUCT_IDS = {
  starter: 'prod_UHwCqq9qzRM8qR',
  professional: 'prod_UHwCnBo0FKSl54',
  enterprise: 'prod_UHwCQ4tS4rX9fx',
  agent: 'prod_UHwCt3x8a3cLlt',
} as const;
