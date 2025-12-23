import { CompanyEntity } from '@/types/audience';
import { ColumnConfig } from '@/types/tableColumns';
import { employeeCountToRange } from '@/lib/companyExtraction';

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
    renderCell: (value, record) => record.companySize || employeeCountToRange(value) || '-'
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
  },
  {
    id: 'description',
    label: 'Company Description',
    field: 'description',
    visible: false,
    defaultVisible: false,
    sortable: true,
    width: 'min-w-[300px]',
    renderCell: (value) => value || '-'
  }
];
