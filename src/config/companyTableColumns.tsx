import { CompanyEntity } from '@/types/audience';
import { ColumnConfig } from '@/types/tableColumns';

export const COMPANY_COLUMNS: ColumnConfig<CompanyEntity>[] = [
  {
    id: 'name',
    label: 'Company',
    field: 'name',
    visible: true,
    defaultVisible: true,
    sortable: true,
    width: 'min-w-[200px]'
  },
  {
    id: 'industry',
    label: 'Industry',
    field: 'industry',
    visible: true,
    defaultVisible: true,
    sortable: true
  },
  {
    id: 'employeeCount',
    label: 'Employees',
    field: 'employeeCount',
    visible: true,
    defaultVisible: true,
    sortable: true,
    renderCell: (value) => value?.toLocaleString() || '-'
  },
  {
    id: 'location',
    label: 'Location',
    field: 'location',
    visible: true,
    defaultVisible: true,
    sortable: true
  },
  {
    id: 'domain',
    label: 'Domain',
    field: 'domain',
    visible: true,
    defaultVisible: true,
    renderCell: (value) => value || '-'
  }
];
