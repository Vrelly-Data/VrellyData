import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, LogOut, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PLANS } from '@/data/plans';
import { useSubscriptionActions } from '@/hooks/useSubscription';
import { useAuthStore } from '@/stores/authStore';

export default function ChoosePlan() {
  const { createCheckoutSession } = useSubscriptionActions();
  const { signOut, profile } = useAuthStore();
  const navigate = useNavigate();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);

  // If subscription is already active, redirect to dashboard
  useEffect(() => {
    if (profile?.subscription_status === 'active') {
      navigate('/dashboard');
    }
  }, [profile, navigate]);

  const handleSubscribe = async (planId: string) => {
    setLoadingPlan(planId);
    try {
      await createCheckoutSession(planId, isAnnual ? 'annual' : 'monthly');
    } finally {
      setLoadingPlan(null);
    }
  };

  const cancelAt = profile?.cancel_at;
  const isCanceling = profile?.cancel_at_period_end && profile?.subscription_status === 'active';

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="text-center mb-10 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Choose your plan
        </h1>
        <p className="text-muted-foreground text-lg mb-6">
          {profile?.name ? `Welcome, ${profile.name}! ` : ''}Select a plan to get started with Vrelly.
        </p>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3">
          <span className={`text-sm font-medium ${!isAnnual ? 'text-foreground' : 'text-muted-foreground'}`}>
            Monthly
          </span>
          <button
            onClick={() => setIsAnnual(!isAnnual)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isAnnual ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isAnnual ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className={`text-sm font-medium ${isAnnual ? 'text-foreground' : 'text-muted-foreground'}`}>
            Annual
          </span>
          {isAnnual && (
            <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">
              Save 17%
            </Badge>
          )}
        </div>
      </div>

      {isCanceling && cancelAt && (
        <Alert className="max-w-5xl w-full mb-6 border-destructive/50 bg-destructive/10">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-destructive">
            Your subscription has been cancelled and will end on{' '}
            <strong>{new Date(cancelAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
            You'll lose access after that date. You can reactivate anytime before then.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        {PLANS.map((plan) => {
          const price = isAnnual ? plan.annualPrice : plan.monthlyPrice;
          const isPopular = plan.popular;

          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${isPopular ? 'border-primary shadow-lg scale-[1.02]' : ''}`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <CardHeader className="text-center">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription>
                  {plan.id === 'starter' ? 'For growing teams' : plan.id === 'professional' ? 'For scaling businesses' : 'For large organizations'}
                </CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-foreground">${price}</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                {isAnnual && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Billed annually (${plan.annualTotal}/yr)
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {plan.features.map((f) => (
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
                  variant={isPopular ? 'default' : 'outline'}
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={loadingPlan !== null}
                >
                  {loadingPlan === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    plan.cta
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
