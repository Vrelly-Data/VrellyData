import { FilterDSL, AudienceLabFilters, PersonEntity, CompanyEntity } from '@/types/audience';

export interface FilterBuilderState {
  industries: string[];
  cities: string[];
  gender: 'male' | 'female' | null;
  jobTitles: string[];
  seniority: string[];
  department: string[];
  companySize: string[];
  netWorth: string[];
  income: string[];
  keywords: string[];
  prospectData: string[];
}

export function convertFilterStateToAudienceLabFormat(state: FilterBuilderState): AudienceLabFilters {
  const filters: AudienceLabFilters = {};
  
  if (state.cities.length > 0) {
    filters.city = state.cities;
  }
  
  if (state.gender) {
    filters.gender = [state.gender];
  }
  
  if (state.industries.length > 0) {
    filters.businessProfile = {
      industry: state.industries,
    };
  }
  
  if (state.jobTitles.length > 0) {
    filters.jobTitle = state.jobTitles;
  }
  
  if (state.seniority.length > 0) {
    filters.seniority = state.seniority;
  }
  
  if (state.department.length > 0) {
    filters.department = state.department;
  }
  
  if (state.companySize.length > 0) {
    filters.companySize = state.companySize;
  }
  
  if (state.keywords.length > 0) {
    filters.keywords = state.keywords.join(' ');
  }
  
  return filters;
}

export function filterMockPeople(people: PersonEntity[], state: FilterBuilderState): PersonEntity[] {
  return people.filter(person => {
    // Filter by city
    if (state.cities.length > 0 && !state.cities.includes(person.location)) {
      return false;
    }
    
    // Filter by gender
    if (state.gender && person.gender !== state.gender) {
      return false;
    }
    
    // Filter by industry
    if (state.industries.length > 0 && !state.industries.includes(person.industry)) {
      return false;
    }
    
    // Filter by job title
    if (state.jobTitles.length > 0 && !state.jobTitles.includes(person.title)) {
      return false;
    }
    
    // Filter by seniority
    if (state.seniority.length > 0 && !state.seniority.includes(person.seniority)) {
      return false;
    }
    
    // Filter by department
    if (state.department.length > 0 && !state.department.includes(person.department)) {
      return false;
    }
    
    // Filter by company size
    if (state.companySize.length > 0 && !state.companySize.includes(person.companySize)) {
      return false;
    }
    
    // Filter by prospect data (mock implementation - ~70% of records have each type)
    if (state.prospectData.length > 0) {
      // Mock: randomly determine if person has ANY of the selected data types
      // In production, this will check actual fields from AudienceLab
      const mockHasData = Math.random() > 0.3; // 70% have data
      if (!mockHasData) {
        return false;
      }
    }
    
    // Filter by keywords (search in name, title, company, industry, company description)
    if (state.keywords.length > 0) {
      const searchableFields = [
        person.name,
        person.title,
        person.company,
        person.industry,
        person.companyDescription || '',
      ].join(' ').toLowerCase();
      
      const hasMatch = state.keywords.some(keyword => 
        searchableFields.includes(keyword.toLowerCase())
      );
      
      if (!hasMatch) {
        return false;
      }
    }
    
    return true;
  });
}

export function filterMockCompanies(companies: CompanyEntity[], state: FilterBuilderState): CompanyEntity[] {
  return companies.filter(company => {
    // Filter by industry
    if (state.industries.length > 0 && !state.industries.includes(company.industry)) {
      return false;
    }
    
    // Filter by location
    if (state.cities.length > 0 && !state.cities.includes(company.location)) {
      return false;
    }
    
    // Filter by company size (employee count ranges)
    if (state.companySize.length > 0) {
      const count = company.employeeCount;
      const matchesAnyRange = state.companySize.some(range => {
        if (range === '1-10' && count >= 1 && count <= 10) return true;
        if (range === '11-50' && count >= 11 && count <= 50) return true;
        if (range === '51-200' && count >= 51 && count <= 200) return true;
        if (range === '201-500' && count >= 201 && count <= 500) return true;
        if (range === '501-1000' && count >= 501 && count <= 1000) return true;
        if (range === '1001-5000' && count >= 1001 && count <= 5000) return true;
        if (range === '5000+' && count >= 5000) return true;
        return false;
      });
      
      if (!matchesAnyRange) return false;
    }
    
    // Filter by keywords (search in name, industry, description)
    if (state.keywords.length > 0) {
      const searchableFields = [
        company.name,
        company.industry,
        company.description || '',
      ].join(' ').toLowerCase();
      
      const hasMatch = state.keywords.some(keyword => 
        searchableFields.includes(keyword.toLowerCase())
      );
      
      if (!hasMatch) {
        return false;
      }
    }
    
    return true;
  });
}
