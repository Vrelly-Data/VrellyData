import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const SUBSCRIPTION_EXEMPT_PATHS = ['/choose-plan', '/settings', '/billing'];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, isAdmin, fetchProfile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkoutPolling, setCheckoutPolling] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const pollCountRef = useRef(0);
  const pollingDoneRef = useRef(false);
  const { toast } = useToast();

  const isCheckoutSuccess = searchParams.get('checkout') === 'success';

  // Handle checkout=success polling
  useEffect(() => {
    if (!user || loading || profileLoading) return;
    if (!isCheckoutSuccess) return;
    // If polling already concluded, don't restart
    if (pollingDoneRef.current) return;

    // If subscription is already active, show success and proceed
    if (profile?.subscription_status === 'active') {
      pollingDoneRef.current = true;
      setPaymentSuccess(true);
      searchParams.delete('checkout');
      setSearchParams(searchParams, { replace: true });
      setTimeout(() => {
        setPaymentSuccess(false);
        navigate('/dashboard', { replace: true });
      }, 2000);
      return;
    }

    // Start polling
    if (!checkoutPolling) {
      setCheckoutPolling(true);
      pollCountRef.current = 0;
    }
  }, [user, loading, profileLoading, isCheckoutSuccess, profile]);

  useEffect(() => {
    if (!checkoutPolling) return;

    const interval = setInterval(async () => {
      pollCountRef.current += 1;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await supabase.functions.invoke('check-subscription', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
        }
      } catch (e) {
        // Silent — we'll check the profile next regardless
      }

      await fetchProfile();

      const currentProfile = useAuthStore.getState().profile;
      if (currentProfile?.subscription_status === 'active' || pollCountRef.current >= 8) {
        clearInterval(interval);
        setCheckoutPolling(false);
        pollingDoneRef.current = true;
        searchParams.delete('checkout');
        setSearchParams(searchParams, { replace: true });

        if (currentProfile?.subscription_status === 'active') {
          setPaymentSuccess(true);
          setTimeout(() => {
            setPaymentSuccess(false);
            navigate('/dashboard', { replace: true });
          }, 2000);
        } else {
          toast({
            title: "Couldn't verify payment",
            description: "We couldn't confirm your subscription. Please try again or contact support.",
            variant: 'destructive',
          });
          navigate('/choose-plan', { replace: true });
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [checkoutPolling]);

  useEffect(() => {
    if (checkoutPolling || paymentSuccess) return;
    // If checkout=success is in the URL and polling hasn't concluded yet,
    // give auth time to settle — never redirect to /auth prematurely.
    if (isCheckoutSuccess && !pollingDoneRef.current) return;

    if (!loading && !user) {
      navigate('/auth');
      return;
    }

    if (!loading && user && !profileLoading && profile) {
      if (isAdmin()) return;
      const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
      if (!isExempt && profile.subscription_status !== 'active') {
        navigate('/choose-plan');
      }
    }
  }, [user, loading, profile, profileLoading, navigate, location.pathname, checkoutPolling, paymentSuccess, isCheckoutSuccess]);

  // Payment success screen
  if (paymentSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-3 animate-in fade-in zoom-in duration-500">
          <CheckCircle className="h-16 w-16 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Payment confirmed!</h1>
          <p className="text-muted-foreground text-sm">Welcome to Vrelly — your credits are ready.</p>
        </div>
      </div>
    );
  }

  if (loading || profileLoading || checkoutPolling) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        {(checkoutPolling || (isCheckoutSuccess && !pollingDoneRef.current)) && (
          <p className="text-muted-foreground text-sm">Verifying your payment...</p>
        )}
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
