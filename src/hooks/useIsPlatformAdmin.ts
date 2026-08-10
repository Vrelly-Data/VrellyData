import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Is the signed-in user a platform admin?
//
// Reads profiles.is_platform_admin — the SAME flag the admin-side RLS policies
// on client_analysis_snapshots use, so what the UI offers and what the database
// permits cannot disagree. Deliberately NOT is_super_admin, which gates the
// organizations table and is a different (smaller) population.
//
// This is a UI affordance only. The database is the real boundary: an admin
// action stays blocked by RLS regardless of what this returns, and a false
// negative here just hides a button.
export function useIsPlatformAdmin() {
  const { data, isLoading } = useQuery({
    queryKey: ['is-platform-admin'],
    queryFn: async (): Promise<boolean> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('is_platform_admin')
        .eq('id', user.id)
        .maybeSingle();
      // A missing profile row or a read error means "not an admin" — fail
      // closed, since the only cost is a hidden button.
      if (error) return false;
      return profile?.is_platform_admin === true;
    },
    staleTime: 5 * 60_000,
  });
  return { isPlatformAdmin: data === true, isLoading };
}
