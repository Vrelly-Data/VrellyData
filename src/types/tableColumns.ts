import { ReactNode } from 'react';

export interface ColumnConfig<T = any> {
  id: string;
  label: string;
  field: keyof T;
  visible: boolean;
  defaultVisible: boolean;
  sortable?: boolean;
  width?: string;
  renderCell?: (value: any, record: T) => ReactNode;
}

export interface TableColumnPreferences {
  entityType: 'person' | 'company';
  columns: string[];
}
