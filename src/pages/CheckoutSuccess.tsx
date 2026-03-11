import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function CheckoutSuccess() {
  const navigate = useNavigate();
  const { fetchProfile } = useAuthStore();
  const queryClient = useQueryClient();

  useEffect(() => {
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
        // proceed regardless
      }
      // Invalidate user-credits cache so billing page shows fresh data
      queryClient.invalidateQueries({ queryKey: ['user-credits'] });
      toast.success('Subscription activated! Your credits are ready.');
      navigate('/dashboard', { replace: true });
    };
    verify();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-muted-foreground text-sm">Verifying your payment...</p>
    </div>
  );
}
