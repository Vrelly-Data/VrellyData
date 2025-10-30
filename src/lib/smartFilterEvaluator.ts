import { SmartFilter, FilterCondition, FilterRule } from '@/types/filterProperties';
import { PersonEntity, CompanyEntity } from '@/types/audience';

type RecordEntity = PersonEntity | CompanyEntity;

/**
 * Evaluates a single filter condition against a record
 */
function evaluateCondition(record: RecordEntity, condition: FilterCondition): boolean {
  const value = record[condition.property as keyof RecordEntity];
  const conditionValue = condition.value;
  
  switch (condition.operator) {
    case 'equals':
      return value === conditionValue;
    
    case 'not_equals':
      return value !== conditionValue;
    
    case 'contains':
      if (value == null) return false;
      return String(value).toLowerCase().includes(String(conditionValue).toLowerCase());
    
    case 'not_contains':
      if (value == null) return true;
      return !String(value).toLowerCase().includes(String(conditionValue).toLowerCase());
    
    case 'starts_with':
      if (value == null) return false;
      return String(value).toLowerCase().startsWith(String(conditionValue).toLowerCase());
    
    case 'ends_with':
      if (value == null) return false;
      return String(value).toLowerCase().endsWith(String(conditionValue).toLowerCase());
    
    case 'less_than':
      if (value == null) return false;
      return Number(value) < Number(conditionValue);
    
    case 'greater_than':
      if (value == null) return false;
      return Number(value) > Number(conditionValue);
    
    case 'less_than_or_equal':
      if (value == null) return false;
      return Number(value) <= Number(conditionValue);
    
    case 'greater_than_or_equal':
      if (value == null) return false;
      return Number(value) >= Number(conditionValue);
    
    case 'between':
      if (value == null || !Array.isArray(conditionValue) || conditionValue.length !== 2) return false;
      const numValue = Number(value);
      return numValue >= Number(conditionValue[0]) && numValue <= Number(conditionValue[1]);
    
    case 'in':
      if (!Array.isArray(conditionValue)) return false;
      return conditionValue.includes(value);
    
    case 'not_in':
      if (!Array.isArray(conditionValue)) return true;
      return !conditionValue.includes(value);
    
    case 'is_empty':
      return value === '' || value === null || value === undefined;
    
    case 'is_not_empty':
      return value !== '' && value !== null && value !== undefined;
    
    case 'is_known':
      return value !== null && value !== undefined;
    
    case 'is_unknown':
      return value === null || value === undefined;
    
    default:
      return true;
  }
}

/**
 * Evaluates a filter rule (group of conditions) against a record
 */
function evaluateRule(record: RecordEntity, rule: FilterRule): boolean {
  // Evaluate all conditions in this rule
  const conditionResults = rule.conditions.map(condition => 
    evaluateCondition(record, condition)
  );
  
  // Evaluate all nested groups
  const groupResults = rule.groups?.map(group => 
    evaluateRule(record, group)
  ) || [];
  
  // Combine all results
  const allResults = [...conditionResults, ...groupResults];
  
  // Return based on logic type (AND/OR)
  if (rule.logic === 'and') {
    return allResults.every(result => result);
  } else {
    return allResults.some(result => result);
  }
}

/**
 * Filters an array of records based on a smart filter
 */
export function evaluateSmartFilter<T extends RecordEntity>(
  records: T[],
  filter: SmartFilter
): T[] {
  return records.filter(record => evaluateRule(record, filter.rule));
}
