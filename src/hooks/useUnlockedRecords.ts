import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';

interface UnlockableEntity {
  id: string;
  email?: string;
  linkedin?: string;
  domain?: string;
  name?: string;
  company?: string;
}

// Normalize LinkedIn URL to just the username for matching
function normalizeLinkedin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Extract username from various LinkedIn URL formats
  const match = url.match(/linkedin\.com\/in\/([^\/\?#]+)/i);
  return match ? match[1].toLowerCase() : undefined;
}

// Check if email is masked (contains dots for hidden characters)
function isEmailMasked(email: string | undefined): boolean {
  return !email || email.includes('•');
}

export function useUnlockedRecords(entityType: EntityType) {
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [unlockedEmails, setUnlockedEmails] = useState<Set<string>>(new Set());
  const [unlockedLinkedins, setUnlockedLinkedins] = useState<Set<string>>(new Set());
  const [unlockedDomains, setUnlockedDomains] = useState<Set<string>>(new Set());
  const [unlockedNameCompany, setUnlockedNameCompany] = useState<Set<string>>(new Set());
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

      // Build lookup sets for ID, email, linkedin, domain, and name+company
      const idSet = new Set<string>();
      const emailSet = new Set<string>();
      const linkedinSet = new Set<string>();
      const domainSet = new Set<string>();
      const nameCompanySet = new Set<string>();

      data?.forEach(r => {
        idSet.add(r.entity_external_id);
        
        const entityData = r.entity_data as Record<string, any>;
        
        // Add email if not masked
        if (entityData?.email && !isEmailMasked(entityData.email)) {
          emailSet.add(entityData.email.toLowerCase());
        }
        
        // Add normalized LinkedIn username
        const linkedinUsername = normalizeLinkedin(entityData?.linkedin);
        if (linkedinUsername) {
          linkedinSet.add(linkedinUsername);
        }
        
        // Add domain
        if (entityData?.domain) {
          domainSet.add(entityData.domain.toLowerCase());
        }
        
        // Add name+company combination for fallback matching
        if (entityData?.name && entityData?.company) {
          nameCompanySet.add(`${entityData.name.toLowerCase()}|${entityData.company.toLowerCase()}`);
        }
      });

      setUnlockedIds(idSet);
      setUnlockedEmails(emailSet);
      setUnlockedLinkedins(linkedinSet);
      setUnlockedDomains(domainSet);
      setUnlockedNameCompany(nameCompanySet);
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
    if (entity.email && !isEmailMasked(entity.email) && unlockedEmails.has(entity.email.toLowerCase())) return true;
    
    // Fallback to normalized LinkedIn matching
    const linkedinUsername = normalizeLinkedin(entity.linkedin);
    if (linkedinUsername && unlockedLinkedins.has(linkedinUsername)) return true;
    
    // Fallback to domain matching (for company entities)
    if (entity.domain && unlockedDomains.has(entity.domain.toLowerCase())) return true;
    
    // Fallback to name+company matching
    if (entity.name && entity.company) {
      const key = `${entity.name.toLowerCase()}|${entity.company.toLowerCase()}`;
      if (unlockedNameCompany.has(key)) return true;
    }
    
    return false;
  }, [unlockedIds, unlockedEmails, unlockedLinkedins, unlockedDomains, unlockedNameCompany]);

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

      // Update email set
      setUnlockedEmails(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          if (data?.email && !isEmailMasked(data.email)) {
            newSet.add(data.email.toLowerCase());
          }
        });
        return newSet;
      });

      // Update linkedin set with normalized usernames
      setUnlockedLinkedins(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          const linkedinUsername = normalizeLinkedin(data?.linkedin);
          if (linkedinUsername) {
            newSet.add(linkedinUsername);
          }
        });
        return newSet;
      });

      // Update domains set
      setUnlockedDomains(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          if (data?.domain) newSet.add(data.domain.toLowerCase());
        });
        return newSet;
      });

      // Update name+company set
      setUnlockedNameCompany(prev => {
        const newSet = new Set(prev);
        entityData.forEach(data => {
          if (data?.name && data?.company) {
            newSet.add(`${data.name.toLowerCase()}|${data.company.toLowerCase()}`);
          }
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
