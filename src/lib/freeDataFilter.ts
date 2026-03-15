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

  // Industry filter - use partial matching to support multi-word industries like "health, wellness, and fitness"
  if (filters.industries.length > 0) {
    const industryConditions = filters.industries.map(industry => {
      const escaped = industry.replace(/[%_]/g, '\\$&');
      return `entity_data->industry.ilike.%${escaped}%`;
    }).join(',');
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

  // Company Revenue filter
  if (filters.companyRevenue.length > 0) {
    const revenueConditions = filters.companyRevenue.map(rev => {
      const escapedRev = rev.replace(/[%_]/g, '\\$&');
      return `entity_data->revenue.ilike.%${escapedRev}%,` +
             `entity_data->companyRevenue.ilike.%${escapedRev}%,` +
             `entity_data->annual_revenue.ilike.%${escapedRev}%,` +
             `entity_data->annualRevenue.ilike.%${escapedRev}%,` +
             `entity_data->estimated_annual_revenue.ilike.%${escapedRev}%`;
    }).join(',');
    query = query.or(revenueConditions);
  }

  // Person City filter (person only)
  if (entityType === 'person' && filters.personCity.length > 0) {
    const cityConditions = filters.personCity.map(city => {
      const escapedCity = city.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->city.ilike.%${escapedCity}%`;
    }).join(',');
    query = query.or(cityConditions);
  }

  // Person Country filter (person only)
  if (entityType === 'person' && filters.personCountry.length > 0) {
    const countryConditions = filters.personCountry.map(country => {
      const escapedCountry = country.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->country.ilike.%${escapedCountry}%`;
    }).join(',');
    query = query.or(countryConditions);
  }

  // Company City filter
  if (filters.companyCity.length > 0) {
    const cityConditions = filters.companyCity.map(city => {
      const escapedCity = city.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->city.ilike.%${escapedCity}%,` +
             `entity_data->companyCity.ilike.%${escapedCity}%`;
    }).join(',');
    query = query.or(cityConditions);
  }

  // Company Country filter
  if (filters.companyCountry.length > 0) {
    const countryConditions = filters.companyCountry.map(country => {
      const escapedCountry = country.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->country.ilike.%${escapedCountry}%,` +
             `entity_data->companyCountry.ilike.%${escapedCountry}%`;
    }).join(',');
    query = query.or(countryConditions);
  }

  // Person Interests filter (person only)
  if (entityType === 'person' && filters.personInterests.length > 0) {
    const interestConditions = filters.personInterests.map(interest => {
      const escapedInterest = interest.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->interests.ilike.%${escapedInterest}%`;
    }).join(',');
    query = query.or(interestConditions);
  }

  // Person Skills filter (person only)
  if (entityType === 'person' && filters.personSkills.length > 0) {
    const skillConditions = filters.personSkills.map(skill => {
      const escapedSkill = skill.replace(/[%_]/g, '\\$&').toLowerCase();
      return `entity_data->skills.ilike.%${escapedSkill}%`;
    }).join(',');
    query = query.or(skillConditions);
  }

  // Technologies filter (both person and company)
  if (filters.technologies && filters.technologies.length > 0) {
    const techConditions = filters.technologies.map(tech => {
      const escapedTech = tech.replace(/[%_]/g, '\\$&').toLowerCase();
      // Search in technologies array (stored as JSON array) by converting to text
      return `entity_data->technologies.cs.[\"${escapedTech}\"]`;
    }).join(',');
    query = query.or(techConditions);
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
 * Map a prospects record (flat columns) to PersonEntity
 */
function parseEducationHistory(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((e: any) => e.name || e.institution_name || '').filter(Boolean).join(', ');
    }
    if (typeof parsed === 'object') {
      return parsed.name || parsed.institution_name || '';
    }
  } catch {
    return raw;
  }
  return raw;
}
export function mapFreeDataToPerson(record: Record<string, any>): PersonEntity {
  const data = record || {};

  // Extract first value if comma-separated, but don't break numbers with thousand separators
  const extractFirst = (value: any): string | undefined => {
    if (!value) return undefined;
    const strVal = String(value).trim();

    // Don't split if it looks like a number with thousand separators (e.g., "26,000")
    if (/^\d{1,3}(,\d{3})+(\+)?$/.test(strVal)) {
      return strVal;
    }

    // Don't split if it looks like a currency value (e.g., "$1,000,000 or more")
    if (/^-?\$[\d,]+/.test(strVal)) {
      return strVal;
    }

    // Don't split if it looks like a currency range (e.g., "$375,000 to $499,999")
    if (/^-?\$[\d,]+.*to.*\$[\d,]+/.test(strVal)) {
      return strVal;
    }

    // Don't split if it looks like a range with commas (e.g., "1,001 to 5,000")
    if (/^\d[\d,]*\s+(to|-)\s+\d[\d,]*$/.test(strVal)) {
      return strVal;
    }

    // For actual comma-separated lists, take the first value
    if (strVal.includes(',')) {
      return strVal.split(',')[0].trim();
    }
    return strVal;
  };

  // Parse employee count and compute standardized range for company size
  const rawCompanySize = extractFirst(data.company_size);
  const parsedCount = parseEmployeeCountFromData(rawCompanySize);
  const computedCompanySize = employeeCountToRange(parsedCount);

  return {
    id: data.entity_external_id || data.id,
    name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown',
    firstName: extractFirst(data.first_name),
    lastName: extractFirst(data.last_name),

    seniority: extractFirst(data.seniority),
    department: extractFirst(data.department),
    location: extractFirst(data.city),
    company: extractFirst(data.company_name),
    companySize: computedCompanySize,
    companyDescription: extractFirst(data.company_description),
    industry: extractFirst(data.company_industry),
    technologies: data.technologies ? [data.technologies] : [],
    email: extractFirst(data.business_email) || extractFirst(data.personal_email),
    personalEmail: extractFirst(data.personal_email),
    phone: extractFirst(data.phone),
    linkedin: extractFirst(data.linkedin_url),
    website: extractFirst(data.company_domain),
    companyLinkedin: extractFirst(data.company_linkedin),
    companyPhone: extractFirst(data.company_phone),
    age: extractFirst(data.age_range),
    gender: extractFirst(data.gender),
    city: extractFirst(data.city),
    state: extractFirst(data.state),
    country: extractFirst(data.country),
    jobTitle: extractFirst(data.job_title),
    personalEmails: extractFirst(data.personal_email),
    businessEmail: extractFirst(data.business_email),
    directNumber: extractFirst(data.phone),
    linkedinUrl: extractFirst(data.linkedin_url),
    facebookUrl: extractFirst(data.facebook_url),
    twitterUrl: extractFirst(data.twitter_url),
    // Additional demographic fields
    address: extractFirst(data.address),
    zipCode: extractFirst(data.zip_code),
    children: extractFirst(data.children),
    homeowner: extractFirst(data.homeowner),
    married: extractFirst(data.married),
    netWorth: extractFirst(data.net_worth),
    incomeRange: extractFirst(data.income_range),
    skills: extractFirst(data.skills),
    interests: extractFirst(data.interests),
    educationHistory: parseEducationHistory(data.education_history),
    keywords: data.keywords ? [data.keywords] : [],
    // Company location fields
    companyCity: extractFirst(data.company_city),
    companyState: extractFirst(data.company_state),
    companyCountry: extractFirst(data.company_country),
    companyZipCode: extractFirst(data.company_zip_code),
    companyRevenue: extractFirst(data.company_revenue),
    companySic: extractFirst(data.company_sic),
    companyNaics: extractFirst(data.company_naics),
    customFields: {},
    isUnlocked: false,
  };
}

/**
 * Parse employee count from various formats and return upper bound
 */
function parseEmployeeCountFromData(sizeStr: string | undefined): number | undefined {
  if (!sizeStr) return undefined;
  
  const str = String(sizeStr).trim();
  
  // Handle "26 to 50" format → extract upper bound (50)
  const toMatch = str.match(/(\d[\d,]*)\s+to\s+(\d[\d,]*)/i);
  if (toMatch) {
    return parseInt(toMatch[2].replace(/,/g, ''), 10);
  }
  
  // Handle "51-200" format → extract upper bound (200)
  const dashMatch = str.match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)/);
  if (dashMatch) {
    return parseInt(dashMatch[2].replace(/,/g, ''), 10);
  }
  
  // Handle "1000+" format
  const plusMatch = str.match(/(\d[\d,]*)\+/);
  if (plusMatch) {
    return parseInt(plusMatch[1].replace(/,/g, ''), 10);
  }
  
  // Single number
  const singleMatch = str.match(/^(\d[\d,]*)$/);
  if (singleMatch) {
    return parseInt(singleMatch[1].replace(/,/g, ''), 10);
  }
  
  // Extract any number as fallback
  const anyMatch = str.match(/(\d[\d,]*)/);
  if (anyMatch) {
    return parseInt(anyMatch[1].replace(/,/g, ''), 10);
  }
  
  return undefined;
}

/**
 * Convert employee count to standardized range string
 */
function employeeCountToRange(count: number | undefined): string | undefined {
  if (count === undefined || count === null) return undefined;
  
  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  if (count <= 200) return '51-200';
  if (count <= 500) return '201-500';
  if (count <= 1000) return '501-1000';
  if (count <= 5000) return '1001-5000';
  if (count <= 10000) return '5001-10000';
  return '10000+';
}

/**
 * Map a prospects record (flat columns) to CompanyEntity
 */
export function mapFreeDataToCompany(record: Record<string, any>): CompanyEntity {
  const data = record || {};
  
  // Extract first value if comma-separated, but don't break numbers with thousand separators
  const extractFirst = (value: any): string | undefined => {
    if (!value) return undefined;
    const strVal = String(value).trim();
    
    // Don't split if it looks like a number with thousand separators (e.g., "26,000")
    if (/^\d{1,3}(,\d{3})+(\+)?$/.test(strVal)) {
      return strVal;
    }
    
    // Don't split if it looks like a currency value (e.g., "$1,000,000 or more")
    if (/^-?\$[\d,]+/.test(strVal)) {
      return strVal;
    }

    // Don't split if it looks like a currency range (e.g., "$375,000 to $499,999")
    if (/^-?\$[\d,]+.*to.*\$[\d,]+/.test(strVal)) {
      return strVal;
    }

    // Don't split if it looks like a range with commas (e.g., "1,001 to 5,000")
    if (/^\d[\d,]*\s+(to|-)\s+\d[\d,]*$/.test(strVal)) {
      return strVal;
    }
    
    // For actual comma-separated lists, take the first value
    if (strVal.includes(',')) {
      return strVal.split(',')[0].trim();
    }
    return strVal;
  };

  // Parse employee count from companySize or employeeCount field
  const rawSize = extractFirst(data.companySize) || extractFirst(data.employeeCount);
  const parsedCount = parseEmployeeCountFromData(rawSize);
  const computedRange = employeeCountToRange(parsedCount);

  return {
    id: record.entity_external_id,
    name: extractFirst(data.name) || extractFirst(data.company) || 'Unknown',
    domain: extractFirst(data.domain) || extractFirst(data.website),
    industry: extractFirst(data.industry),
    employeeCount: parsedCount,
    companySize: computedRange,
    revenue: extractFirst(data.company_revenue),
    location: extractFirst(data.location) || extractFirst(data.companyCity) || extractFirst(data.city),
    technologies: Array.isArray(data.technologies) 
      ? data.technologies 
      : (typeof data.technologies === 'string' && data.technologies 
          ? data.technologies.split(',').map((t: string) => t.trim()).filter(Boolean) 
          : []),
    fundingStage: extractFirst(data.fundingStage) || extractFirst(data.funding),
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
    companyAddress: extractFirst(data.companyAddress),
    keywords: Array.isArray(data.keywords) 
      ? data.keywords 
      : (typeof data.keywords === 'string' && data.keywords 
          ? data.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) 
          : []),
    customFields: data.customFields || {},
    isUnlocked: false,
  };
}
