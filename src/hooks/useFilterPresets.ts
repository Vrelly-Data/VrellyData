import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { FilterBuilderState } from '@/lib/filterConversion';

interface FilterPreset {
  id: string;
  name: string;
  filters: FilterBuilderState;
  created_at: string;
}

export function useFilterPresets(entityType: 'person' | 'company') {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchPresets = async () => {
    try {
      setLoading(true);
      
      // Get user's team_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) return;

      const { data, error } = await supabase
        .from('filter_presets')
        .select('*')
        .eq('team_id', membership.team_id)
        .eq('type', entityType)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPresets(data?.map(p => ({
        id: p.id,
        name: p.name,
        filters: p.filters as unknown as FilterBuilderState,
        created_at: p.created_at,
      })) || []);
    } catch (error) {
      console.error('Error fetching presets:', error);
    } finally {
      setLoading(false);
    }
  };

  const savePreset = async (name: string, filters: FilterBuilderState): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: 'Error',
          description: 'You must be logged in to save presets',
          variant: 'destructive',
        });
        return false;
      }

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        toast({
          title: 'Error',
          description: 'Team not found',
          variant: 'destructive',
        });
        return false;
      }

      const { error } = await supabase
        .from('filter_presets')
        .insert([{
          team_id: membership.team_id,
          type: entityType,
          name,
          filters: JSON.parse(JSON.stringify(filters)),
        }]);

      if (error) throw error;

      toast({
        title: 'Search saved',
        description: `"${name}" has been saved`,
      });

      await fetchPresets();
      return true;
    } catch (error) {
      console.error('Error saving preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to save search',
        variant: 'destructive',
      });
      return false;
    }
  };

  const deletePreset = async (id: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('filter_presets')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Search deleted',
        description: 'Saved search has been removed',
      });

      setPresets(prev => prev.filter(p => p.id !== id));
      return true;
    } catch (error) {
      console.error('Error deleting preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete search',
        variant: 'destructive',
      });
      return false;
    }
  };

  useEffect(() => {
    fetchPresets();
  }, [entityType]);

  return {
    presets,
    loading,
    savePreset,
    deletePreset,
    refetch: fetchPresets,
  };
}
