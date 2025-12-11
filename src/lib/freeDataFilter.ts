import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';
import { FilterBuilderState } from '@/lib/filterConversion';

/**
 * Build Supabase query with JSONB filters for free_data table
 * Filters on entity_data JSONB field
 */
export function buildFreeDataQuery(
  query: any,
  filters: FilterBuilderState,
  entityType: EntityType
): any {
  // NOTE: Keyword search is handled separately via the search_free_data_keywords RPC function
  // to properly handle JSONB text extraction with ILIKE

  // Industry filter
  if (filters.industries.length > 0) {
    // Match any of the selected industries (case-insensitive)
    const industryConditions = filters.industries.map(industry => 
      `entity_data->industry.ilike.${industry}`
    ).join(',');
    query = query.or(industryConditions);
  }

  // Cities/Location filter
  if (filters.cities.length > 0) {
    const cityConditions = filters.cities.map(city => {
      const escapedCity = city.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->city.ilike.%${escapedCity}%,` +
             `entity_data->location.ilike.%${escapedCity}%,` +
             `entity_data->state.ilike.%${escapedCity}%,` +
             `entity_data->country.ilike.%${escapedCity}%`;
    }).join(',');
    query = query.or(cityConditions);
  }

  // Gender filter (person only) - translate male/female to M/F
  if (entityType === 'person' && filters.gender) {
    const genderCode = filters.gender.toLowerCase() === 'male' ? 'M' : 
                       filters.gender.toLowerCase() === 'female' ? 'F' : filters.gender;
    query = query.ilike('entity_data->gender', genderCode);
  }

  // Job Titles filter (person only)
  if (entityType === 'person' && filters.jobTitles.length > 0) {
    const titleConditions = filters.jobTitles.map(title => {
      const escapedTitle = title.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->title.ilike.%${escapedTitle}%,` +
             `entity_data->jobTitle.ilike.%${escapedTitle}%`;
    }).join(',');
    query = query.or(titleConditions);
  }

  // Seniority filter (person only)
  if (entityType === 'person' && filters.seniority.length > 0) {
    const seniorityConditions = filters.seniority.map(sen => 
      `entity_data->seniority.ilike.${sen}`
    ).join(',');
    query = query.or(seniorityConditions);
  }

  // Department filter (person only)
  if (entityType === 'person' && filters.department.length > 0) {
    const deptConditions = filters.department.map(dept => 
      `entity_data->department.ilike.${dept}`
    ).join(',');
    query = query.or(deptConditions);
  }

  // Company Size filter
  if (filters.companySize.length > 0) {
    const sizeConditions = filters.companySize.map(size => 
      `entity_data->companySize.ilike.%${size}%,` +
      `entity_data->employeeCount.ilike.%${size}%`
    ).join(',');
    query = query.or(sizeConditions);
  }

  // Net Worth filter (person only)
  if (entityType === 'person' && filters.netWorth.length > 0) {
    const netWorthConditions = filters.netWorth.map(nw => 
      `entity_data->netWorth.ilike.%${nw}%`
    ).join(',');
    query = query.or(netWorthConditions);
  }

  // Income filter (person only)
  if (entityType === 'person' && filters.income.length > 0) {
    const incomeConditions = filters.income.map(inc => 
      `entity_data->income.ilike.%${inc}%`
    ).join(',');
    query = query.or(incomeConditions);
  }

  // Prospect Data filter (person only) - check if fields exist and are not null
  if (entityType === 'person' && filters.prospectData.length > 0) {
    filters.prospectData.forEach(dataType => {
      switch (dataType) {
        case 'personal_email':
          query = query.not('entity_data->personalEmail', 'is', null);
          break;
        case 'business_email':
          query = query.not('entity_data->businessEmail', 'is', null);
          break;
        case 'direct_mobile':
          query = query.not('entity_data->phone', 'is', null);
          break;
        case 'personal_linkedin':
          query = query.not('entity_data->linkedin', 'is', null);
          break;
        case 'personal_facebook':
          query = query.not('entity_data->facebookUrl', 'is', null);
          break;
        case 'personal_twitter':
          query = query.not('entity_data->twitterUrl', 'is', null);
          break;
      }
    });
  }

  return query;
}

/**
 * Map a free_data record to PersonEntity
 */
export function mapFreeDataToPerson(record: { 
  entity_external_id: string; 
  entity_data: Record<string, any>;
}): PersonEntity {
  const data = record.entity_data || {};
  
  // Extract first value if comma-separated
  const extractFirst = (value: any): string | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string' && value.includes(',')) {
      return value.split(',')[0].trim();
    }
    return String(value);
  };

  return {
    id: record.entity_external_id,
    name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown',
    firstName: extractFirst(data.firstName),
    lastName: extractFirst(data.lastName),
    title: extractFirst(data.title) || extractFirst(data.jobTitle),
    seniority: extractFirst(data.seniority),
    department: extractFirst(data.department),
    location: extractFirst(data.location) || extractFirst(data.city),
    company: extractFirst(data.company),
    companySize: extractFirst(data.companySize),
    companyDescription: data.companyDescription || data.description,
    industry: extractFirst(data.industry),
    technologies: Array.isArray(data.technologies) ? data.technologies : [],
    email: extractFirst(data.email) || extractFirst(data.businessEmail) || extractFirst(data.personalEmail),
    personalEmail: extractFirst(data.personalEmail),
    phone: extractFirst(data.phone),
    linkedin: extractFirst(data.linkedin) || extractFirst(data.linkedinUrl),
    website: extractFirst(data.website),
    companyLinkedin: extractFirst(data.companyLinkedin),
    companyPhone: extractFirst(data.companyPhone),
    age: data.age ? Number(data.age) : undefined,
    gender: extractFirst(data.gender),
    city: extractFirst(data.city),
    state: extractFirst(data.state),
    country: extractFirst(data.country),
    jobTitle: extractFirst(data.jobTitle) || extractFirst(data.title),
    personalEmails: Array.isArray(data.personalEmails) ? data.personalEmails : undefined,
    businessEmail: extractFirst(data.businessEmail),
    directNumber: extractFirst(data.directNumber) || extractFirst(data.phone),
    linkedinUrl: extractFirst(data.linkedinUrl) || extractFirst(data.linkedin),
    facebookUrl: extractFirst(data.facebookUrl),
    twitterUrl: extractFirst(data.twitterUrl),
    // Additional demographic fields
    address: extractFirst(data.address),
    zipCode: extractFirst(data.zipCode),
    children: extractFirst(data.children),
    homeowner: extractFirst(data.homeowner),
    married: extractFirst(data.married),
    netWorth: extractFirst(data.netWorth),
    incomeRange: extractFirst(data.incomeRange) || extractFirst(data.income),
    skills: extractFirst(data.skills),
    interests: extractFirst(data.interests),
    educationHistory: extractFirst(data.educationHistory) || extractFirst(data.education),
    customFields: data.customFields || {},
    isUnlocked: false,
  };
}

/**
 * Map a free_data record to CompanyEntity
 */
export function mapFreeDataToCompany(record: { 
  entity_external_id: string; 
  entity_data: Record<string, any>;
}): CompanyEntity {
  const data = record.entity_data || {};
  
  // Extract first value if comma-separated
  const extractFirst = (value: any): string | undefined => {
    if (!value) return undefined;
    if (typeof value === 'string' && value.includes(',')) {
      return value.split(',')[0].trim();
    }
    return String(value);
  };

  return {
    id: record.entity_external_id,
    name: extractFirst(data.name) || extractFirst(data.company) || 'Unknown',
    domain: extractFirst(data.domain) || extractFirst(data.website),
    industry: extractFirst(data.industry),
    employeeCount: data.employeeCount ? Number(data.employeeCount) : undefined,
    revenue: extractFirst(data.companyRevenue) || extractFirst(data.revenue),
    location: extractFirst(data.location) || extractFirst(data.companyCity) || extractFirst(data.city),
    technologies: Array.isArray(data.technologies) ? data.technologies : [],
    fundingStage: extractFirst(data.fundingStage),
    description: extractFirst(data.companyDescription) || extractFirst(data.description),
    linkedin: extractFirst(data.linkedin) || extractFirst(data.companyLinkedin),
    email: extractFirst(data.email) || extractFirst(data.companyEmail),
    phone: extractFirst(data.phone) || extractFirst(data.companyPhone),
    city: extractFirst(data.companyCity) || extractFirst(data.city),
    state: extractFirst(data.companyState) || extractFirst(data.state),
    country: extractFirst(data.companyCountry) || extractFirst(data.country),
    zipCode: extractFirst(data.companyZipCode) || extractFirst(data.zipCode),
    sic: extractFirst(data.companySic) || extractFirst(data.sic),
    naics: extractFirst(data.companyNaics) || extractFirst(data.naics),
    customFields: data.customFields || {},
    isUnlocked: false,
  };
}
