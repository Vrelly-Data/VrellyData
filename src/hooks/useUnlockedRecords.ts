import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';

interface UnlockableEntity {
  id: string;
  email?: string;
  linkedin?: string;
  domain?: string;
}

export function useUnlockedRecords(entityType: EntityType) {
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [unlockedEmails, setUnlockedEmails] = useState<Set<string>>(new Set());
  const [unlockedLinkedins, setUnlockedLinkedins] = useState<Set<string>>(new Set());
  const [unlockedDomains, setUnlockedDomains] = useState<Set<string>>(new Set());
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
        .select('entity_external_id, entity_data')
        .eq('team_id', membership.team_id)
        .eq('entity_type', entityType);

      if (error) throw error;

      // Build lookup sets for ID, email, linkedin, and domain
      const idSet = new Set<string>();
      const emailSet = new Set<string>();
      const linkedinSet = new Set<string>();
      const domainSet = new Set<string>();

      data?.forEach(r => {
        idSet.add(r.entity_external_id);
        
        const entityData = r.entity_data as Record<string, any>;
        if (entityData?.email) {
          emailSet.add(entityData.email.toLowerCase());
        }
        if (entityData?.linkedin) {
          linkedinSet.add(entityData.linkedin.toLowerCase());
        }
        if (entityData?.domain) {
          domainSet.add(entityData.domain.toLowerCase());
        }
      });

      setUnlockedIds(idSet);
      setUnlockedEmails(emailSet);
      setUnlockedLinkedins(linkedinSet);
      setUnlockedDomains(domainSet);
    } catch (error) {
      console.error('Error loading unlocked records:', error);
    } finally {
      setLoading(false);
    }
  }

  const isUnlocked = useCallback((entity: UnlockableEntity): boolean => {
    // Match by ID first
    if (unlockedIds.has(entity.id)) return true;
    
    // Fallback to email matching (for person entities)
    if (entity.email && unlockedEmails.has(entity.email.toLowerCase())) return true;
    
    // Fallback to LinkedIn matching
    if (entity.linkedin && unlockedLinkedins.has(entity.linkedin.toLowerCase())) return true;
    
    // Fallback to domain matching (for company entities)
    if (entity.domain && unlockedDomains.has(entity.domain.toLowerCase())) return true;
    
    return false;
  }, [unlockedIds, unlockedEmails, unlockedLinkedins, unlockedDomains]);

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

      // Update local state with new IDs and identifiers
      setUnlockedIds(prev => {
        const newSet = new Set(prev);
        entityIds.forEach(id => newSet.add(id));
        return newSet;
      });

      // Also update email/linkedin/domain sets
      setUnlockedEmails(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          if (data?.email) newSet.add(data.email.toLowerCase());
        });
        return newSet;
      });

      setUnlockedLinkedins(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          if (data?.linkedin) newSet.add(data.linkedin.toLowerCase());
        });
        return newSet;
      });

      setUnlockedDomains(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          if (data?.domain) newSet.add(data.domain.toLowerCase());
        });
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
