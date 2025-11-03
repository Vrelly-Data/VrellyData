import { FilterDSL, AudienceLabFilters, PersonEntity, CompanyEntity } from '@/types/audience';

export interface FilterBuilderState {
  industries: string[];
  cities: string[];
  gender: 'male' | 'female' | null;
  jobTitles: string[];
  companySize: string | null;
  netWorth: string | null;
  income: string | null;
  keywords: string;
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
    filters.businessProfile = { industry: state.industries };
  }
  
  if (state.jobTitles.length > 0) {
    filters.jobTitle = state.jobTitles;
  }
  
  if (state.companySize) {
    filters.companySize = [state.companySize];
  }
  
  if (state.keywords && state.keywords.trim()) {
    filters.keywords = state.keywords.trim();
  }
  
  return filters;
}

export function filterMockPeople(people: PersonEntity[], state: FilterBuilderState): PersonEntity[] {
  return people.filter(person => {
    // City filter
    if (state.cities.length > 0) {
      if (!person.location || !state.cities.includes(person.location)) return false;
    }
    
    // Gender filter
    if (state.gender) {
      if (!person.gender || person.gender !== state.gender) return false;
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
    
    // Company size filter
    if (state.companySize && person.companySize) {
      if (person.companySize !== state.companySize) return false;
    }
    
    // Keyword search
    if (state.keywords && state.keywords.trim()) {
      const keyword = state.keywords.toLowerCase();
      const companyMatch = person.company?.toLowerCase().includes(keyword);
      const titleMatch = person.title?.toLowerCase().includes(keyword);
      const industryMatch = person.industry?.toLowerCase().includes(keyword);
      
      if (!companyMatch && !titleMatch && !industryMatch) {
        return false;
      }
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
    
    // Company size filter - match employee count to ranges
    if (state.companySize && company.employeeCount) {
      const rangeMap: Record<string, [number, number]> = {
        '1-10': [1, 10],
        '11-50': [11, 50],
        '51-200': [51, 200],
        '201-500': [201, 500],
        '501-1000': [501, 1000],
        '1001-5000': [1001, 5000],
        '5000+': [5000, Infinity],
      };
      const [min, max] = rangeMap[state.companySize] || [0, Infinity];
      if (company.employeeCount < min || company.employeeCount > max) return false;
    }
    
    // Keyword search
    if (state.keywords && state.keywords.trim()) {
      const keyword = state.keywords.toLowerCase();
      const nameMatch = company.name?.toLowerCase().includes(keyword);
      const descMatch = company.description?.toLowerCase().includes(keyword);
      const industryMatch = company.industry?.toLowerCase().includes(keyword);
      
      if (!nameMatch && !descMatch && !industryMatch) {
        return false;
      }
    }
    
    return true;
  });
}
