import { PersonEntity, CompanyEntity } from '@/types/audience';

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
      
      return;
    }
    
    // Create new company entity
    const company: CompanyEntity = {
      id: `company-${companyKey}-${Date.now()}-${index}`,
      name: person.company,
      industry: person.industry,
      location: person.location,
      city: person.city,
      state: person.state,
      country: person.country,
      description: person.companyDescription,
      employeeCount: person.companySize ? parseEmployeeCount(person.companySize) : undefined,
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
