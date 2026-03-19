import { Navigate } from 'react-router-dom';
import { useRequireSubscription } from '@/hooks/useSubscription';
import { Loader2 } from 'lucide-react';

export function SubscriptionGuard({ children }: { children: React.ReactNode }) {
  const { isActive, isLoading } = useRequireSubscription();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isActive) {
    return <Navigate to="/pricing" replace />;
  }

  return <>{children}</>;
}
