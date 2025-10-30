import { PersonEntity } from '@/types/audience';
import { ColumnConfig } from '@/types/tableColumns';

export const PERSON_COLUMNS: ColumnConfig<PersonEntity>[] = [
  {
    id: 'name',
    label: 'Name',
    field: 'name',
    visible: true,
    defaultVisible: true,
    sortable: true,
    width: 'min-w-[200px]'
  },
  {
    id: 'title',
    label: 'Title',
    field: 'title',
    visible: true,
    defaultVisible: true,
    sortable: true,
    renderCell: (value, record) => value || record.jobTitle || '-'
  },
  {
    id: 'company',
    label: 'Company',
    field: 'company',
    visible: true,
    defaultVisible: true,
    sortable: true
  },
  {
    id: 'location',
    label: 'Location',
    field: 'location',
    visible: true,
    defaultVisible: true,
    renderCell: (value, record) => record.city || value || '-'
  },
  {
    id: 'email',
    label: 'Email',
    field: 'email',
    visible: true,
    defaultVisible: true,
    sortable: true,
    renderCell: (value) => value || '-'
  },
  {
    id: 'linkedin',
    label: 'LinkedIn URL',
    field: 'linkedin',
    visible: false,
    defaultVisible: false,
    renderCell: (value) => {
      if (!value) return '-';
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          View Profile
        </a>
      );
    }
  },
  {
    id: 'industry',
    label: 'Industry',
    field: 'industry',
    visible: false,
    defaultVisible: false,
    sortable: true,
    renderCell: (value) => value || '-'
  },
  {
    id: 'phone',
    label: 'Mobile Number',
    field: 'phone',
    visible: false,
    defaultVisible: false,
    renderCell: (value) => value || '-'
  },
  {
    id: 'seniority',
    label: 'Seniority',
    field: 'seniority',
    visible: false,
    defaultVisible: false,
    sortable: true,
    renderCell: (value) => value || '-'
  },
  {
    id: 'department',
    label: 'Department',
    field: 'department',
    visible: false,
    defaultVisible: false,
    sortable: true,
    renderCell: (value) => value || '-'
  }
];
