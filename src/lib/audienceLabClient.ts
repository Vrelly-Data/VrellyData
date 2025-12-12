import { FilterDSL, PersonEntity, CompanyEntity, EntityType, AudienceLabFilters, CreateAudienceRequest } from '@/types/audience';
import { supabase } from '@/integrations/supabase/client';
import { FilterBuilderState, filterMockPeople, filterMockCompanies, convertFilterStateToAudienceLabFormat } from '@/lib/filterConversion';
import { generateMockPeople, generateMockCompanies, MOCK_ATTRIBUTES } from '@/lib/mockData';

// Set to false to use real AudienceLab API (requires credits)
// API Configuration: https://api.audiencelab.io
// API Key stored in: AUDIENCELAB_API_KEY secret
const MOCK_MODE = false;

export interface SearchParams {
  filters: FilterDSL;
  limit?: number;
  cursor?: string;
}

export interface SearchResponse<T> {
  items: T[];
  totalEstimate: number;
  nextCursor?: string;
  pagination?: {
    page: number;
    per_page: number;
    total_pages: number;
  };
  facets?: any;
}

export interface UnlockResponse {
  unlocked: boolean;
  cost: number;
  contact: {
    email?: string;
    phone?: string;
    linkedin?: string;
  };
}

class AudienceLabClient {
  private mockPeopleBase?: PersonEntity[];
  private mockCompaniesBase?: CompanyEntity[];


  private mapEnrichDataToPeople(data: any[]): PersonEntity[] {
    return data.map((item, index) => ({
      id: item.uuid || item.sha256_email || `person-${index}`,
      name: `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unknown',
      firstName: item.first_name,
      lastName: item.last_name,
      email: item.email,
      businessEmail: item.business_email,
      phone: item.phone,
      title: item.job_title,
      seniority: item.seniority,
      department: item.department,
      location: item.personal_city || item.personal_state,
      city: item.personal_city,
      state: item.personal_state,
      country: item.personal_country,
      company: item.company_name,
      companyDomain: item.company_domain,
      industry: item.industry,
      linkedin: item.linkedin_url,
      age: item.age,
      gender: item.gender,
      customFields: {},
      isUnlocked: false,
    }));
  }

  private mapEnrichDataToCompanies(data: any[]): CompanyEntity[] {
    return data.map((item, index) => ({
      id: item.uuid || item.company_domain || `company-${index}`,
      name: item.company_name || 'Unknown',
      domain: item.company_domain,
      industry: item.industry,
      employeeCount: item.employee_count,
      revenue: item.revenue,
      location: item.company_city || item.company_state,
      city: item.company_city,
      state: item.company_state,
      country: item.company_country,
      technologies: item.technologies || [],
      fundingStage: item.funding_stage,
      description: item.company_description,
      linkedin: item.company_linkedin_url,
      phone: item.company_phone,
      customFields: {},
      isUnlocked: false,
    }));
  }

  async searchPeople(params: SearchParams & { filterState?: FilterBuilderState; page?: number; perPage?: number; unlockedIds?: Set<string> }): Promise<SearchResponse<PersonEntity>> {
    try {
      if (MOCK_MODE) {
        // Mock mode: Generate and filter mock data from stable base
        console.log('[MOCK] Searching people with filters:', params.filterState);
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Initialize stable base dataset once
        if (!this.mockPeopleBase) {
          this.mockPeopleBase = generateMockPeople(1500);
        }
        
        // Apply filters to the stable base
        let mockPeople = this.mockPeopleBase;
        if (params.filterState) {
          mockPeople = filterMockPeople(mockPeople, params.filterState);
        }
        
        // Mark unlocked records
        const unlockedIds = params.unlockedIds || new Set();
        mockPeople = mockPeople.map(person => ({
          ...person,
          isUnlocked: unlockedIds.has(person.id),
        }));
        
        // Apply pagination to the filtered stable dataset
        const page = params.page || 1;
        const perPage = params.perPage || params.limit || 100;
        const start = (page - 1) * perPage;
        const end = start + perPage;
        const paginated = mockPeople.slice(start, end);
        
        return {
          items: paginated,
          totalEstimate: mockPeople.length,
          pagination: {
            page,
            per_page: perPage,
            total_pages: Math.ceil(mockPeople.length / perPage),
          },
          facets: {},
        };
      } else {
        // Real API mode - use /enrich endpoint
        console.log('[AudienceLab API] Searching people with filters:', params.filterState);
        
        const filters = convertFilterStateToAudienceLabFormat(params.filterState || {
          industries: [], cities: [], gender: null, jobTitles: [], seniority: [],
          department: [], companySize: [], companyRevenue: [], netWorth: [], income: [], keywords: [],
          prospectData: [], personCity: [], personCountry: [], companyCity: [], companyCountry: [],
          personInterests: [], personSkills: [],
        });
        console.log('[AudienceLab API] Converted filters:', filters);
        
        const response = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'enrich',
            filters,
            is_or_match: false,
            page: params.page || 1,
            per_page: params.perPage || params.limit || 100,
          },
        });

        if (response.error) {
          console.error('Error calling audiencelab-api:', response.error);
          throw new Error(response.error.message || 'Failed to search people');
        }

        if (response.data?.ok === false) {
          console.error('AudienceLab API returned error:', response.data);
          throw new Error(response.data?.error || 'Search failed');
        }

        const data = response.data?.result || [];
        const found = response.data?.found || 0;
        
        console.log('[AudienceLab API] Results received:', data.length, 'of', found);

        // Map API response to PersonEntity
        const entities = this.mapEnrichDataToPeople(data);
        
        // Mark unlocked records
        const unlockedIds = params.unlockedIds || new Set();
        const entitiesWithUnlockStatus = entities.map(person => ({
          ...person,
          isUnlocked: unlockedIds.has(person.id),
        }));

        return {
          items: entitiesWithUnlockStatus,
          totalEstimate: found,
          pagination: {
            page: params.page || 1,
            per_page: params.perPage || params.limit || 100,
            total_pages: Math.ceil(found / (params.perPage || params.limit || 100)),
          },
          facets: {},
        };
      }
    } catch (error) {
      console.error('Error searching people:', error);
      throw error;
    }
  }

  async searchCompanies(params: SearchParams & { filterState?: FilterBuilderState; page?: number; perPage?: number; unlockedIds?: Set<string> }): Promise<SearchResponse<CompanyEntity>> {
    try {
      if (MOCK_MODE) {
        // Mock mode: Generate and filter mock data from stable base
        console.log('[MOCK] Searching companies with filters:', params.filterState);
        
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Initialize stable base dataset once
        if (!this.mockCompaniesBase) {
          this.mockCompaniesBase = generateMockCompanies(800);
        }
        
        // Apply filters to the stable base
        let mockCompanies = this.mockCompaniesBase;
        if (params.filterState) {
          mockCompanies = filterMockCompanies(mockCompanies, params.filterState);
        }
        
        // Mark unlocked records
        const unlockedIds = params.unlockedIds || new Set();
        mockCompanies = mockCompanies.map(company => ({
          ...company,
          isUnlocked: unlockedIds.has(company.id),
        }));
        
        // Apply pagination to the filtered stable dataset
        const page = params.page || 1;
        const perPage = params.perPage || params.limit || 100;
        const start = (page - 1) * perPage;
        const end = start + perPage;
        const paginated = mockCompanies.slice(start, end);
        
        return {
          items: paginated,
          totalEstimate: mockCompanies.length,
          pagination: {
            page,
            per_page: perPage,
            total_pages: Math.ceil(mockCompanies.length / perPage),
          },
          facets: {},
        };
      } else {
        // Real API mode - use /enrich endpoint
        console.log('[AudienceLab API] Searching companies with filters:', params.filterState);
        
        const filters = convertFilterStateToAudienceLabFormat(params.filterState || {
          industries: [], cities: [], gender: null, jobTitles: [], seniority: [],
          department: [], companySize: [], companyRevenue: [], netWorth: [], income: [], keywords: [],
          prospectData: [], personCity: [], personCountry: [], companyCity: [], companyCountry: [],
          personInterests: [], personSkills: [],
        });
        console.log('[AudienceLab API] Converted filters:', filters);
        
        const response = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'enrich',
            filters,
            is_or_match: false,
            page: params.page || 1,
            per_page: params.perPage || params.limit || 100,
          },
        });


        if (response.error) {
          console.error('Error calling audiencelab-api for companies:', response.error);
          throw new Error(response.error.message || 'Failed to search companies');
        }

        if (response.data?.ok === false) {
          console.error('AudienceLab API returned error:', response.data);
          throw new Error(response.data?.error || 'Search failed');
        }
        
        // Check if the response data itself contains an error
        if (response.data?.message && response.data?.status === 'failure') {
          throw new Error(response.data.message);
        }

        const data = response.data?.result || [];
        const found = response.data?.found || 0;
        
        console.log('[AudienceLab API] Results received:', data.length, 'of', found);

        // Map API response to CompanyEntity
        const entities = this.mapEnrichDataToCompanies(data);
        
        // Mark unlocked records
        const unlockedIds = params.unlockedIds || new Set();
        const entitiesWithUnlockStatus = entities.map(company => ({
          ...company,
          isUnlocked: unlockedIds.has(company.id),
        }));

        return {
          items: entitiesWithUnlockStatus,
          totalEstimate: found,
          pagination: {
            page: params.page || 1,
            per_page: params.perPage || params.limit || 100,
            total_pages: Math.ceil(found / (params.perPage || params.limit || 100)),
          },
          facets: {},
        };
      }
    } catch (error) {
      console.error('Error searching companies:', error);
      throw error;
    }
  }

  async unlockContact(entityId: string, entityType: EntityType): Promise<UnlockResponse> {
    // This functionality may not be supported by AudienceLab API
    // Returning mock data for now
    return {
      unlocked: true,
      cost: 1,
      contact: {
        email: `${entityId}@example.com`,
        phone: '+1-555-0100',
        linkedin: `https://linkedin.com/in/${entityId}`,
      },
    };
  }

  async getAttributes(attribute: string): Promise<string[]> {
    try {
      if (MOCK_MODE) {
        console.log(`[MOCK] Getting ${attribute} attributes`);
        await new Promise(resolve => setTimeout(resolve, 200));
        return MOCK_ATTRIBUTES[attribute as keyof typeof MOCK_ATTRIBUTES] || [];
      } else {
        const response = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'getAttributes',
            attribute,
          },
        });

        if (response.error) throw response.error;
        
        // Normalize response to string[]
        let data = response.data;
        
        // Handle nested structure: response.data?.attributes?.[attribute]?.data
        if (data?.attributes?.[attribute]?.data) {
          data = data.attributes[attribute].data;
        }
        
        // If already an array, process it
        if (Array.isArray(data)) {
          return data.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
              // Try common property names
              return item.name || item.value || item.label || String(item);
            }
            return String(item);
          });
        }
        
        // Fallback to empty array
        console.warn(`[AudienceLab] Unexpected attributes format for ${attribute}:`, response.data);
        return [];
      }
    } catch (error) {
      console.error(`Error getting ${attribute} attributes:`, error);
      throw error;
    }
  }

  async estimateSearchCost(filterState: FilterBuilderState, entityType: EntityType): Promise<{ estimatedResults: number; cost: number }> {
    try {
      if (MOCK_MODE) {
        console.log('[MOCK] Estimating search cost');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const mockData = entityType === 'person' 
          ? generateMockPeople(1500)
          : generateMockCompanies(800);
        
        const filtered = entityType === 'person'
          ? filterMockPeople(mockData as PersonEntity[], filterState)
          : filterMockCompanies(mockData as CompanyEntity[], filterState);
        
        return {
          estimatedResults: filtered.length,
          cost: filtered.length,
        };
      } else {
        // Real API: Would create temp audience, get count, delete audience
        // For now, return a placeholder
        return {
          estimatedResults: 0,
          cost: 0,
        };
      }
    } catch (error) {
      console.error('Error estimating search cost:', error);
      throw error;
    }
  }

}

export const audienceLabClient = new AudienceLabClient();
