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

// NOTE: Runtime Stripe price IDs are sourced from Supabase project secrets
// (STRIPE_PRICE_STARTER_MONTHLY, …) read by the create-checkout edge function,
// NOT from this file. The hardcoded PRICE_IDS / ANNUAL_PRICE_IDS exports that
// used to live here were dead code (zero importers) and caused diagnostic
// confusion during the 2026-05-29 prod payment incident. See VRELLY-INFRA.md
// § "Stripe Price IDs" for current values and the secrets-vs-code drift note.
