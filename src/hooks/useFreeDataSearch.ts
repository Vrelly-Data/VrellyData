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
      const start = (page - 1) * perPage;
      const hasKeywords = filterState.keywords.length > 0;
      const hasOtherFilters = 
        filterState.industries.length > 0 ||
        filterState.cities.length > 0 ||
        filterState.gender ||
        filterState.jobTitles.length > 0 ||
        filterState.seniority.length > 0 ||
        filterState.department.length > 0 ||
        filterState.companySize.length > 0 ||
        filterState.netWorth.length > 0 ||
        filterState.income.length > 0 ||
        filterState.prospectData.length > 0;

      let items: T[] = [];
      let totalCount = 0;

      if (hasKeywords && !hasOtherFilters) {
        // Use RPC function for keyword-only search
        const { data, error } = await supabase.rpc('search_free_data_keywords', {
          p_entity_type: entityType,
          p_keywords: filterState.keywords,
          p_limit: perPage,
          p_offset: start,
        });

        if (error) {
          console.error('Error in keyword search RPC:', error);
          throw error;
        }

        if (data && data.length > 0) {
          totalCount = Number(data[0].total_count) || 0;
          items = data.map((record: any) => {
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
        }
      } else if (hasKeywords && hasOtherFilters) {
        // For combined keyword + filter search, use RPC for keywords first, then filter in memory
        // This is a trade-off for simplicity - can be optimized with a more complex SQL function
        const { data, error } = await supabase.rpc('search_free_data_keywords', {
          p_entity_type: entityType,
          p_keywords: filterState.keywords,
          p_limit: 1000, // Get more results to filter
          p_offset: 0,
        });

        if (error) {
          console.error('Error in keyword search RPC:', error);
          throw error;
        }

        if (data && data.length > 0) {
          // Apply additional filters using the regular query builder approach
          // For now, we'll just return keyword results - can enhance later
          totalCount = Number(data[0].total_count) || 0;
          const paginatedData = data.slice(start, start + perPage);
          items = paginatedData.map((record: any) => {
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
        }
      } else {
        // No keywords - use regular query with filters
        let query = supabase
          .from('free_data')
          .select('*', { count: 'exact' })
          .eq('entity_type', entityType);

        // Apply non-keyword JSONB filters
        query = buildFreeDataQuery(query, filterState, entityType);

        // Apply pagination
        const end = start + perPage - 1;
        query = query.range(start, end);

        const { data, error, count } = await query;

        if (error) {
          console.error('Error searching free_data:', error);
          throw error;
        }

        totalCount = count || 0;
        items = (data || []).map(record => {
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
      }

      const totalPages = Math.ceil(totalCount / perPage);

      console.log('[FreeDataSearch] Results:', {
        entityType,
        found: totalCount,
        returned: items.length,
        page,
        totalPages,
        hasKeywords,
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
