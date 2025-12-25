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
    id: 'personalEmail',
    label: 'Personal Email',
    type: 'text',
    category: 'Basic Information',
    operators: ['equals', 'contains', 'ends_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter personal email'
  },
  {
    id: 'businessEmail',
    label: 'Business Email',
    type: 'text',
    category: 'Basic Information',
    operators: ['equals', 'contains', 'ends_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter business email'
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
  {
    id: 'keywords',
    label: 'Keywords',
    type: 'text',
    category: 'Basic Information',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Search keywords...'
  },
  
  // Job Information
  {
    id: 'title',
    label: 'Job Title',
    type: 'text',
    category: 'Job Information',
    operators: ['contains', 'not_contains', 'equals', 'is_empty', 'is_not_empty'],
    placeholder: 'Search job titles...'
  },
  {
    id: 'seniority',
    label: 'Seniority',
    type: 'multiselect',
    category: 'Job Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'C-Level', value: 'C-Level' },
      { label: 'VP', value: 'VP' },
      { label: 'Director', value: 'Director' },
      { label: 'Manager', value: 'Manager' },
      { label: 'Senior', value: 'Senior' },
      { label: 'Entry Level', value: 'Entry Level' },
      { label: 'Intern', value: 'Intern' },
    ]
  },
  {
    id: 'department',
    label: 'Department',
    type: 'multiselect',
    category: 'Job Information',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Sales', value: 'Sales' },
      { label: 'Marketing', value: 'Marketing' },
      { label: 'Engineering', value: 'Engineering' },
      { label: 'Product', value: 'Product' },
      { label: 'Finance', value: 'Finance' },
      { label: 'HR', value: 'HR' },
      { label: 'Human Resources', value: 'Human Resources' },
      { label: 'Operations', value: 'Operations' },
      { label: 'Legal', value: 'Legal' },
      { label: 'IT', value: 'IT' },
      { label: 'Customer Success', value: 'Customer Success' },
      { label: 'Support', value: 'Support' },
      { label: 'Executive', value: 'Executive' },
    ]
  },
  
  // Company Information
  {
    id: 'company',
    label: 'Company',
    type: 'multiselect',
    category: 'Company Information',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  {
    id: 'companySize',
    label: 'Company Size',
    type: 'multiselect',
    category: 'Company Information',
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
    id: 'industry',
    label: 'Industry',
    type: 'multiselect',
    category: 'Company Information',
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
    id: 'companyLinkedin',
    label: 'Company LinkedIn',
    type: 'url',
    category: 'Company Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter company LinkedIn URL'
  },
  {
    id: 'companyPhone',
    label: 'Company Phone',
    type: 'text',
    category: 'Company Information',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter company phone'
  },
  
  // Location
  {
    id: 'location',
    label: 'Location',
    type: 'multiselect',
    category: 'Location',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: []
  },
  {
    id: 'city',
    label: 'City',
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
    label: 'State',
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
    label: 'Country',
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
    id: 'zipCode',
    label: 'Zip Code',
    type: 'text',
    category: 'Location',
    operators: ['equals', 'starts_with', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter zip code'
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
  {
    id: 'twitterUrl',
    label: 'Twitter URL',
    type: 'url',
    category: 'Social',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Twitter URL'
  },
  {
    id: 'facebookUrl',
    label: 'Facebook URL',
    type: 'url',
    category: 'Social',
    operators: ['equals', 'contains', 'is_empty', 'is_not_empty'],
    placeholder: 'Enter Facebook URL'
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
    type: 'multiselect',
    category: 'Demographics',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Male', value: 'male' },
      { label: 'Female', value: 'female' },
      { label: 'Other', value: 'other' }
    ]
  },
  {
    id: 'incomeRange',
    label: 'Income Range',
    type: 'multiselect',
    category: 'Demographics',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Under $25,000', value: 'Under $25,000' },
      { label: '$25,000 - $50,000', value: '$25,000 - $50,000' },
      { label: '$50,000 - $75,000', value: '$50,000 - $75,000' },
      { label: '$75,000 - $100,000', value: '$75,000 - $100,000' },
      { label: '$100,000 - $150,000', value: '$100,000 - $150,000' },
      { label: '$150,000 - $200,000', value: '$150,000 - $200,000' },
      { label: '$200,000+', value: '$200,000+' },
    ]
  },
  {
    id: 'netWorth',
    label: 'Net Worth',
    type: 'multiselect',
    category: 'Demographics',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Under $100,000', value: 'Under $100,000' },
      { label: '$100,000 - $500,000', value: '$100,000 - $500,000' },
      { label: '$500,000 - $1,000,000', value: '$500,000 - $1,000,000' },
      { label: '$1,000,000 - $5,000,000', value: '$1,000,000 - $5,000,000' },
      { label: '$5,000,000+', value: '$5,000,000+' },
    ]
  },
  {
    id: 'education',
    label: 'Education',
    type: 'multiselect',
    category: 'Demographics',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'High School', value: 'High School' },
      { label: 'Some College', value: 'Some College' },
      { label: "Associate's Degree", value: "Associate's Degree" },
      { label: "Bachelor's Degree", value: "Bachelor's Degree" },
      { label: "Master's Degree", value: "Master's Degree" },
      { label: 'PhD', value: 'PhD' },
      { label: 'MBA', value: 'MBA' },
    ]
  },
  {
    id: 'children',
    label: 'Has Children',
    type: 'multiselect',
    category: 'Demographics',
    operators: ['in', 'not_in', 'is_known', 'is_unknown'],
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]
  },
  {
    id: 'homeowner',
    label: 'Homeowner',
    type: 'boolean',
    category: 'Demographics',
    operators: ['equals', 'is_known', 'is_unknown'],
  },
  {
    id: 'married',
    label: 'Married',
    type: 'boolean',
    category: 'Demographics',
    operators: ['equals', 'is_known', 'is_unknown'],
  },
  
  // Skills & Interests
  {
    id: 'skills',
    label: 'Skills',
    type: 'multiselect',
    category: 'Skills & Interests',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: [
      { label: 'JavaScript', value: 'JavaScript' },
      { label: 'Python', value: 'Python' },
      { label: 'React', value: 'React' },
      { label: 'Sales', value: 'Sales' },
      { label: 'Marketing', value: 'Marketing' },
      { label: 'Leadership', value: 'Leadership' },
      { label: 'Project Management', value: 'Project Management' },
      { label: 'Data Analysis', value: 'Data Analysis' },
      { label: 'Communication', value: 'Communication' },
      { label: 'Negotiation', value: 'Negotiation' },
    ]
  },
  {
    id: 'interests',
    label: 'Interests',
    type: 'multiselect',
    category: 'Skills & Interests',
    operators: ['in', 'not_in', 'is_empty', 'is_not_empty'],
    options: [
      { label: 'Technology', value: 'Technology' },
      { label: 'Finance', value: 'Finance' },
      { label: 'Sports', value: 'Sports' },
      { label: 'Travel', value: 'Travel' },
      { label: 'Music', value: 'Music' },
      { label: 'Reading', value: 'Reading' },
      { label: 'Entrepreneurship', value: 'Entrepreneurship' },
      { label: 'Health & Fitness', value: 'Health & Fitness' },
    ]
  },
  
  // Technologies
  {
    id: 'technologies',
    label: 'Technologies',
    type: 'multiselect',
    category: 'Technologies',
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
    ]
  },
  
  // Time-based
  {
    id: 'addedOn',
    label: 'Added on',
    type: 'date',
    category: 'Time-based',
    operators: ['less_than', 'greater_than', 'between'],
    unit: 'days ago'
  }
];
