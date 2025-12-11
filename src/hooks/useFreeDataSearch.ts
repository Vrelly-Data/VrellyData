import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';
import { FilterBuilderState } from '@/lib/filterConversion';
import { mapFreeDataToPerson, mapFreeDataToCompany } from '@/lib/freeDataFilter';

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

// Helper to convert prospectData flags to individual booleans
function parseProspectData(prospectData: string[]): {
  hasPersonalEmail: boolean;
  hasBusinessEmail: boolean;
  hasPhone: boolean;
  hasLinkedin: boolean;
  hasFacebook: boolean;
  hasTwitter: boolean;
} {
  return {
    hasPersonalEmail: prospectData.includes('personal_email'),
    hasBusinessEmail: prospectData.includes('business_email'),
    hasPhone: prospectData.includes('phone'),
    hasLinkedin: prospectData.includes('linkedin'),
    hasFacebook: prospectData.includes('facebook'),
    hasTwitter: prospectData.includes('twitter'),
  };
}

// Convert gender value to M/F format for database
function convertGender(gender: string | undefined): string | null {
  if (!gender) return null;
  if (gender.toLowerCase() === 'male') return 'M';
  if (gender.toLowerCase() === 'female') return 'F';
  return gender;
}

export function useFreeDataSearch() {
  const [loading, setLoading] = useState(false);

  const searchFreeData = useCallback(async <T extends PersonEntity | CompanyEntity>(
    params: FreeDataSearchParams
  ): Promise<FreeDataSearchResponse<T>> => {
    const { entityType, filterState, page, perPage } = params;
    
    setLoading(true);
    
    try {
      const offset = (page - 1) * perPage;
      const prospectFlags = parseProspectData(filterState.prospectData);

      // Use the comprehensive RPC function for all searches
      const { data, error } = await supabase.rpc('search_free_data_with_filters', {
        p_entity_type: entityType,
        p_keywords: filterState.keywords.length > 0 ? filterState.keywords : null,
        p_industries: filterState.industries.length > 0 ? filterState.industries : null,
        p_cities: filterState.cities.length > 0 ? filterState.cities : null,
        p_gender: convertGender(filterState.gender),
        p_job_titles: filterState.jobTitles.length > 0 ? filterState.jobTitles : null,
        p_seniority: filterState.seniority.length > 0 ? filterState.seniority : null,
        p_department: filterState.department.length > 0 ? filterState.department : null,
        p_company_size: filterState.companySize.length > 0 ? filterState.companySize : null,
        p_net_worth: filterState.netWorth.length > 0 ? filterState.netWorth : null,
        p_income: filterState.income.length > 0 ? filterState.income : null,
        p_has_personal_email: prospectFlags.hasPersonalEmail || null,
        p_has_business_email: prospectFlags.hasBusinessEmail || null,
        p_has_phone: prospectFlags.hasPhone || null,
        p_has_linkedin: prospectFlags.hasLinkedin || null,
        p_has_facebook: prospectFlags.hasFacebook || null,
        p_has_twitter: prospectFlags.hasTwitter || null,
        p_limit: perPage,
        p_offset: offset,
      });

      if (error) {
        console.error('Error in search_free_data_with_filters RPC:', error);
        throw error;
      }

      let items: T[] = [];
      let totalCount = 0;

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
