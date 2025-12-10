import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';

/**
 * Generates a simple hash for key contact data fields
 * Used to detect if contact data has been updated since last unlock
 */
export function generateDataHash(
  entity: PersonEntity | CompanyEntity,
  entityType: EntityType
): string {
  const keyFields = entityType === 'person'
    ? ['email', 'phone', 'title', 'linkedin', 'company', 'businessEmail', 'directNumber']
    : ['domain', 'linkedin', 'phone', 'industry', 'employeeCount'];

  const values = keyFields.map(field => {
    const value = (entity as any)[field];
    if (value === undefined || value === null || value === '') {
      return '';
    }
    return String(value).trim().toLowerCase();
  });

  // Simple hash: join values and create a string hash
  const combined = values.join('|');
  return simpleHash(combined);
}

/**
 * Simple string hash function (djb2 algorithm)
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

/**
 * Compare two hashes to determine if data has changed
 */
export function hasDataChanged(oldHash: string | null, newHash: string): boolean {
  if (!oldHash) return true; // No previous hash means new data
  return oldHash !== newHash;
}
