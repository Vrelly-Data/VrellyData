import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { SUBSCRIPTION_TIERS, PRICE_IDS } from '@/config/subscriptionTiers';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuthStore } from '@/stores/authStore';

const plans = [
  {
    key: 'starter' as const,
    features: ['10,000 monthly credits', 'Full data access', 'CSV exports', 'Email support'],
  },
  {
    key: 'professional' as const,
    features: ['25,000 monthly credits', 'Full data access', 'CSV exports', 'Priority support', 'API access'],
    popular: true,
  },
  {
    key: 'enterprise' as const,
    features: ['75,000 monthly credits', 'Full data access', 'CSV exports', 'Dedicated support', 'API access', 'Custom integrations'],
  },
];

export default function ChoosePlan() {
  const { createCheckoutSession } = useSubscription();
  const { signOut, profile } = useAuthStore();
  const navigate = useNavigate();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  // If subscription is already active, redirect to dashboard
  useEffect(() => {
    if (profile?.subscription_status === 'active') {
      navigate('/dashboard');
    }
  }, [profile, navigate]);

  const handleSubscribe = async (tierKey: 'starter' | 'professional' | 'enterprise') => {
    setLoadingPlan(tierKey);
    try {
      await createCheckoutSession(PRICE_IDS[tierKey]);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="text-center mb-10 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Choose your plan
        </h1>
        <p className="text-muted-foreground text-lg">
          {profile?.name ? `Welcome, ${profile.name}! ` : ''}Select a plan to get started with Vrelly.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        {plans.map(({ key, features, popular }) => {
          const tier = SUBSCRIPTION_TIERS[key];
          return (
            <Card
              key={key}
              className={`relative flex flex-col ${popular ? 'border-primary shadow-lg scale-[1.02]' : ''}`}
            >
              {popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <CardHeader className="text-center">
                <CardTitle className="text-xl">{tier.label}</CardTitle>
                <CardDescription>{tier.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-foreground">${tier.price}</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                      <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={popular ? 'default' : 'outline'}
                  onClick={() => handleSubscribe(key)}
                  disabled={loadingPlan !== null}
                >
                  {loadingPlan === key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Subscribe'
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Button
        variant="ghost"
        className="mt-8 text-muted-foreground"
        onClick={() => signOut()}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Sign out
      </Button>
    </div>
  );
}
