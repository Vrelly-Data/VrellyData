import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  name: string | null;
  credits: number;
  plan: string;
  subscription_tier: string;
  subscription_status: string | null;
  monthly_credit_limit: number;
  credits_used_this_month: number;
  billing_period_start: string | null;
  billing_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean | null;
  cancel_at: string | null;
}

interface UserRole {
  team_id: string;
  role: 'admin' | 'member';
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  userRoles: UserRole[];
  isPlatformAdmin: boolean;
  loading: boolean;
  profileLoading: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setUserRoles: (roles: UserRole[]) => void;
  setLoading: (loading: boolean) => void;
  setProfileLoading: (loading: boolean) => void;
  signOut: () => Promise<void>;
  fetchProfile: (userId?: string) => Promise<void>;
  isAdmin: (teamId?: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  userRoles: [],
  isPlatformAdmin: false,
  loading: true,
  profileLoading: false,
  
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setUserRoles: (roles) => set({ userRoles: roles }),
  setLoading: (loading) => set({ loading }),
  setProfileLoading: (loading) => set({ profileLoading: loading }),
  
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, profile: null, userRoles: [], isPlatformAdmin: false, profileLoading: false });
  },
  
  fetchProfile: async (userId?: string) => {
    const { user } = get();
    const effectiveUserId = userId || user?.id;
    
    if (!effectiveUserId) {
      set({ profile: null, userRoles: [], isPlatformAdmin: false, profileLoading: false });
      return;
    }

    set({ profileLoading: true });

    // Fetch profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', effectiveUserId)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
    } else if (profileData) {
      set({ profile: profileData as Profile });
    }

    // Fetch user roles
    const { data: rolesData, error: rolesError } = await supabase
      .from('user_roles')
      .select('team_id, role')
      .eq('user_id', effectiveUserId);

    if (rolesError) {
      console.error('Error fetching user roles:', rolesError);
      set({ profileLoading: false });
    } else if (rolesData) {
      set({ userRoles: rolesData as UserRole[] });
    }

    // Fetch platform admin status
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', effectiveUserId)
      .single();

    set({ isPlatformAdmin: profileRow?.is_platform_admin ?? false, profileLoading: false });
  },

  isAdmin: (teamId?: string) => {
    const { userRoles } = get();
    if (!teamId) {
      // Check if admin in any team
      return userRoles.some(r => r.role === 'admin');
    }
    return userRoles.some(r => r.team_id === teamId && r.role === 'admin');
  },
}));
