import Papa from 'papaparse';
import { SystemField, CSVFieldMapping } from '@/types/csvImport';
import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';

/**
 * Parse employee count string to a number (upper bound for ranges)
 * Examples: "1-10" -> 10, "51-200" -> 200, "26 to 50" -> 50, "1000+" -> 1000, "26,000" -> 26000
 */
function parseEmployeeCountFromString(sizeStr: string): number | undefined {
  if (!sizeStr) return undefined;
  
  // Remove commas from numbers first (e.g., "26,000" -> "26000")
  const cleanStr = sizeStr.replace(/,/g, '').trim();
  
  // Handle "26 to 50" format → extract upper bound (50)
  const toMatch = cleanStr.match(/(\d+)\s+to\s+(\d+)/i);
  if (toMatch) {
    return parseInt(toMatch[2], 10);
  }
  
  // Handle "51-200" or "500 - 1000" format → extract upper bound
  const dashMatch = cleanStr.match(/(\d+)\s*-\s*(\d+)/);
  if (dashMatch) {
    return parseInt(dashMatch[2], 10);
  }
  
  // Handle "1000+" format → return the number
  const plusMatch = cleanStr.match(/(\d+)\+/);
  if (plusMatch) {
    return parseInt(plusMatch[1], 10);
  }
  
  // Single number
  const singleMatch = cleanStr.match(/^(\d+)$/);
  if (singleMatch) {
    return parseInt(singleMatch[1], 10);
  }
  
  // Extract first number as last resort
  const anyMatch = cleanStr.match(/(\d+)/);
  if (anyMatch) {
    return parseInt(anyMatch[1], 10);
  }
  
  return undefined;
}

/**
 * Convert an employee count number to a standardized range bucket string
 */
function employeeCountToRangeBucket(count: number): string {
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
 * Extract the first value from a comma-separated string
 * e.g., "x@hotmail.com, y@gmail.com, z@outlook.com" => "x@hotmail.com"
 * 
 * IMPORTANT: Does NOT split numbers with thousand separators (e.g., "26,000" stays as "26,000")
 */
function extractFirstValue(value: string): string {
  // Don't split if it looks like a number with thousand separators (e.g., "26,000" or "1,234,567")
  if (/^\d{1,3}(,\d{3})+(\+)?$/.test(value.trim())) {
    return value.trim();
  }
  
  // Don't split if it looks like a range with commas (e.g., "1,001 to 5,000")
  if (/^\d[\d,]*\s+(to|-)\s+\d[\d,]*$/.test(value.trim())) {
    return value.trim();
  }
  
  // For actual comma-separated lists (like emails), take the first value
  if (value.includes(',')) {
    return value.split(',')[0].trim();
  }
  return value;
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - matrix[s2.length][s1.length] / maxLength;
}

/**
 * Auto-map CSV headers to system fields using aliases and fuzzy matching
 */
export function autoMapFields(
  csvHeaders: string[],
  systemFields: SystemField[]
): Map<string, string> {
  const mappings = new Map<string, string>();
  const usedSystemFields = new Set<string>();
  
  for (const csvHeader of csvHeaders) {
    let bestMatch: { fieldId: string; score: number } | null = null;
    
    for (const field of systemFields) {
      // Skip if field already mapped or is custom field option
      if (usedSystemFields.has(field.id) || field.id === 'custom') continue;
      
      const normalizedHeader = csvHeader.toLowerCase().trim();
      
      // Check exact match with field ID
      if (normalizedHeader === field.id.toLowerCase()) {
        bestMatch = { fieldId: field.id, score: 1.0 };
        break;
      }
      
      // Check exact match with field label
      if (normalizedHeader === field.label.toLowerCase()) {
        bestMatch = { fieldId: field.id, score: 1.0 };
        break;
      }
      
      // Check aliases - EXACT MATCH ONLY
      if (field.aliases) {
        for (const alias of field.aliases) {
          const normalizedAlias = alias.toLowerCase().trim();
          if (normalizedHeader === normalizedAlias) {
            bestMatch = { fieldId: field.id, score: 0.95 };
            break;
          }
        }
        if (bestMatch?.score === 0.95) break;
      }
    }
    
    // Only add if we found an exact or alias match
    if (bestMatch) {
      mappings.set(csvHeader, bestMatch.fieldId);
      usedSystemFields.add(bestMatch.fieldId);
    }
  }
  
  return mappings;
}

/**
 * Parse CSV file and return headers and data
 */
export function parseCSVFile(file: File): Promise<{ headers: string[], data: any[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(`CSV parsing errors: ${results.errors.map(e => e.message).join(', ')}`));
          return;
        }
        
        const headers = results.meta.fields || [];
        const data = results.data;
        
        resolve({
          headers,
          data
        });
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}

/**
 * Transform CSV data to entity format based on mappings
 */
export function transformImportData(
  mappings: CSVFieldMapping[],
  rawData: any[],
  entityType: EntityType
): PersonEntity[] | CompanyEntity[] {
  const fieldMap = new Map<string, string>();
  
  mappings.forEach(m => {
    if (m.systemField) {
      fieldMap.set(m.csvHeader, m.systemField);
    }
  });
  
  if (entityType === 'person') {
    return rawData.map((row, index) => {
      const entity: PersonEntity = {
        id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}`,
        name: ''
      };
      
      let firstName = '';
      let lastName = '';
      
      mappings.forEach(mapping => {
        if (!mapping.systemField) return;
        
        const value = row[mapping.csvHeader];
        if (!value) return;
        const trimmedValue = extractFirstValue(String(value).trim());
        
        // Handle custom fields
        if (mapping.systemField === 'custom') {
          if (!entity.customFields) {
            entity.customFields = {};
          }
          entity.customFields[mapping.csvHeader] = trimmedValue;
          return;
        }
        
        switch (mapping.systemField) {
          // Name fields
          case 'firstName':
            firstName = trimmedValue;
            break;
          case 'lastName':
            lastName = trimmedValue;
            break;
          
          // Email fields
          case 'email':
            entity.email = trimmedValue;
            break;
          case 'personalEmail':
            entity.personalEmail = trimmedValue;
            break;
          case 'businessEmail':
            entity.businessEmail = trimmedValue;
            break;
          
          // Job fields
          case 'title':
            entity.title = trimmedValue;
            entity.jobTitle = trimmedValue;
            break;
          case 'seniority':
            entity.seniority = trimmedValue;
            break;
          case 'department':
            entity.department = trimmedValue;
            break;
          
          // Contact fields
          case 'phone':
            entity.phone = trimmedValue;
            break;
          case 'linkedin':
            entity.linkedin = trimmedValue;
            break;
          case 'linkedinUrl':
            entity.linkedinUrl = trimmedValue;
            break;
          case 'twitterUrl':
            entity.twitterUrl = trimmedValue;
            break;
          case 'facebookUrl':
            entity.facebookUrl = trimmedValue;
            break;
          
          // Location fields
          case 'address':
            entity.address = trimmedValue;
            break;
          case 'city':
            entity.city = trimmedValue;
            break;
          case 'state':
            entity.state = trimmedValue;
            break;
          case 'country':
            entity.country = trimmedValue;
            break;
          case 'zipCode':
            entity.zipCode = trimmedValue;
            break;
          
          // Demographics fields
          case 'age':
            const ageNum = parseInt(trimmedValue);
            entity.age = !isNaN(ageNum) ? ageNum : undefined;
            break;
          case 'gender':
            entity.gender = trimmedValue;
            break;
          case 'children':
            entity.children = trimmedValue;
            break;
          case 'homeowner':
            entity.homeowner = trimmedValue;
            break;
          case 'married':
            entity.married = trimmedValue;
            break;
          case 'netWorth':
            entity.netWorth = trimmedValue;
            break;
          case 'incomeRange':
            entity.incomeRange = trimmedValue;
            break;
          
          // Skills and interests
          case 'skills':
            entity.skills = trimmedValue;
            break;
          case 'interests':
            entity.interests = trimmedValue;
            break;
          case 'educationHistory':
            entity.educationHistory = trimmedValue;
            break;
          
          // Company fields (for person's company)
          case 'company':
            entity.company = trimmedValue;
            break;
          case 'website':
            entity.website = trimmedValue;
            break;
          case 'companyLinkedin':
          case 'companyLinkedinUrl':
            entity.companyLinkedin = trimmedValue;
            break;
          case 'industry':
          case 'companyIndustry':
            entity.industry = trimmedValue;
            break;
          case 'companyPhone':
          case 'companyPhoneNumber':
            entity.companyPhone = trimmedValue;
            break;
          case 'companySize':
          case 'employeeCount':
            entity.companySize = trimmedValue;
            break;
          case 'companyDescription':
            entity.companyDescription = trimmedValue;
            break;
          case 'companyCity':
            entity.companyCity = trimmedValue;
            break;
          case 'companyState':
            entity.companyState = trimmedValue;
            break;
          case 'companyCountry':
            entity.companyCountry = trimmedValue;
            break;
          case 'companyZipCode':
            entity.companyZipCode = trimmedValue;
            break;
          case 'companyRevenue':
            entity.companyRevenue = trimmedValue;
            break;
          case 'companySic':
            entity.companySic = trimmedValue;
            break;
          case 'companyNaics':
            entity.companyNaics = trimmedValue;
            break;
          case 'domain':
            entity.domain = trimmedValue;
            break;
        }
      });
      
      // Combine first and last name
      entity.name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
      entity.firstName = firstName;
      entity.lastName = lastName;
      
      return entity;
    });
  } else {
    return rawData.map((row, index) => {
      const entity: CompanyEntity = {
        id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}`,
        name: ''
      };
      
      mappings.forEach(mapping => {
        if (!mapping.systemField) return;
        
        const value = row[mapping.csvHeader];
        if (!value) return;
        const trimmedValue = extractFirstValue(String(value).trim());
        
        // Handle custom fields
        if (mapping.systemField === 'custom') {
          if (!entity.customFields) {
            entity.customFields = {};
          }
          entity.customFields[mapping.csvHeader] = trimmedValue;
          return;
        }
        
        switch (mapping.systemField) {
          case 'name':
            entity.name = trimmedValue;
            break;
          case 'domain':
            entity.domain = trimmedValue;
            break;
          case 'email':
            entity.email = trimmedValue;
            break;
          
          // Industry and size
          case 'industry':
          case 'companyIndustry':
            entity.industry = trimmedValue;
            break;
          case 'employeeCount':
          case 'companySize':
            // Parse employee count properly, handling ranges and formats
            const parsedCount = parseEmployeeCountFromString(trimmedValue);
            if (parsedCount !== undefined) {
              entity.employeeCount = parsedCount;
              entity.companySize = employeeCountToRangeBucket(parsedCount);
            } else {
              // If we can't parse it, store the raw value as companySize
              entity.companySize = trimmedValue;
            }
            break;
          
          // Contact fields
          case 'linkedin':
          case 'companyLinkedinUrl':
            entity.linkedin = trimmedValue;
            break;
          case 'phone':
          case 'companyPhoneNumber':
            entity.phone = trimmedValue;
            break;
          
          // Location fields
          case 'location':
            entity.location = trimmedValue;
            break;
          case 'city':
          case 'companyCity':
            entity.city = trimmedValue;
            break;
          case 'state':
          case 'companyState':
            entity.state = trimmedValue;
            break;
          case 'country':
          case 'companyCountry':
            entity.country = trimmedValue;
            break;
          case 'zipCode':
          case 'companyZipCode':
            entity.zipCode = trimmedValue;
            break;
          
          // Company details
          case 'description':
          case 'companyDescription':
            entity.description = trimmedValue;
            break;
          case 'revenue':
          case 'companyRevenue':
            entity.revenue = trimmedValue;
            break;
          case 'sic':
          case 'companySic':
            entity.sic = trimmedValue;
            break;
          case 'naics':
          case 'companyNaics':
            entity.naics = trimmedValue;
            break;
        }
      });
      
      if (!entity.name) {
        entity.name = 'Unknown Company';
      }
      
      return entity;
    });
  }
}
