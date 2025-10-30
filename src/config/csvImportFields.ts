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
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'li url', 'person linkedin', 'personal linkedin']
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
    aliases: ['company size', 'employees', 'employee count', 'size', 'headcount', 'number of employees']
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
    id: 'industry',
    label: 'Industry',
    aliases: ['industry', 'sector', 'vertical', 'business type']
  },
  {
    id: 'employeeCount',
    label: 'Company Size',
    aliases: ['company size', 'employees', 'employee count', 'size', 'headcount', 'number of employees', 'employeecount']
  },
  {
    id: 'linkedin',
    label: 'Company LinkedIn Profile',
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'li url', 'company linkedin']
  },
  {
    id: 'phone',
    label: 'Company Phone',
    aliases: ['phone', 'telephone', 'company phone', 'office phone', 'phone number']
  },
  {
    id: 'location',
    label: 'Location',
    aliases: ['location', 'address', 'full address', 'headquarters']
  },
  {
    id: 'city',
    label: 'City',
    aliases: ['city', 'town', 'locality']
  },
  {
    id: 'state',
    label: 'State',
    aliases: ['state', 'province', 'region', 'state/province']
  },
  {
    id: 'country',
    label: 'Country',
    aliases: ['country', 'nation']
  }
];
