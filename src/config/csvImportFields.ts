import { SystemField } from '@/types/csvImport';

export const PERSON_IMPORT_FIELDS: SystemField[] = [
  {
    id: 'firstName',
    label: 'First Name',
    required: true,
    aliases: ['first name', 'firstname', 'first_name', 'fname', 'given name']
  },
  {
    id: 'lastName',
    label: 'Last Name',
    required: true,
    aliases: ['last name', 'lastname', 'last_name', 'lname', 'surname', 'family name']
  },
  {
    id: 'personalEmail',
    label: 'Person Personal Email',
    aliases: ['personal email', 'private email', 'home email', 'personal e-mail', 'secondary email', 'alternate email']
  },
  {
    id: 'businessEmail',
    label: 'Person Business Email',
    aliases: ['business email', 'work email', 'corporate email', 'professional email', 'office email', 'company email address', 'email', 'email address', 'e-mail', 'mail', 'primary email']
  },
  {
    id: 'title',
    label: 'Title',
    aliases: ['title', 'job title', 'jobtitle', 'job_title', 'position', 'role']
  },
  {
    id: 'phone',
    label: 'Mobile Phone',
    aliases: ['mobile', 'mobile phone', 'phone', 'cell', 'telephone', 'cell phone', 'mobile number', 'phone number']
  },
  {
    id: 'company',
    label: 'Company Name',
    aliases: ['company', 'company name', 'organization', 'employer', 'company_name']
  },
  {
    id: 'website',
    label: 'Website',
    aliases: ['website', 'web site', 'url', 'web', 'site']
  },
  {
    id: 'linkedin',
    label: 'Person LinkedIn Profile',
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'li url', 'person linkedin', 'personal linkedin', 'person linkedin url']
  },
  {
    id: 'companyLinkedin',
    label: 'Company LinkedIn Profile',
    aliases: ['company linkedin', 'company linkedin url', 'company li', 'organization linkedin']
  },
  {
    id: 'industry',
    label: 'Industry',
    aliases: ['industry', 'sector', 'vertical', 'business type']
  },
  {
    id: 'companyPhone',
    label: 'Company Phone',
    aliases: ['company phone', 'office phone', 'work phone', 'company number', 'office number']
  },
  {
    id: 'city',
    label: 'Person City',
    aliases: ['city', 'person city', 'town', 'locality']
  },
  {
    id: 'state',
    label: 'Person State',
    aliases: ['state', 'province', 'region', 'person state', 'state/province']
  },
  {
    id: 'country',
    label: 'Person Country',
    aliases: ['country', 'nation', 'person country']
  },
  {
    id: 'companySize',
    label: 'Company Size',
    aliases: ['company size', 'employees', 'employee count', 'size', 'headcount', 'number of employees', '# employees', 'no of employees']
  },
  {
    id: 'address',
    label: 'Person Address',
    aliases: ['address', 'person address', 'street', 'street address']
  },
  {
    id: 'zipCode',
    label: 'Person Zip',
    aliases: ['zip', 'zipcode', 'zip code', 'postal code', 'person zip']
  },
  {
    id: 'age',
    label: 'Person Age',
    aliases: ['age', 'person age']
  },
  {
    id: 'children',
    label: 'Children',
    aliases: ['children', 'has children', 'kids', 'number of children']
  },
  {
    id: 'gender',
    label: 'Gender',
    aliases: ['gender', 'sex']
  },
  {
    id: 'homeowner',
    label: 'Homeowner',
    aliases: ['homeowner', 'home owner', 'owns home']
  },
  {
    id: 'married',
    label: 'Married',
    aliases: ['married', 'marital status', 'marriage status']
  },
  {
    id: 'netWorth',
    label: 'Net Worth',
    aliases: ['net worth', 'networth', 'net_worth', 'wealth']
  },
  {
    id: 'incomeRange',
    label: 'Income Range',
    aliases: ['income', 'income range', 'salary', 'annual income']
  },
  {
    id: 'department',
    label: 'Department',
    aliases: ['department', 'dept', 'team', 'division']
  },
  {
    id: 'seniority',
    label: 'Seniority',
    aliases: ['seniority', 'level', 'job level', 'career level']
  },
  {
    id: 'twitterUrl',
    label: 'Person Twitter URL',
    aliases: ['twitter', 'twitter url', 'twitter profile', 'x url']
  },
  {
    id: 'facebookUrl',
    label: 'Person Facebook URL',
    aliases: ['facebook', 'facebook url', 'facebook profile', 'fb url']
  },
  {
    id: 'skills',
    label: 'Person Skills',
    aliases: ['skills', 'person skills', 'expertise']
  },
  {
    id: 'interests',
    label: 'Person Interests',
    aliases: ['interests', 'person interests', 'hobbies']
  },
  {
    id: 'educationHistory',
    label: 'Education History',
    aliases: ['education', 'education history', 'school', 'university', 'college', 'degree', 'alma mater', 'educational background']
  },
  {
    id: 'technologies',
    label: 'Technologies',
    aliases: ['technologies', 'tech stack', 'tools', 'platforms', 'technology', 'tech', 'software used']
  },
  {
    id: 'custom',
    label: 'Custom Field (Keep Original Name)',
    required: false,
    aliases: []
  }
];

export const COMPANY_IMPORT_FIELDS: SystemField[] = [
  {
    id: 'name',
    label: 'Company Name',
    required: true,
    aliases: ['company', 'company name', 'name', 'organization', 'business name']
  },
  {
    id: 'domain',
    label: 'Website',
    aliases: ['website', 'domain', 'url', 'web', 'site', 'web address']
  },
  {
    id: 'companyIndustry',
    label: 'Company Industry',
    aliases: ['industry', 'sector', 'vertical', 'business type', 'company industry']
  },
  {
    id: 'employeeCount',
    label: 'Company Size',
    aliases: ['company size', 'employees', 'employee count', 'size', 'headcount', 'number of employees', 'employeecount']
  },
  {
    id: 'companyLinkedinUrl',
    label: 'Company LinkedIn Profile',
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'li url', 'company linkedin', 'company linkedin url']
  },
  {
    id: 'companyPhoneNumber',
    label: 'Company Phone',
    aliases: ['phone', 'telephone', 'company phone', 'office phone', 'phone number', 'company phone number']
  },
  {
    id: 'email',
    label: 'Company Email',
    aliases: ['email', 'company email', 'contact email', 'corporate email', 'business email', 'info email']
  },
  {
    id: 'location',
    label: 'Location',
    aliases: ['location', 'address', 'full address', 'headquarters']
  },
{
    id: 'companyCity',
    label: 'Company City',
    aliases: ['city', 'company city', 'town', 'locality', 'hq city', 'headquarters city']
  },
  {
    id: 'companyState',
    label: 'Company State',
    aliases: ['state', 'company state', 'province', 'region', 'state/province', 'hq state', 'headquarters state']
  },
  {
    id: 'companyCountry',
    label: 'Company Country',
    aliases: ['country', 'company country', 'nation', 'hq country', 'headquarters country']
  },
  {
    id: 'companyZipCode',
    label: 'Company Zip',
    aliases: ['zip', 'zipcode', 'zip code', 'postal code', 'company zip', 'hq zip', 'headquarters zip']
  },
  {
    id: 'companyDescription',
    label: 'Company Description',
    aliases: ['description', 'company description', 'about', 'bio', 'summary', 'company bio', 'company about']
  },
  {
    id: 'companyRevenue',
    label: 'Company Revenue',
    aliases: ['revenue', 'annual revenue', 'company revenue', 'sales', 'yearly revenue']
  },
  {
    id: 'companySic',
    label: 'Company SIC',
    aliases: ['sic', 'sic code', 'standard industrial classification', 'sic number']
  },
  {
    id: 'companyNaics',
    label: 'Company NAICS',
    aliases: ['naics', 'naics code', 'north american industry classification', 'naics number']
  },
  {
    id: 'technologies',
    label: 'Company Technologies',
    aliases: ['technologies', 'tech stack', 'tools', 'platforms', 'technology', 'tech', 'software used', 'company technologies']
  },
  {
    id: 'fundingStage',
    label: 'Funding / Funding Stage',
    aliases: ['funding', 'funding stage', 'funding round', 'investment stage', 'series', 'funding status', 'funding level']
  },
  {
    id: 'companyAddress',
    label: 'Company Address',
    aliases: ['company address', 'company street', 'company street address', 'hq address', 'headquarters address', 'office address', 'business address']
  },
  {
    id: 'custom',
    label: 'Custom Field (Keep Original Name)',
    required: false,
    aliases: []
  }
];
