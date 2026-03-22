import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SavedAudience {
  id: string;
  name: string;
  filters: {
    industries: string[];
    isBtoB: boolean;
    targetTitles: string[];
    companyTypes: string[];
    companySizes: string[];
    locations: string[];
  };
  result_count: number | null;
  created_at: string;
}

export function useSavedAudiences() {
  return useQuery({
    queryKey: ['saved-audiences'],
    queryFn: async (): Promise<SavedAudience[]> => {
      const { data, error } = await supabase
        .from('saved_audiences')
        .select('id, name, filters, result_count, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as SavedAudience[];
    },
  });
}

export function useSaveAudience() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      filters,
      result_count,
    }: {
      name: string;
      filters: SavedAudience['filters'];
      result_count: number | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('saved_audiences')
        .insert({
          user_id: user.id,
          name,
          filters,
          result_count,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-audiences'] });
    },
  });
}

export function useDeleteSavedAudience() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('saved_audiences')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-audiences'] });
    },
  });
}
