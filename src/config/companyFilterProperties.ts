import { PropertyDefinition } from '@/types/filterProperties';

export const COMPANY_FILTER_PROPERTIES: PropertyDefinition[] = [
  // Basic Information
  {
    id: 'name',
    label: 'Company Name',
    type: 'multiselect',
    category: 'Basic Information',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  {
    id: 'accountStage',
    label: 'Account Stage',
    type: 'multiselect',
    category: 'Basic Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
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
  {
    id: 'keywords',
    label: 'Keywords',
    type: 'multiselect',
    category: 'Basic Information',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  
  // Company Size & Structure
  {
    id: 'companySize',
    label: 'Company Size',
    type: 'multiselect',
    category: 'Company Size',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: '1-10', value: '1-10' },
      { label: '11-50', value: '11-50' },
      { label: '51-200', value: '51-200' },
      { label: '201-500', value: '201-500' },
      { label: '501-1000', value: '501-1000' },
      { label: '1001-5000', value: '1001-5000' },
      { label: '5001-10000', value: '5001-10000' },
      { label: '10000+', value: '10000+' },
    ]
  },
  {
    id: 'numberOfRetailLocations',
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
    id: 'sicCodes',
    label: 'SIC Codes',
    type: 'multiselect',
    category: 'Industry & Classification',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  {
    id: 'naicsCodes',
    label: 'NAICS Codes',
    type: 'multiselect',
    category: 'Industry & Classification',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
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
    id: 'linkedinUrl',
    label: 'Company LinkedIn URL',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter LinkedIn URL'
  },
  {
    id: 'facebookUrl',
    label: 'Facebook URL',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Facebook URL'
  },
  {
    id: 'twitterUrl',
    label: 'Twitter URL',
    type: 'url',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Twitter URL'
  },
  {
    id: 'phone',
    label: 'Company Phone',
    type: 'text',
    category: 'Contact Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter phone number'
  },
  
  // Location
  {
    id: 'street',
    label: 'Company Street',
    type: 'text',
    category: 'Location',
    operators: ['contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter street address'
  },
  {
    id: 'city',
    label: 'Company City',
    type: 'multiselect',
    category: 'Location',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: [
      { label: 'New York', value: 'New York' },
      { label: 'Los Angeles', value: 'Los Angeles' },
      { label: 'Chicago', value: 'Chicago' },
      { label: 'San Francisco', value: 'San Francisco' },
      { label: 'Boston', value: 'Boston' },
      { label: 'Seattle', value: 'Seattle' },
      { label: 'Austin', value: 'Austin' },
      { label: 'Denver', value: 'Denver' },
      { label: 'Miami', value: 'Miami' },
      { label: 'Atlanta', value: 'Atlanta' },
      { label: 'London', value: 'London' },
      { label: 'Toronto', value: 'Toronto' },
    ]
  },
  {
    id: 'state',
    label: 'Company State',
    type: 'multiselect',
    category: 'Location',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: [
      { label: 'California', value: 'California' },
      { label: 'New York', value: 'New York' },
      { label: 'Texas', value: 'Texas' },
      { label: 'Florida', value: 'Florida' },
      { label: 'Illinois', value: 'Illinois' },
      { label: 'Pennsylvania', value: 'Pennsylvania' },
      { label: 'Ohio', value: 'Ohio' },
      { label: 'Georgia', value: 'Georgia' },
      { label: 'Massachusetts', value: 'Massachusetts' },
      { label: 'Washington', value: 'Washington' },
      { label: 'Colorado', value: 'Colorado' },
      { label: 'Arizona', value: 'Arizona' },
    ]
  },
  {
    id: 'country',
    label: 'Company Country',
    type: 'multiselect',
    category: 'Location',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: [
      { label: 'United States', value: 'United States' },
      { label: 'United Kingdom', value: 'United Kingdom' },
      { label: 'Canada', value: 'Canada' },
      { label: 'Germany', value: 'Germany' },
      { label: 'France', value: 'France' },
      { label: 'Australia', value: 'Australia' },
      { label: 'India', value: 'India' },
      { label: 'Brazil', value: 'Brazil' },
      { label: 'Netherlands', value: 'Netherlands' },
      { label: 'Spain', value: 'Spain' },
    ]
  },
  {
    id: 'postalCode',
    label: 'Company Postal Code',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'starts_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter postal code'
  },
  {
    id: 'address',
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
    options: [
      { label: 'React', value: 'React' },
      { label: 'Salesforce', value: 'Salesforce' },
      { label: 'HubSpot', value: 'HubSpot' },
      { label: 'AWS', value: 'AWS' },
      { label: 'Google Analytics', value: 'Google Analytics' },
      { label: 'Shopify', value: 'Shopify' },
      { label: 'WordPress', value: 'WordPress' },
      { label: 'Slack', value: 'Slack' },
      { label: 'Zoom', value: 'Zoom' },
      { label: 'Microsoft 365', value: 'Microsoft 365' },
      { label: 'Zendesk', value: 'Zendesk' },
      { label: 'Mailchimp', value: 'Mailchimp' },
      { label: 'Intercom', value: 'Intercom' },
      { label: 'Stripe', value: 'Stripe' },
      { label: 'Segment', value: 'Segment' },
    ]
  },
  
  // Financial Information
  {
    id: 'totalFunding',
    label: 'Total Funding',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  {
    id: 'latestFunding',
    label: 'Latest Funding Stage',
    type: 'multiselect',
    category: 'Financial Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Pre-Seed', value: 'Pre-Seed' },
      { label: 'Seed', value: 'Seed' },
      { label: 'Series A', value: 'Series A' },
      { label: 'Series B', value: 'Series B' },
      { label: 'Series C', value: 'Series C' },
      { label: 'Series D', value: 'Series D' },
      { label: 'Series E+', value: 'Series E+' },
      { label: 'IPO', value: 'IPO' },
      { label: 'Acquired', value: 'Acquired' },
      { label: 'Private Equity', value: 'Private Equity' },
    ]
  },
  {
    id: 'latestFundingAmount',
    label: 'Latest Funding Amount',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  {
    id: 'lastRaisedAt',
    label: 'Last Raised At',
    type: 'date',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Select date'
  },
  {
    id: 'annualRevenue',
    label: 'Annual Revenue',
    type: 'currency',
    category: 'Financial Information',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter amount',
    unit: 'USD'
  },
  {
    id: 'revenue',
    label: 'Revenue Range',
    type: 'multiselect',
    category: 'Financial Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Under $1M', value: 'Under $1M' },
      { label: '$1M - $10M', value: '$1M - $10M' },
      { label: '$10M - $50M', value: '$10M - $50M' },
      { label: '$50M - $100M', value: '$50M - $100M' },
      { label: '$100M - $500M', value: '$100M - $500M' },
      { label: '$500M - $1B', value: '$500M - $1B' },
      { label: '$1B+', value: '$1B+' },
    ]
  },
  
  // Company Profile
  {
    id: 'foundedYear',
    label: 'Founded Year',
    type: 'number',
    category: 'Company Profile',
    operators: ['equals', 'less_than', 'greater_than', 'between'],
    placeholder: 'Enter year'
  },
  {
    id: 'logoUrl',
    label: 'Logo URL',
    type: 'url',
    category: 'Company Profile',
    operators: ['is_empty', 'is_not_empty'],
  },
  {
    id: 'subsidiaryOf',
    label: 'Subsidiary of',
    type: 'multiselect',
    category: 'Company Profile',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  
  // Time-based
  {
    id: 'addedOn',
    label: 'Added on',
    type: 'date',
    category: 'Time-based',
    operators: ['less_than', 'greater_than', 'between'],
    placeholder: 'Select date',
    unit: 'days ago'
  }
];
