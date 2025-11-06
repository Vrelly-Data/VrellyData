import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';

interface DeduplicationResult {
  alreadyOwned: Array<{ id: string; data: any }>;
  canUpdate: Array<{ id: string; current: any; new: any; changes: string[] }>;
  newRecords: Array<{ id: string; data: any }>;
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

      // 3. Fetch existing records from database
      const tableName = entityType === 'person' ? 'people_records' : 'company_records';
      const { data: existingRecords, error } = await supabase
        .from(tableName)
        .select('entity_external_id, entity_data')
        .eq('team_id', membership.team_id)
        .in('entity_external_id', searchResultIds);

      if (error) throw error;

      // 4. Create a map of existing records by entity_external_id
      const existingMap = new Map<string, any>();
      (existingRecords || []).forEach(record => {
        existingMap.set(record.entity_external_id, record.entity_data);
      });

      // 5. Categorize search results
      const alreadyOwned: Array<{ id: string; data: any }> = [];
      const canUpdate: Array<{ id: string; current: any; new: any; changes: string[] }> = [];
      const newRecords: Array<{ id: string; data: any }> = [];

      searchResults.forEach(searchResult => {
        const existingData = existingMap.get(searchResult.id);

        if (!existingData) {
          // Not in database - brand new record
          newRecords.push({ id: searchResult.id, data: searchResult });
        } else {
          // Already exists - check if data changed
          const changes = detectChanges(existingData, searchResult);
          
          if (changes.length > 0) {
            // Data has changed
            canUpdate.push({
              id: searchResult.id,
              current: existingData,
              new: searchResult,
              changes,
            });
          } else {
            // Exact duplicate
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
        newRecords: searchResults.map(r => ({ id: r.id, data: r })),
      };
    } finally {
      setAnalyzing(false);
    }
  }

  function detectChanges(current: any, incoming: any): string[] {
    const changes: string[] = [];
    
    // Key fields to check for both person and company entities
    const keyFields = entityType === 'person'
      ? ['email', 'phone', 'title', 'linkedin', 'company', 'firstName', 'lastName', 'department', 'seniority']
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
