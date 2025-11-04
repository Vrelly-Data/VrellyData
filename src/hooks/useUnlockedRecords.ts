import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EntityType } from '@/types/audience';

export function useUnlockedRecords(entityType: EntityType) {
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUnlockedRecords();
  }, [entityType]);

  async function loadUnlockedRecords() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's team
      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) return;

      const { data, error } = await supabase
        .from('unlocked_records')
        .select('entity_external_id')
        .eq('team_id', membership.team_id)
        .eq('entity_type', entityType);

      if (error) throw error;

      const ids = new Set(data?.map(r => r.entity_external_id) || []);
      setUnlockedIds(ids);
    } catch (error) {
      console.error('Error loading unlocked records:', error);
    } finally {
      setLoading(false);
    }
  }

  function isUnlocked(entityId: string): boolean {
    return unlockedIds.has(entityId);
  }

  async function markAsUnlocked(entityIds: string[], entityData: any[]) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team membership found');

      const records = entityIds.map((id, index) => ({
        user_id: user.id,
        team_id: membership.team_id,
        entity_type: entityType,
        entity_external_id: id,
        entity_data: entityData[index],
      }));

      const { error } = await supabase
        .from('unlocked_records')
        .upsert(records, { 
          onConflict: 'team_id,entity_external_id,entity_type',
          ignoreDuplicates: true 
        });

      if (error) throw error;

      // Update local state
      setUnlockedIds(prev => {
        const newSet = new Set(prev);
        entityIds.forEach(id => newSet.add(id));
        return newSet;
      });

      return { success: true };
    } catch (error) {
      console.error('Error marking records as unlocked:', error);
      return { success: false, error };
    }
  }

  return {
    unlockedIds,
    isUnlocked,
    markAsUnlocked,
    loading,
    refetch: loadUnlockedRecords,
  };
}
