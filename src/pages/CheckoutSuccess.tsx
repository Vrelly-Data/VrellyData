import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@/hooks/useSubscription';
import { Loader2 } from 'lucide-react';

const MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1_000;

export default function CheckoutSuccess() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, refetch } = useSubscription();
  const [timedOut, setTimedOut] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    if (data?.subscription_status === 'active') {
      queryClient.invalidateQueries({ queryKey: ['user-credits'] });
      navigate('/dashboard', { replace: true });
      return;
    }

    const interval = setInterval(async () => {
      attempts.current += 1;
      await refetch();

      if (attempts.current >= MAX_ATTEMPTS) {
        clearInterval(interval);
        setTimedOut(true);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [data?.subscription_status]);

  if (timedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-medium">Taking longer than expected</p>
        <p className="text-muted-foreground text-sm">
          Please contact{' '}
          <a href="mailto:support@vrelly.com" className="underline">
            support@vrelly.com
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-muted-foreground text-sm">Setting up your account...</p>
    </div>
  );
}
