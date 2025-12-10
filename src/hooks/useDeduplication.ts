import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';
import { generateDataHash, hasDataChanged } from '@/lib/dataHash';

interface DeduplicationResult {
  alreadyOwned: Array<{ id: string; data: any }>; // Exact match - 0 credits
  canUpdate: Array<{ id: string; current: any; new: any; changes: string[]; newHash: string }>; // Updated data - 1 credit
  newRecords: Array<{ id: string; data: any; hash: string }>; // New contact - 1 credit
}

export function useDeduplication(entityType: EntityType) {
  const [analyzing, setAnalyzing] = useState(false);

  async function analyzeRecords(
    searchResults: (PersonEntity | CompanyEntity)[]
  ): Promise<DeduplicationResult> {
    setAnalyzing(true);
    
    try {
      // 1. Get team ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        throw new Error('No team membership found');
      }

      // 2. Get all entity_external_ids from search results
      const searchResultIds = searchResults.map(r => r.id);

      // 3. Fetch existing unlocked records from database (includes data_hash if available)
      const { data: unlockedRecords, error: unlockedError } = await supabase
        .from('unlocked_records')
        .select('*')
        .eq('team_id', membership.team_id)
        .eq('entity_type', entityType)
        .in('entity_external_id', searchResultIds);

      if (unlockedError) throw unlockedError;

      // 4. Create a map of unlocked records by entity_external_id
      const unlockedMap = new Map<string, { data: any; hash: string | null }>();
      (unlockedRecords || []).forEach((record: any) => {
        unlockedMap.set(record.entity_external_id, {
          data: record.entity_data,
          hash: record.data_hash || null,
        });
      });

      // 5. Categorize search results
      const alreadyOwned: Array<{ id: string; data: any }> = [];
      const canUpdate: Array<{ id: string; current: any; new: any; changes: string[]; newHash: string }> = [];
      const newRecords: Array<{ id: string; data: any; hash: string }> = [];

      searchResults.forEach(searchResult => {
        const unlocked = unlockedMap.get(searchResult.id);
        const newHash = generateDataHash(searchResult, entityType);

        if (!unlocked) {
          // Not in database - brand new record (costs 1 credit)
          newRecords.push({ id: searchResult.id, data: searchResult, hash: newHash });
        } else {
          // Already unlocked - check if data changed using hash
          if (hasDataChanged(unlocked.hash, newHash)) {
            // Data has changed - costs 1 credit
            const changes = detectChanges(unlocked.data, searchResult);
            canUpdate.push({
              id: searchResult.id,
              current: unlocked.data,
              new: searchResult,
              changes,
              newHash,
            });
          } else {
            // Exact match - 0 credits
            alreadyOwned.push({ id: searchResult.id, data: searchResult });
          }
        }
      });

      return { alreadyOwned, canUpdate, newRecords };
    } catch (error) {
      console.error('Error analyzing records:', error);
      // On error, treat all as new to avoid blocking the user
      return {
        alreadyOwned: [],
        canUpdate: [],
        newRecords: searchResults.map(r => ({ 
          id: r.id, 
          data: r, 
          hash: generateDataHash(r, entityType),
        })),
      };
    } finally {
      setAnalyzing(false);
    }
  }

  function detectChanges(current: any, incoming: any): string[] {
    const changes: string[] = [];
    
    // Key fields to check for both person and company entities
    const keyFields = entityType === 'person'
      ? ['email', 'phone', 'title', 'linkedin', 'company', 'firstName', 'lastName', 'department', 'seniority', 'businessEmail', 'directNumber']
      : ['domain', 'linkedin', 'phone', 'industry', 'employeeCount', 'revenue', 'fundingStage'];

    keyFields.forEach(field => {
      const currentVal = normalizeValue(current[field]);
      const incomingVal = normalizeValue(incoming[field]);
      
      if (currentVal !== incomingVal) {
        // Special case: if current was null/empty and now has value, that's an update
        // Or if value changed
        if ((currentVal === null && incomingVal !== null) || 
            (currentVal !== null && incomingVal !== null && currentVal !== incomingVal)) {
          changes.push(field);
        }
      }
    });

    return changes;
  }

  function normalizeValue(value: any): any {
    // Normalize null, undefined, empty string to null for comparison
    if (value === undefined || value === '' || value === null) {
      return null;
    }
    
    // Normalize strings: trim and lowercase for comparison
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    
    return value;
  }

  return {
    analyzeRecords,
    analyzing,
  };
}
