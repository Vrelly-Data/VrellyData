import { PropertyDefinition } from '@/types/filterProperties';

export const PERSON_FILTER_PROPERTIES: PropertyDefinition[] = [
  // Basic Information
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    category: 'Basic Information',
    operators: ['equals', 'contains', 'starts_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter name'
  },
  {
    id: 'email',
    label: 'Email',
    type: 'text',
    category: 'Basic Information',
    operators: ['equals', 'contains', 'ends_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter email'
  },
  {
    id: 'phone',
    label: 'Phone',
    type: 'text',
    category: 'Basic Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter phone'
  },
  {
    id: 'lists',
    label: 'Lists',
    type: 'multiselect',
    category: 'Basic Information',
    operators: ['in', 'not_in'],
    options: []
  },
  
  // Job Information
  {
    id: 'title',
    label: 'Job Title',
    type: 'text',
    category: 'Job Information',
    operators: ['equals', 'contains', 'in', 'not_in', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter job title'
  },
  {
    id: 'seniority',
    label: 'Seniority',
    type: 'multiselect',
    category: 'Job Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: []
  },
  {
    id: 'department',
    label: 'Department',
    type: 'multiselect',
    category: 'Job Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: []
  },
  
  // Company Information
  {
    id: 'company',
    label: 'Company',
    type: 'text',
    category: 'Company Information',
    operators: ['equals', 'contains', 'in', 'not_in'],
    placeholder: 'Enter company name'
  },
  {
    id: 'company_size',
    label: 'Company Size',
    type: 'select',
    category: 'Company Information',
    operators: ['equals', 'in', 'not_in'],
    options: []
  },
  {
    id: 'industry',
    label: 'Industry',
    type: 'multiselect',
    category: 'Company Information',
    operators: ['in', 'not_in'],
    options: []
  },
  
  // Location
  {
    id: 'location',
    label: 'Location',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'contains', 'in', 'not_in'],
    placeholder: 'Enter location'
  },
  {
    id: 'city',
    label: 'City',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'in', 'not_in'],
    placeholder: 'Enter city'
  },
  
  // Social
  {
    id: 'linkedin',
    label: 'LinkedIn URL',
    type: 'url',
    category: 'Social',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter LinkedIn URL'
  },
  
  // Demographics
  {
    id: 'age',
    label: 'Age',
    type: 'number',
    category: 'Demographics',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter age'
  },
  {
    id: 'gender',
    label: 'Gender',
    type: 'select',
    category: 'Demographics',
    operators: ['equals', 'not_equals'],
    options: [
      { label: 'Male', value: 'male' },
      { label: 'Female', value: 'female' },
      { label: 'Other', value: 'other' }
    ]
  },
  
  // Technologies
  {
    id: 'technologies',
    label: 'Technologies',
    type: 'multiselect',
    category: 'Technologies',
    operators: ['in', 'not_in'],
    options: []
  },
  
  // Time-based
  {
    id: 'added_on',
    label: 'Added on',
    type: 'date',
    category: 'Time-based',
    operators: ['less_than', 'greater_than', 'between'],
    unit: 'days ago'
  }
];
