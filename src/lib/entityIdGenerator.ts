import { PersonEntity, CompanyEntity } from '@/types/audience';

/**
 * Simple hash function for creating deterministic IDs from strings
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Normalize LinkedIn URL to extract the unique profile identifier
 */
function normalizeLinkedIn(url: string): string {
  const cleaned = url.toLowerCase().trim();
  // Extract the profile path portion (e.g., "in/john-doe" or "company/acme")
  const match = cleaned.match(/linkedin\.com\/(in|company)\/([^/?]+)/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  // Fallback: hash the whole URL
  return hashString(cleaned);
}

/**
 * Extract domain from an email address
 */
function extractDomain(email?: string): string | null {
  if (!email) return null;
  const parts = email.toLowerCase().trim().split('@');
  return parts.length === 2 ? parts[1] : null;
}

/**
 * Normalize a string for consistent comparison
 */
function normalizeString(str?: string): string {
  if (!str) return '';
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Generate a deterministic unique ID for a person entity.
 * 
 * Priority:
 * 1. LinkedIn URL (most stable identifier)
 * 2. Composite hash: firstName + lastName + companyName
 * 3. Composite hash: firstName + lastName + email domain
 * 4. Business email as fallback
 * 5. Personal email as fallback
 * 6. Random UUID (no deduplication possible)
 */
export function generatePersonId(person: PersonEntity): string {
  // Priority 1: LinkedIn URL (most stable)
  const linkedinUrl = person.linkedinUrl || person.linkedin;
  if (linkedinUrl) {
    return `li-${normalizeLinkedIn(linkedinUrl)}`;
  }
  
  const firstName = normalizeString(person.firstName);
  const lastName = normalizeString(person.lastName);
  const companyName = normalizeString(person.company);
  
  // Priority 2: Composite hash (name + company)
  if (firstName && lastName && companyName) {
    const composite = `${firstName}|${lastName}|${companyName}`;
    return `p-${hashString(composite)}`;
  }
  
  // Priority 3: Name + email domain
  const email = person.businessEmail || person.email || person.personalEmail;
  const emailDomain = extractDomain(email);
  
  if (firstName && lastName && emailDomain) {
    const composite = `${firstName}|${lastName}|${emailDomain}`;
    return `p-${hashString(composite)}`;
  }
  
  // Priority 4: Business email
  if (person.businessEmail) {
    return `e-${person.businessEmail.toLowerCase().trim()}`;
  }
  
  // Priority 5: Personal email
  if (person.email || person.personalEmail) {
    const fallbackEmail = (person.email || person.personalEmail)!.toLowerCase().trim();
    return `e-${fallbackEmail}`;
  }
  
  // Final fallback: Random UUID (will not dedupe)
  return `p-${crypto.randomUUID()}`;
}

/**
 * Generate a deterministic unique ID for a company entity.
 * 
 * Priority:
 * 1. Domain (most unique identifier for companies)
 * 2. LinkedIn URL
 * 3. Company name (normalized)
 * 4. Random UUID (no deduplication possible)
 */
export function generateCompanyId(company: CompanyEntity): string {
  // Priority 1: Domain
  if (company.domain) {
    const cleanDomain = company.domain.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    return `d-${cleanDomain}`;
  }
  
  // Priority 2: LinkedIn URL
  if (company.linkedin) {
    return `li-${normalizeLinkedIn(company.linkedin)}`;
  }
  
  // Priority 3: Company name
  if (company.name) {
    const normalizedName = company.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `c-${normalizedName}`;
  }
  
  // Final fallback: Random UUID
  return `c-${crypto.randomUUID()}`;
}
