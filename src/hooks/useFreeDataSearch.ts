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
  isEstimate: boolean;
  pagination: {
    page: number;
    per_page: number;
    total_pages: number;
  };
}

// Helper to convert prospectData flags to individual booleans
function parseProspectData(prospectData: string[]) {
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

// Convert gender value to M/F format for database
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

export const TOTAL_DISPLAY_CAP = 100_000;

// Build shared filter params (without p_limit/p_offset)
function buildFilterParams(entityType: EntityType, filterState: FilterBuilderState) {
  const prospectFlags = parseProspectData(filterState.prospectData);

  const combinedCities = [
    ...(filterState.cities || []),
    ...(filterState.personCity || []),
    ...(filterState.companyCity || []),
  ].filter(Boolean);
  
  const combinedCountries = [
    ...(filterState.personCountry || []),
    ...(filterState.companyCountry || []),
  ].filter(Boolean);

  return {
    p_keywords: arrayOrNull(filterState.keywords),
    p_job_titles: arrayOrNull(filterState.jobTitles),
    p_seniority_levels: arrayOrNull(filterState.seniority),
    p_company_size_ranges: arrayOrNull(filterState.companySize),
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
    p_exclude_keywords: arrayOrNull(filterState.excludeKeywords),
    p_exclude_job_titles: arrayOrNull(filterState.excludeJobTitles),
    p_exclude_industries: arrayOrNull(filterState.excludeIndustries),
    p_exclude_cities: arrayOrNull([
      ...(filterState.excludePersonCity || []),
      ...(filterState.excludeCompanyCity || []),
    ].filter(Boolean)),
    p_exclude_countries: arrayOrNull([
      ...(filterState.excludePersonCountry || []),
      ...(filterState.excludeCompanyCountry || []),
    ].filter(Boolean)),
    p_exclude_technologies: arrayOrNull(filterState.excludeTechnologies),
    p_exclude_person_skills: arrayOrNull(filterState.excludePersonSkills),
    p_exclude_person_interests: arrayOrNull(filterState.excludePersonInterests),
    p_zip_code: filterState.zipCode || null,
    p_children: filterState.children ? [filterState.children] : null,
    p_homeowner: filterState.homeowner !== null && filterState.homeowner !== undefined ? filterState.homeowner : null,
    p_married: filterState.married !== null && filterState.married !== undefined ? filterState.married : null,
    p_education: arrayOrNull(filterState.education),
    p_age_min: filterState.ageMin || null,
    p_age_max: filterState.ageMax || null,
    p_company_names: arrayOrNull(filterState.company),
    p_added_on_days_ago: filterState.addedOnDaysAgo || null,
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
      const offset = (page - 1) * perPage;
      const sharedParams = buildFilterParams(entityType, filterState);

      // Build params for each function
      const resultsParams = {
        ...sharedParams,
        p_limit: perPage,
        p_offset: offset,
      };

      const countParams = { ...sharedParams };

      // Call BOTH functions in parallel with Promise.allSettled
      const [resultsResponse, countResponse] = await Promise.allSettled([
        supabase.rpc('search_prospects_results', resultsParams as any),
        supabase.rpc('search_prospects_count', countParams as any),
      ]);

      // Process results (fast path - always available)
      let items: T[] = [];
      if (resultsResponse.status === 'fulfilled') {
        const { data, error } = resultsResponse.value;
        if (error) {
          console.error('Error in search_prospects_results:', JSON.stringify(error));
          throw error;
        }
        const results = (data || []) as any[];
        items = results.map((record: any) => {
          if (entityType === 'person') {
            return mapFreeDataToPerson(record) as T;
          } else {
            return mapFreeDataToCompany(record) as T;
          }
        });
      } else {
        console.error('Results query rejected:', resultsResponse.reason);
        throw resultsResponse.reason;
      }

      // Process count (may fail gracefully)
      let totalCount = items.length; // fallback: at least what we got
      let isEstimate = true;
      
      if (countResponse.status === 'fulfilled') {
        const { data, error } = countResponse.value;
        if (!error && data && (data as any[]).length > 0) {
          const countRow = (data as any[])[0];
          totalCount = Number(countRow.total_count) || 0;
          isEstimate = Boolean(countRow.is_estimate);
        } else if (error) {
          console.warn('Count query failed (using fallback):', error.message);
          // Fallback: use items.length as minimum estimate
          totalCount = items.length;
          isEstimate = true;
        }
      } else {
        console.warn('Count query rejected (using fallback):', countResponse.reason);
        totalCount = items.length;
        isEstimate = true;
      }

      const cappedTotal = Math.min(totalCount, TOTAL_DISPLAY_CAP);
      const totalPages = Math.ceil(cappedTotal / perPage);

      return {
        items,
        totalEstimate: cappedTotal,
        isEstimate,
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
