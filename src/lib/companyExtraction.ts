import { PersonEntity, CompanyEntity } from '@/types/audience';

/**
 * Convert an exact employee count to a standardized range string
 * Standard ranges: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10000+
 */
export function employeeCountToRange(count: number | undefined): string | undefined {
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
 * Extracts company information from person entities
 * Deduplicates by company name (case-insensitive)
 */
export function extractCompaniesFromPeople(people: PersonEntity[]): CompanyEntity[] {
  // Map to store unique companies (key = normalized company name)
  const companiesMap = new Map<string, CompanyEntity>();
  
  people.forEach((person, index) => {
    if (!person.company) return; // Skip if no company info
    
    // Normalize company name for deduplication
    const companyKey = person.company.toLowerCase().trim();
    
    // Skip if we already have this company
    if (companiesMap.has(companyKey)) {
      // Merge additional data if available
      const existing = companiesMap.get(companyKey)!;
      
      // Fill in missing fields from this person's company data
      if (!existing.linkedin && person.companyLinkedin) {
        existing.linkedin = person.companyLinkedin;
      }
      if (!existing.phone && person.companyPhone) {
        existing.phone = person.companyPhone;
      }
      if (!existing.industry && person.industry) {
        existing.industry = person.industry;
      }
      if (!existing.location && person.location) {
        existing.location = person.location;
      }
      if (!existing.domain && (person.domain || person.website)) {
        existing.domain = person.domain || person.website;
      }
      
      return;
    }
    
    // Create new company entity
    const parsedCount = person.companySize ? parseEmployeeCount(person.companySize) : undefined;
    const company: CompanyEntity = {
      id: `company-${companyKey}-${Date.now()}-${index}`,
      name: person.company,
      domain: person.domain || person.website,
      industry: person.industry,
      location: person.location,
      city: person.city,
      state: person.state,
      country: person.country,
      description: person.companyDescription,
      employeeCount: parsedCount,
      companySize: person.companySize || employeeCountToRange(parsedCount),
      technologies: person.technologies,
      linkedin: person.companyLinkedin,
      phone: person.companyPhone,
      isUnlocked: person.isUnlocked,
    };
    
    companiesMap.set(companyKey, company);
  });
  
  return Array.from(companiesMap.values());
}

/**
 * Parse company size string to employee count number
 * Examples: "1-10" -> 10, "50-200" -> 200, "1000+" -> 1000
 */
function parseEmployeeCount(sizeStr: string): number | undefined {
  if (!sizeStr) return undefined;
  
  // Extract numbers from string
  const match = sizeStr.match(/(\d+)[+-]?/);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  return undefined;
}
