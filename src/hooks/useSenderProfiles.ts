import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Cast to any until types are regenerated after the sender_profiles migration
// (same pattern as useAgent.ts).
const db = supabase as any;

export interface SenderProfile {
  id: string;
  user_id: string;
  team_id: string | null;
  sender_name: string;
  job_title: string | null;
  linkedin_url: string | null;
  bio: string | null;
  communication_style: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface SenderProfileInput {
  id?: string;
  sender_name: string;
  job_title?: string | null;
  linkedin_url?: string | null;
  bio?: string | null;
  communication_style?: string | null;
  is_default?: boolean;
}

export function useSenderProfiles() {
  return useQuery<SenderProfile[]>({
    queryKey: ['sender-profiles'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await db
        .from('sender_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as SenderProfile[];
    },
  });
}

export function useUpsertSenderProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SenderProfileInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Enforce a single default per client: clear the flag on the user's other
      // profiles before persisting this one as default. classify-reply's
      // fallback picks the first is_default row, so exclusivity keeps it
      // deterministic.
      if (input.is_default) {
        await db
          .from('sender_profiles')
          .update({ is_default: false })
          .eq('user_id', user.id);
      }

      const row = {
        ...(input.id ? { id: input.id } : {}),
        user_id: user.id,
        sender_name: input.sender_name,
        job_title: input.job_title ?? null,
        linkedin_url: input.linkedin_url ?? null,
        bio: input.bio ?? null,
        communication_style: input.communication_style ?? null,
        is_default: input.is_default ?? false,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await db
        .from('sender_profiles')
        .upsert(row)
        .select()
        .single();
      if (error) throw error;
      return data as SenderProfile;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sender-profiles'] }),
  });
}

export function useDeleteSenderProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('sender_profiles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sender-profiles'] }),
  });
}
