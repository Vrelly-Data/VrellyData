import { EntityType } from './audience';

export type PropertyType = 
  | 'text' 
  | 'number' 
  | 'date' 
  | 'select' 
  | 'multiselect' 
  | 'boolean'
  | 'url'
  | 'currency'
  | 'tags';

export type OperatorType = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains'
  | 'contains_any'
  | 'not_contains_any'
  | 'starts_with'
  | 'ends_with'
  | 'less_than'
  | 'greater_than'
  | 'less_than_or_equal'
  | 'greater_than_or_equal'
  | 'between'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_known'
  | 'is_unknown';

export interface PropertyDefinition {
  id: string;
  label: string;
  type: PropertyType;
  operators: OperatorType[];
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  unit?: string;
  category?: string;
}

export interface FilterCondition {
  id: string;
  property: string;
  operator: OperatorType;
  value: any;
}

export interface FilterRule {
  id: string;
  logic: 'and' | 'or';
  conditions: FilterCondition[];
  groups?: FilterRule[];
}

export interface SmartFilter {
  id?: string;
  name: string;
  entityType: EntityType;
  rule: FilterRule;
}

export const OPERATOR_LABELS: Record<OperatorType, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  contains_any: 'contains any of',
  not_contains_any: 'does not contain any of',
  starts_with: 'starts with',
  ends_with: 'ends with',
  less_than: 'less than',
  greater_than: 'greater than',
  less_than_or_equal: 'less than or equal to',
  greater_than_or_equal: 'greater than or equal to',
  between: 'between',
  in: 'is any of',
  not_in: 'is none of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is_known: 'is known',
  is_unknown: 'is unknown',
};
