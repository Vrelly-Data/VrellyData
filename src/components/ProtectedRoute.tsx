import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const SUBSCRIPTION_EXEMPT_PATHS = ['/choose-plan', '/settings', '/billing'];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, isAdmin, fetchProfile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // True only while we're doing the one-time checkout verification
  const [isVerifying, setIsVerifying] = useState(() => searchParams.get('checkout') === 'success');
  const verifyStartedRef = useRef(false);

  // One-time checkout verification — runs once when user is available
  useEffect(() => {
    if (!isVerifying) return;
    if (!user || loading) return;
    if (verifyStartedRef.current) return;

    verifyStartedRef.current = true;

    // Clean the URL immediately
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('checkout');
    setSearchParams(newParams, { replace: true });

    // Call check-subscription + re-fetch profile, then release the gate
    const verify = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await supabase.functions.invoke('check-subscription', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          await fetchProfile();
        }
      } catch {
        // Silent — proceed regardless
      }

      const currentProfile = useAuthStore.getState().profile;
      if (currentProfile?.subscription_status === 'active') {
        toast.success('Payment confirmed! Welcome to Vrelly — your credits are ready.');
      }

      setIsVerifying(false);
    };

    verify();
  }, [isVerifying, user, loading]);

  // Auth + subscription guard — only runs when not verifying
  useEffect(() => {
    if (isVerifying) return;
    if (loading) return;

    if (!user) {
      navigate('/auth');
      return;
    }

    if (!profileLoading && profile) {
      if (isAdmin()) return;
      const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
      if (!isExempt && profile.subscription_status !== 'active') {
        navigate('/choose-plan');
      }
    }
  }, [isVerifying, user, loading, profile, profileLoading, navigate, location.pathname]);

  // Show spinner only during initial auth load or initial profile load
  if (loading || (profileLoading && !profile)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        {isVerifying && (
          <p className="text-muted-foreground text-sm">Verifying your payment...</p>
        )}
      </div>
    );
  }

  if (!user) return null;

  // While verifying (after auth loaded), show a simple spinner instead of the dashboard
  // This prevents the subscription guard from kicking in with a stale inactive profile
  if (isVerifying) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Verifying your payment...</p>
      </div>
    );
  }

  return <>{children}</>;
}
