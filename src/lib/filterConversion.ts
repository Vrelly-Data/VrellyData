import { FilterDSL, AudienceLabFilters, PersonEntity, CompanyEntity } from '@/types/audience';

export interface FilterBuilderState {
  segments: string[];
  age: { min: number; max: number } | null;
  cities: string[];
  gender: string[];
  industries: string[];
  jobTitles: string[];
  seniority: string[];
  departments: string[];
  daysBack: number;
  companySize?: string[];
  fundingStage?: string[];
}

export function convertFilterStateToAudienceLabFormat(state: FilterBuilderState): AudienceLabFilters {
  const filters: AudienceLabFilters = {};
  
  if (state.age) {
    filters.age = { minAge: state.age.min, maxAge: state.age.max };
  }
  
  if (state.cities.length > 0) {
    filters.city = state.cities;
  }
  
  if (state.gender.length > 0) {
    filters.gender = state.gender;
  }
  
  if (state.industries.length > 0) {
    filters.businessProfile = { industry: state.industries };
  }
  
  if (state.jobTitles.length > 0) {
    filters.jobTitle = state.jobTitles;
  }
  
  if (state.seniority && state.seniority.length > 0) {
    filters.seniority = state.seniority;
  }
  
  if (state.departments && state.departments.length > 0) {
    filters.department = state.departments;
  }
  
  if (state.companySize && state.companySize.length > 0) {
    filters.companySize = state.companySize;
  }
  
  if (state.fundingStage && state.fundingStage.length > 0) {
    filters.fundingStage = state.fundingStage;
  }
  
  return filters;
}

export function filterMockPeople(people: PersonEntity[], state: FilterBuilderState): PersonEntity[] {
  return people.filter(person => {
    // Age filter
    if (state.age) {
      const age = person.age || 0;
      if (age < state.age.min || age > state.age.max) return false;
    }
    
    // City filter
    if (state.cities.length > 0) {
      if (!person.location || !state.cities.includes(person.location)) return false;
    }
    
    // Gender filter
    if (state.gender.length > 0) {
      if (!person.gender || !state.gender.includes(person.gender)) return false;
    }
    
    // Industry filter
    if (state.industries.length > 0) {
      if (!person.industry || !state.industries.includes(person.industry)) return false;
    }
    
    // Job title filter
    if (state.jobTitles.length > 0) {
      if (!person.title || !state.jobTitles.some(title => person.title?.toLowerCase().includes(title.toLowerCase()))) {
        return false;
      }
    }
    
    // Seniority filter
    if (state.seniority.length > 0) {
      if (!person.seniority || !state.seniority.includes(person.seniority)) return false;
    }
    
    // Department filter
    if (state.departments.length > 0) {
      if (!person.department || !state.departments.includes(person.department)) return false;
    }
    
    return true;
  });
}

export function filterMockCompanies(companies: CompanyEntity[], state: FilterBuilderState): CompanyEntity[] {
  return companies.filter(company => {
    // Industry filter
    if (state.industries.length > 0) {
      if (!company.industry || !state.industries.includes(company.industry)) return false;
    }
    
    // Location filter
    if (state.cities.length > 0) {
      if (!company.location || !state.cities.includes(company.location)) return false;
    }
    
    // Company size filter
    if (state.companySize && state.companySize.length > 0) {
      // Mock filtering - in real implementation would match employee count ranges
      return true;
    }
    
    // Funding stage filter
    if (state.fundingStage && state.fundingStage.length > 0) {
      if (!company.fundingStage || !state.fundingStage.includes(company.fundingStage)) return false;
    }
    
    return true;
  });
}
