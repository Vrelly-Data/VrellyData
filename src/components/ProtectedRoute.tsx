import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

const SUBSCRIPTION_EXEMPT_PATHS = ['/choose-plan', '/settings', '/billing'];
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15; // 30 seconds total

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, isAdmin, fetchProfile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [waitingForWebhook, setWaitingForWebhook] = useState(false);
  const pollCount = useRef(0);

  const isPostCheckout = searchParams.get('checkout') === 'success';

  // Poll for subscription activation after Stripe checkout
  useEffect(() => {
    if (!isPostCheckout || !user) return;
    if (profile?.subscription_status === 'active') {
      setWaitingForWebhook(false);
      return;
    }

    setWaitingForWebhook(true);
    pollCount.current = 0;

    const interval = setInterval(async () => {
      pollCount.current += 1;
      await fetchProfile(user.id);

      if (pollCount.current >= MAX_POLL_ATTEMPTS) {
        clearInterval(interval);
        setWaitingForWebhook(false);
        // Strip the query param so the normal redirect logic kicks in
        setSearchParams({});
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isPostCheckout, user]);

  // Stop polling once subscription becomes active
  useEffect(() => {
    if (isPostCheckout && profile?.subscription_status === 'active') {
      setWaitingForWebhook(false);
      // Clean up the query param
      setSearchParams({});
    }
  }, [profile?.subscription_status]);

  useEffect(() => {
    if (loading || waitingForWebhook) return;

    if (!user) {
      navigate('/auth');
      return;
    }

    if (!profileLoading && profile) {
      if (isAdmin()) return;
      const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
      if (!isExempt && !isPostCheckout && profile.subscription_status !== 'active') {
        navigate('/choose-plan');
      }
    }
  }, [user, loading, profile, profileLoading, navigate, location.pathname, waitingForWebhook]);

  if (loading || (profileLoading && !profile) || waitingForWebhook) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        {waitingForWebhook && (
          <p className="text-muted-foreground text-sm">Activating your subscription...</p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
