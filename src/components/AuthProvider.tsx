import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setSession, setLoading, fetchProfile } = useAuthStore();
  const profileFetchedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        // Fetch profile when user signs in
        if (session?.user && !profileFetchedRef.current) {
          profileFetchedRef.current = true;
          try {
            // Small delay to ensure session token is ready
            await new Promise(resolve => setTimeout(resolve, 100));
            await fetchProfile();
          } catch (error) {
            console.error('Profile fetch error:', error);
          }
        }
        
        if (!session?.user) {
          profileFetchedRef.current = false;
        }
        
        // Always set loading to false after auth state change is processed
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!mounted) return;
      
      if (error) {
        console.error('Session error:', error);
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user && !profileFetchedRef.current) {
        profileFetchedRef.current = true;
        try {
          await fetchProfile();
        } catch (error) {
          console.error('Profile fetch error:', error);
        }
      }
      setLoading(false);
    }).catch((err) => {
      console.error('Auth check failed:', err);
      if (mounted) {
        setSession(null);
        setUser(null);
        setLoading(false);
      }
    });

    // Safety timeout - if still loading after 10 seconds, force stop
    const timeout = setTimeout(() => {
      if (mounted) {
        setLoading(false);
      }
    }, 10000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [setUser, setSession, setLoading, fetchProfile]);

  return <>{children}</>;
}
