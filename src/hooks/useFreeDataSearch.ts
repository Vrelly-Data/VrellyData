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
  hasCompanyPhone: boolean;
  hasCompanyLinkedin: boolean;
  hasCompanyFacebook: boolean;
  hasCompanyTwitter: boolean;
} {
  return {
    hasPersonalEmail: prospectData.includes('personal_email'),
    hasBusinessEmail: prospectData.includes('business_email'),
    hasPhone: prospectData.includes('direct_mobile'),
    hasLinkedin: prospectData.includes('personal_linkedin'),
    hasFacebook: prospectData.includes('personal_facebook'),
    hasTwitter: prospectData.includes('personal_twitter'),
    hasCompanyPhone: prospectData.includes('company_phone'),
    hasCompanyLinkedin: prospectData.includes('company_linkedin'),
    hasCompanyFacebook: prospectData.includes('company_facebook'),
    hasCompanyTwitter: prospectData.includes('company_twitter'),
  };
}

// Convert gender value to M/F format for database (returns array for DB function)
function convertGender(gender: string | undefined | null): string[] | null {
  if (!gender) return null;
  if (gender.toLowerCase() === 'male') return ['M'];
  if (gender.toLowerCase() === 'female') return ['F'];
  return [gender];
}

// Helper to safely convert array to null if empty
function arrayOrNull(arr: string[] | undefined | null): string[] | null {
  if (!arr || arr.length === 0) return null;
  return arr;
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

      // Merge person and company location filters
      const combinedCities = [
        ...(filterState.cities || []),
        ...(filterState.personCity || []),
        ...(filterState.companyCity || []),
      ].filter(Boolean);
      
      const combinedCountries = [
        ...(filterState.personCountry || []),
        ...(filterState.companyCountry || []),
      ].filter(Boolean);

      // Build parameters for the NEW canonical search function
      const searchParams = {
        p_entity_type: entityType,
        p_keywords: arrayOrNull(filterState.keywords),
        p_job_titles: arrayOrNull(filterState.jobTitles),
        p_seniority_levels: arrayOrNull(filterState.seniority),
        p_company_size_ranges: arrayOrNull(filterState.companySize), // Now supports multi-select!
        p_industries: arrayOrNull(filterState.industries),
        p_countries: arrayOrNull(combinedCountries),
        p_cities: arrayOrNull(combinedCities),
        p_gender: convertGender(filterState.gender),
        p_net_worth: arrayOrNull(filterState.netWorth),
        p_income: arrayOrNull(filterState.income),
        p_departments: arrayOrNull(filterState.department),
        p_company_revenue: arrayOrNull(filterState.companyRevenue),
        p_person_interests: arrayOrNull(filterState.personInterests),
        p_person_skills: arrayOrNull(filterState.personSkills),
        p_technologies: arrayOrNull(filterState.technologies),
        p_has_personal_email: prospectFlags.hasPersonalEmail || null,
        p_has_business_email: prospectFlags.hasBusinessEmail || null,
        p_has_phone: prospectFlags.hasPhone || null,
        p_has_linkedin: prospectFlags.hasLinkedin || null,
        p_has_facebook: prospectFlags.hasFacebook || null,
        p_has_twitter: prospectFlags.hasTwitter || null,
        p_has_company_phone: prospectFlags.hasCompanyPhone || null,
        p_has_company_linkedin: prospectFlags.hasCompanyLinkedin || null,
        p_has_company_facebook: prospectFlags.hasCompanyFacebook || null,
        p_has_company_twitter: prospectFlags.hasCompanyTwitter || null,
        p_limit: perPage,
        p_offset: offset,
      };

      console.log('[FreeDataSearch] Calling search_free_data_builder with:', searchParams);

      // Call the NEW canonical Builder search function
      const { data, error } = await supabase.rpc('search_free_data_builder', searchParams as any);

      if (error) {
        console.error('Error in search_free_data_builder RPC:', error);
        throw error;
      }

      let items: T[] = [];
      let totalCount = 0;

      // Cast to any[] to handle ambiguous RPC return types
      const results = (data || []) as any[];
      if (results.length > 0) {
        totalCount = Number(results[0].total_count) || 0;
        items = results.map((record: any) => {
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
