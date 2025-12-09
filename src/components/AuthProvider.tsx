import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setSession, setLoading, fetchProfile } = useAuthStore();
  const profileFetchedRef = useRef(false);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Fetch profile when user signs in
        if (session?.user && !profileFetchedRef.current) {
          profileFetchedRef.current = true;
          // Small delay to ensure session token is ready
          await new Promise(resolve => setTimeout(resolve, 100));
          await fetchProfile();
        }
        
        if (!session?.user) {
          profileFetchedRef.current = false;
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user && !profileFetchedRef.current) {
        profileFetchedRef.current = true;
        await fetchProfile();
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [setUser, setSession, setLoading, fetchProfile]);

  return <>{children}</>;
}
