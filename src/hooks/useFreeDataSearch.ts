import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';
import { FilterBuilderState } from '@/lib/filterConversion';
import { buildFreeDataQuery, mapFreeDataToPerson, mapFreeDataToCompany } from '@/lib/freeDataFilter';

export interface FreeDataSearchParams {
  entityType: EntityType;
  filterState: FilterBuilderState;
  page: number;
  perPage: number;
}

export interface FreeDataSearchResponse<T> {
  items: T[];
  totalEstimate: number;
  pagination: {
    page: number;
    per_page: number;
    total_pages: number;
  };
}

export function useFreeDataSearch() {
  const [loading, setLoading] = useState(false);

  const searchFreeData = useCallback(async <T extends PersonEntity | CompanyEntity>(
    params: FreeDataSearchParams
  ): Promise<FreeDataSearchResponse<T>> => {
    const { entityType, filterState, page, perPage } = params;
    
    setLoading(true);
    
    try {
      // Build base query
      let query = supabase
        .from('free_data')
        .select('*', { count: 'exact' })
        .eq('entity_type', entityType);

      // Apply JSONB filters
      query = buildFreeDataQuery(query, filterState, entityType);

      // Apply pagination
      const start = (page - 1) * perPage;
      const end = start + perPage - 1;
      query = query.range(start, end);

      const { data, error, count } = await query;

      if (error) {
        console.error('Error searching free_data:', error);
        throw error;
      }

      // Map data to entity types
      const items = (data || []).map(record => {
        const mappedRecord = {
          entity_external_id: record.entity_external_id,
          entity_data: (record.entity_data || {}) as Record<string, any>,
        };
        if (entityType === 'person') {
          return mapFreeDataToPerson(mappedRecord) as T;
        } else {
          return mapFreeDataToCompany(mappedRecord) as T;
        }
      });

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / perPage);

      console.log('[FreeDataSearch] Results:', {
        entityType,
        found: totalCount,
        returned: items.length,
        page,
        totalPages,
      });

      return {
        items,
        totalEstimate: totalCount,
        pagination: {
          page,
          per_page: perPage,
          total_pages: totalPages,
        },
      };
    } catch (error) {
      console.error('Error in searchFreeData:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const searchPeople = useCallback(async (
    filterState: FilterBuilderState,
    page: number = 1,
    perPage: number = 100
  ): Promise<FreeDataSearchResponse<PersonEntity>> => {
    return searchFreeData<PersonEntity>({
      entityType: 'person',
      filterState,
      page,
      perPage,
    });
  }, [searchFreeData]);

  const searchCompanies = useCallback(async (
    filterState: FilterBuilderState,
    page: number = 1,
    perPage: number = 100
  ): Promise<FreeDataSearchResponse<CompanyEntity>> => {
    return searchFreeData<CompanyEntity>({
      entityType: 'company',
      filterState,
      page,
      perPage,
    });
  }, [searchFreeData]);

  return {
    searchPeople,
    searchCompanies,
    loading,
  };
}
