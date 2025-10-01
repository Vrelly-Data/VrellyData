import { FilterDSL, PersonEntity, CompanyEntity, EntityType, AudienceLabFilters, CreateAudienceRequest } from '@/types/audience';
import { supabase } from '@/integrations/supabase/client';

export interface SearchParams {
  filters: FilterDSL;
  limit?: number;
  cursor?: string;
}

export interface SearchResponse<T> {
  items: T[];
  totalEstimate: number;
  nextCursor?: string;
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

  async searchPeople(params: SearchParams): Promise<SearchResponse<PersonEntity>> {
    try {
      // Create a temporary audience
      const filters = this.convertFiltersToAudienceLabFormat(params.filters);
      const audienceName = `temp-search-${Date.now()}`;
      
      // Create audience (using a default segment - you may need to adjust this)
      const createResponse = await supabase.functions.invoke('audiencelab-api', {
        body: {
          action: 'createAudience',
          name: audienceName,
          filters,
          segment: ['default'], // This needs to be replaced with actual segment IDs
          days_back: 30,
        },
      });

      if (createResponse.error) throw createResponse.error;
      
      const audienceId = createResponse.data?.id || createResponse.data?.audience_id;
      if (!audienceId) throw new Error('No audience ID returned');
      
      this.tempAudienceIds.push(audienceId);

      // Fetch audience data
      const getResponse = await supabase.functions.invoke('audiencelab-api', {
        body: {
          action: 'getAudience',
          audience_id: audienceId,
          page: 1,
          per_page: params.limit || 100,
        },
      });

      if (getResponse.error) throw getResponse.error;

      const data = getResponse.data?.data || [];
      const pagination = getResponse.data?.pagination || {};

      return {
        items: this.mapAudienceDataToEntities(data, 'person') as PersonEntity[],
        totalEstimate: data.length,
        facets: {},
      };
    } catch (error) {
      console.error('Error searching people:', error);
      throw error;
    }
  }

  async searchCompanies(params: SearchParams): Promise<SearchResponse<CompanyEntity>> {
    try {
      const filters = this.convertFiltersToAudienceLabFormat(params.filters);
      const audienceName = `temp-company-search-${Date.now()}`;
      
      const createResponse = await supabase.functions.invoke('audiencelab-api', {
        body: {
          action: 'createAudience',
          name: audienceName,
          filters,
          segment: ['default'],
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
          page: 1,
          per_page: params.limit || 100,
        },
      });

      if (getResponse.error) throw getResponse.error;

      const data = getResponse.data?.data || [];

      return {
        items: this.mapAudienceDataToEntities(data, 'company') as CompanyEntity[],
        totalEstimate: data.length,
        facets: {},
      };
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
      const response = await supabase.functions.invoke('audiencelab-api', {
        body: {
          action: 'getAttributes',
          attribute,
        },
      });

      if (response.error) throw response.error;
      return response.data;
    } catch (error) {
      console.error(`Error getting ${attribute} attributes:`, error);
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
