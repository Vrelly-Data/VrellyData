import { FilterDSL, PersonEntity, CompanyEntity, EntityType, AudienceLabFilters, CreateAudienceRequest } from '@/types/audience';
import { supabase } from '@/integrations/supabase/client';
import { FilterBuilderState, filterMockPeople, filterMockCompanies } from '@/lib/filterConversion';
import { generateMockPeople, generateMockCompanies, MOCK_ATTRIBUTES } from '@/lib/mockData';

// Set to false to use real AudienceLab API (requires credits)
// API Configuration: https://api.audiencelab.io
// API Key stored in: AUDIENCELAB_API_KEY secret
const MOCK_MODE = true;

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
  private tempAudienceIds: string[] = [];
  private mockPeopleBase?: PersonEntity[];
  private mockCompaniesBase?: CompanyEntity[];

  private convertFiltersToAudienceLabFormat(filters: FilterDSL): AudienceLabFilters {
    // Convert our FilterDSL to AudienceLab's format
    const labFilters: AudienceLabFilters = {};
    
    // Extract filters from the where clause
    if ('and' in filters.where) {
      filters.where.and?.forEach(operand => {
        if (operand.field === 'age' && operand.op === 'range' && Array.isArray(operand.value)) {
          labFilters.age = { minAge: operand.value[0], maxAge: operand.value[1] };
        }
        if (operand.field === 'location' && operand.op === 'in') {
          labFilters.city = Array.isArray(operand.value) ? operand.value : [operand.value];
        }
        if (operand.field === 'gender' && operand.op === 'in') {
          labFilters.gender = Array.isArray(operand.value) ? operand.value : [operand.value];
        }
        if (operand.field === 'industry' && operand.op === 'in') {
          labFilters.businessProfile = {
            industry: Array.isArray(operand.value) ? operand.value : [operand.value]
          };
        }
        if (operand.field === 'title' && operand.op === 'in') {
          labFilters.jobTitle = Array.isArray(operand.value) ? operand.value : [operand.value];
        }
        if (operand.field === 'keywords' && operand.value) {
          labFilters.keywords = operand.value;
        }
      });
    }
    
    return labFilters;
  }

  private mapAudienceDataToEntities(data: any[], type: EntityType): (PersonEntity | CompanyEntity)[] {
    return data.map((item, index) => {
      if (type === 'person') {
        return {
          id: item.id || `person-${index}`,
          name: item.name || item.fullName || 'Unknown',
          title: item.title || item.jobTitle,
          seniority: item.seniority,
          department: item.department,
          location: item.location || item.city,
          company: item.company || item.companyName,
          companySize: item.companySize,
          companyDescription: item.companyDescription || item.company_description,
          industry: item.industry,
          technologies: item.technologies || [],
          email: item.email,
          phone: item.phone,
          linkedin: item.linkedin,
          age: item.age,
          gender: item.gender,
        } as PersonEntity;
      } else {
        return {
          id: item.id || `company-${index}`,
          name: item.name || item.companyName || 'Unknown',
          domain: item.domain || item.website,
          industry: item.industry,
          employeeCount: item.employeeCount || item.employees,
          revenue: item.revenue,
          location: item.location || item.headquarters,
          technologies: item.technologies || [],
          fundingStage: item.fundingStage,
          description: item.description,
        } as CompanyEntity;
      }
    });
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
          this.mockPeopleBase = generateMockPeople(1500, new Set());
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
        // Real API mode
        const filters = this.convertFiltersToAudienceLabFormat(params.filters);
        const audienceName = `temp-search-${Date.now()}`;
        
        const createResponse = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'createAudience',
            name: audienceName,
            filters,
            days_back: 30,
          },
        });

        if (createResponse.error) throw createResponse.error;
        
        const audienceId = createResponse.data?.id || createResponse.data?.audience_id;
        if (!audienceId) throw new Error('No audience ID returned');
        
        this.tempAudienceIds.push(audienceId);

        const getResponse = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'getAudience',
            audience_id: audienceId,
            page: params.page || 1,
            page_size: params.perPage || params.limit || 100,
          },
        });

        if (getResponse.error) throw getResponse.error;

        const data = getResponse.data?.data || [];
        const pagination = getResponse.data?.pagination || {};

        return {
          items: this.mapAudienceDataToEntities(data, 'person') as PersonEntity[],
          totalEstimate: data.length,
          pagination,
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
          this.mockCompaniesBase = generateMockCompanies(800, new Set());
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
        // Real API mode
        const filters = this.convertFiltersToAudienceLabFormat(params.filters);
        const audienceName = `temp-company-search-${Date.now()}`;
        
        const createResponse = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'createAudience',
            name: audienceName,
            filters,
            days_back: 30,
          },
        });

        if (createResponse.error) throw createResponse.error;
        
        const audienceId = createResponse.data?.id || createResponse.data?.audience_id;
        if (!audienceId) throw new Error('No audience ID returned');
        
        this.tempAudienceIds.push(audienceId);

        const getResponse = await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'getAudience',
            audience_id: audienceId,
            page: params.page || 1,
            page_size: params.perPage || params.limit || 100,
          },
        });

        if (getResponse.error) throw getResponse.error;

        const data = getResponse.data?.data || [];

        return {
          items: this.mapAudienceDataToEntities(data, 'company') as CompanyEntity[],
          totalEstimate: data.length,
          pagination: getResponse.data?.pagination,
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

  async getAttributes(attribute: string): Promise<any> {
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
        return response.data;
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
          ? generateMockPeople(1500, new Set())
          : generateMockCompanies(800, new Set());
        
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

  async cleanupTempAudiences(): Promise<void> {
    // Clean up temporary audiences
    for (const audienceId of this.tempAudienceIds) {
      try {
        await supabase.functions.invoke('audiencelab-api', {
          body: {
            action: 'deleteAudience',
            audience_id: audienceId,
          },
        });
      } catch (error) {
        console.error(`Error deleting temp audience ${audienceId}:`, error);
      }
    }
    this.tempAudienceIds = [];
  }
}

export const audienceLabClient = new AudienceLabClient();
