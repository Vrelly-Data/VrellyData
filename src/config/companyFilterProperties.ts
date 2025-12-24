import { PropertyDefinition } from '@/types/filterProperties';

export const COMPANY_FILTER_PROPERTIES: PropertyDefinition[] = [
  // Basic Information
  {
    id: 'company_name',
    label: 'Company Name',
    type: 'text',
    category: 'Basic Information',
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter company name'
  },
  {
    id: 'account_stage',
    label: 'Account Stage',
    type: 'select',
    category: 'Basic Information',
    operators: ['equals', 'not_equals', 'in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Lead', value: 'lead' },
      { label: 'Prospect', value: 'prospect' },
      { label: 'Customer', value: 'customer' },
      { label: 'Former Customer', value: 'former_customer' }
    ]
  },
  {
    id: 'lists',
    label: 'Lists',
    type: 'multiselect',
    category: 'Basic Information',
    operators: ['in', 'not_in'],
    options: []
  },
  
  // Company Size & Structure
  {
    id: 'num_employees',
    label: '# Employees',
    type: 'number',
    category: 'Company Size',
    operators: ['equals', 'not_equals', 'less_than', 'greater_than', 'less_than_or_equal', 'greater_than_or_equal', 'between'],
    placeholder: 'Enter number'
  },
  {
    id: 'number_of_retail_locations',
    label: 'Number of Retail Locations',
    type: 'number',
    category: 'Company Size',
    operators: ['equals', 'not_equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter number'
  },
  
  // Industry & Classification
  {
    id: 'industry',
    label: 'Industry',
    type: 'multiselect',
    category: 'Industry & Classification',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Software', value: 'Software' },
      { label: 'Technology', value: 'Technology' },
      { label: 'Healthcare', value: 'Healthcare' },
      { label: 'Finance', value: 'Finance' },
      { label: 'Manufacturing', value: 'Manufacturing' },
      { label: 'Retail', value: 'Retail' },
      { label: 'E-commerce', value: 'E-commerce' },
      { label: 'Education', value: 'Education' },
      { label: 'Marketing', value: 'Marketing' },
      { label: 'Consulting', value: 'Consulting' },
      { label: 'Real Estate', value: 'Real Estate' },
      { label: 'Media', value: 'Media' },
      { label: 'Telecommunications', value: 'Telecommunications' },
      { label: 'Insurance', value: 'Insurance' },
      { label: 'Construction', value: 'Construction' },
    ]
  },
  {
    id: 'sic_codes',
    label: 'SIC Codes',
    type: 'text',
    category: 'Industry & Classification',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter SIC code'
  },
  {
    id: 'naics_codes',
    label: 'NAICS Codes',
    type: 'text',
    category: 'Industry & Classification',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter NAICS code'
  },
  {
    id: 'keywords',
    label: 'Keywords',
    type: 'text',
    category: 'Industry & Classification',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter keywords'
  },
  
  // Contact Information
  {
    id: 'website',
    label: 'Website',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'ends_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter website URL'
  },
  {
    id: 'company_linkedin_url',
    label: 'Company LinkedIn URL',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter LinkedIn URL'
  },
  {
    id: 'facebook_url',
    label: 'Facebook URL',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Facebook URL'
  },
  {
    id: 'twitter_url',
    label: 'Twitter URL',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Twitter URL'
  },
  {
    id: 'company_phone',
    label: 'Company Phone',
    type: 'text',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter phone number'
  },
  
  // Location
  {
    id: 'company_street',
    label: 'Company Street',
    type: 'text',
    category: 'Location',
    operators: ['contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter street address'
  },
  {
    id: 'company_city',
    label: 'Company City',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'contains', 'in', 'not_in'],
    placeholder: 'Enter city'
  },
  {
    id: 'company_state',
    label: 'Company State',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'in', 'not_in'],
    placeholder: 'Enter state'
  },
  {
    id: 'company_country',
    label: 'Company Country',
    type: 'select',
    category: 'Location',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    options: [
      { label: 'United States', value: 'US' },
      { label: 'United Kingdom', value: 'UK' },
      { label: 'Canada', value: 'CA' },
      { label: 'Germany', value: 'DE' },
      { label: 'France', value: 'FR' },
    ]
  },
  {
    id: 'company_postal_code',
    label: 'Company Postal Code',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'starts_with'],
    placeholder: 'Enter postal code'
  },
  {
    id: 'company_address',
    label: 'Company Address',
    type: 'text',
    category: 'Location',
    operators: ['contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter full address'
  },
  
  // Technology & Tools
  {
    id: 'technologies',
    label: 'Technologies',
    type: 'multiselect',
    category: 'Technology',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  
  // Financial Information
  {
    id: 'total_funding',
    label: 'Total Funding',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  {
    id: 'latest_funding',
    label: 'Latest Funding',
    type: 'text',
    category: 'Financial Information',
    operators: ['equals', 'contains'],
    placeholder: 'e.g., Series A'
  },
  {
    id: 'latest_funding_amount',
    label: 'Latest Funding Amount',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  {
    id: 'last_raised_at',
    label: 'Last Raised At',
    type: 'date',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Select date'
  },
  {
    id: 'annual_revenue',
    label: 'Annual Revenue',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  {
    id: 'revenue',
    label: 'Revenue',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  
  // Company Profile
  {
    id: 'account_owner',
    label: 'Account Owner',
    type: 'select',
    category: 'Company Profile',
    operators: ['equals', 'not_equals', 'is_known', 'is_unknown'],
    options: []
  },
  {
    id: 'short_description',
    label: 'Short Description',
    type: 'text',
    category: 'Company Profile',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Search description'
  },
  {
    id: 'founded_year',
    label: 'Founded Year',
    type: 'number',
    category: 'Company Profile',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter year'
  },
  {
    id: 'logo_url',
    label: 'Logo URL',
    type: 'url',
    category: 'Company Profile',
    operators: ['is_empty', 'is_not_empty'],
  },
  {
    id: 'subsidiary_of',
    label: 'Subsidiary of',
    type: 'text',
    category: 'Company Profile',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter parent company'
  },
  {
    id: 'apollo_account_id',
    label: 'Apollo Account ID',
    type: 'text',
    category: 'Company Profile',
    operators: ['equals', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Apollo ID'
  },
  {
    id: 'b2b_ecommerce',
    label: 'B2B eCommerce?',
    type: 'boolean',
    category: 'Company Profile',
    operators: ['equals'],
  },
  
  // Time-based
  {
    id: 'added_on',
    label: 'Added on',
    type: 'date',
    category: 'Time-based',
    operators: ['less_than', 'greater_than', 'between'],
    placeholder: 'Select date',
    unit: 'days ago'
  }
];
