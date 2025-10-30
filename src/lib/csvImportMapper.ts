import Papa from 'papaparse';
import { SystemField, CSVFieldMapping } from '@/types/csvImport';
import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';

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
      // Skip if field already mapped
      if (usedSystemFields.has(field.id)) continue;
      
      const normalizedHeader = csvHeader.toLowerCase().trim();
      
      // Check exact match
      if (normalizedHeader === field.id.toLowerCase()) {
        bestMatch = { fieldId: field.id, score: 1.0 };
        break;
      }
      
      // Check aliases
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
      
      // Fuzzy matching
      const similarity = calculateSimilarity(normalizedHeader, field.label);
      if (similarity >= 0.7 && (!bestMatch || similarity > bestMatch.score)) {
        bestMatch = { fieldId: field.id, score: similarity };
      }
      
      // Check partial matches
      if (normalizedHeader.includes(field.id.toLowerCase()) || 
          field.label.toLowerCase().includes(normalizedHeader)) {
        const score = 0.75;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { fieldId: field.id, score };
        }
      }
    }
    
    // Only map if confidence is high enough
    if (bestMatch && bestMatch.score >= 0.7) {
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
        resolve({
          headers,
          data: results.data
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
        
        const trimmedValue = String(value).trim();
        
        switch (mapping.systemField) {
          case 'firstName':
            firstName = trimmedValue;
            break;
          case 'lastName':
            lastName = trimmedValue;
            break;
          case 'title':
            entity.title = trimmedValue;
            entity.jobTitle = trimmedValue;
            break;
          case 'phone':
            entity.phone = trimmedValue;
            break;
          case 'company':
            entity.company = trimmedValue;
            break;
          case 'website':
            entity.website = trimmedValue;
            break;
          case 'linkedin':
            entity.linkedin = trimmedValue;
            break;
          case 'companyLinkedin':
            entity.companyLinkedin = trimmedValue;
            break;
          case 'industry':
            entity.industry = trimmedValue;
            break;
          case 'companyPhone':
            entity.companyPhone = trimmedValue;
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
          case 'companySize':
            entity.companySize = trimmedValue;
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
        
        const trimmedValue = String(value).trim();
        
        switch (mapping.systemField) {
          case 'name':
            entity.name = trimmedValue;
            break;
          case 'domain':
            entity.domain = trimmedValue;
            break;
          case 'industry':
            entity.industry = trimmedValue;
            break;
          case 'employeeCount':
            const count = parseInt(trimmedValue.replace(/[^0-9]/g, ''));
            if (!isNaN(count)) {
              entity.employeeCount = count;
            }
            break;
          case 'linkedin':
            entity.linkedin = trimmedValue;
            break;
          case 'phone':
            entity.phone = trimmedValue;
            break;
          case 'location':
            entity.location = trimmedValue;
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
        }
      });
      
      if (!entity.name) {
        entity.name = 'Unknown Company';
      }
      
      return entity;
    });
  }
}
