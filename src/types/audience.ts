export type EntityType = 'person' | 'company';
export type UserRole = 'admin' | 'member';
export type ExportStatus = 'pending' | 'running' | 'done' | 'failed';
export type ExportFormat = 'csv' | 'json';
export type SuppressionType = 'email' | 'domain' | 'company_id' | 'person_id';

export type FilterOperator = 'eq' | 'neq' | 'in' | 'nin' | 'contains' | 'icontains' | 'range' | 'exists';

export interface FilterOperand {
  field: string;
  op: FilterOperator;
  value?: any;
}

export interface FilterGroup {
  or?: FilterOperand[];
  and?: FilterOperand[];
}

export interface FilterDSL {
  type: EntityType;
  where: FilterOperand | FilterGroup;
  exclude?: FilterOperand | FilterGroup;
}

export interface PersonEntity {
  id: string;
  name: string;
  title: string;
  seniority: string;
  department: string;
  location: string;
  company: string;
  companySize: string;
  industry: string;
  technologies: string[];
  email?: string;
  phone?: string;
  linkedin?: string;
}

export interface CompanyEntity {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employeeCount: number;
  revenue?: string;
  location: string;
  technologies: string[];
  fundingStage?: string;
  description?: string;
}

export interface Audience {
  id: string;
  team_id: string;
  name: string;
  type: EntityType;
  filters: FilterDSL;
  result_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FilterPreset {
  id: string;
  team_id: string;
  name: string;
  type: EntityType;
  filters: FilterDSL;
  created_at: string;
}

export interface UnlockEvent {
  id: string;
  user_id: string;
  audience_id?: string;
  entity_type: EntityType;
  entity_external_id: string;
  cost: number;
  payload: any;
  created_at: string;
}
