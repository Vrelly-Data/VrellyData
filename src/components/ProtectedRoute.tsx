import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

const SUBSCRIPTION_EXEMPT_PATHS = ['/choose-plan', '/settings', '/billing'];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, isAdmin, fetchProfile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkoutPolling, setCheckoutPolling] = useState(false);
  const pollCountRef = useRef(0);

  // Handle checkout=success polling
  useEffect(() => {
    if (!user || loading || profileLoading) return;
    if (searchParams.get('checkout') !== 'success') return;

    // If subscription is already active, clear param and proceed
    if (profile?.subscription_status === 'active') {
      searchParams.delete('checkout');
      setSearchParams(searchParams, { replace: true });
      return;
    }

    // Start polling
    if (!checkoutPolling) {
      setCheckoutPolling(true);
      pollCountRef.current = 0;
    }
  }, [user, loading, profileLoading, searchParams, profile]);

  useEffect(() => {
    if (!checkoutPolling) return;

    const interval = setInterval(async () => {
      pollCountRef.current += 1;
      await fetchProfile();

      const currentProfile = useAuthStore.getState().profile;
      if (currentProfile?.subscription_status === 'active' || pollCountRef.current >= 5) {
        clearInterval(interval);
        setCheckoutPolling(false);
        searchParams.delete('checkout');
        setSearchParams(searchParams, { replace: true });

        if (currentProfile?.subscription_status !== 'active') {
          navigate('/choose-plan');
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [checkoutPolling]);

  useEffect(() => {
    if (checkoutPolling) return; // Don't redirect while polling

    if (!loading && !user) {
      navigate('/auth');
      return;
    }

    // Wait for profile to load before checking subscription
    if (!loading && user && !profileLoading && profile) {
      // Admins bypass subscription check entirely
      if (isAdmin()) return;
      const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
      if (!isExempt && profile.subscription_status !== 'active') {
        navigate('/choose-plan');
      }
    }
  }, [user, loading, profile, profileLoading, navigate, location.pathname, checkoutPolling]);

  if (loading || profileLoading || checkoutPolling) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        {checkoutPolling && (
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
