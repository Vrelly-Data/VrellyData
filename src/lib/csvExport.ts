import { PersonEntity, CompanyEntity } from '@/types/audience';

/**
 * Field mapping for person CSV export
 */
const PERSON_FIELD_MAP: { header: string; key: keyof PersonEntity }[] = [
  // Basic Info
  { header: 'ID', key: 'id' },
  { header: 'First Name', key: 'firstName' },
  { header: 'Last Name', key: 'lastName' },
  { header: 'Full Name', key: 'name' },
  
  // Professional
  { header: 'Title', key: 'title' },
  { header: 'Job Title', key: 'jobTitle' },
  { header: 'Seniority', key: 'seniority' },
  { header: 'Department', key: 'department' },
  
  // Company Info
  { header: 'Company', key: 'company' },
  { header: 'Company Size', key: 'companySize' },
  { header: 'Industry', key: 'industry' },
  { header: 'Company Revenue', key: 'companyRevenue' },
  { header: 'Company Description', key: 'companyDescription' },
  { header: 'Company SIC', key: 'companySic' },
  { header: 'Company NAICS', key: 'companyNaics' },
  
  // Contact Info
  { header: 'Business Email', key: 'businessEmail' },
  { header: 'Personal Email', key: 'personalEmail' },
  { header: 'Phone', key: 'phone' },
  { header: 'Direct Number', key: 'directNumber' },
  { header: 'LinkedIn URL', key: 'linkedinUrl' },
  { header: 'Facebook URL', key: 'facebookUrl' },
  { header: 'Twitter URL', key: 'twitterUrl' },
  { header: 'Website', key: 'website' },
  { header: 'Company LinkedIn', key: 'companyLinkedin' },
  { header: 'Company Phone', key: 'companyPhone' },
  
  // Person Location
  { header: 'Address', key: 'address' },
  { header: 'City', key: 'city' },
  { header: 'State', key: 'state' },
  { header: 'Country', key: 'country' },
  { header: 'Zip Code', key: 'zipCode' },
  
  // Company Location
  { header: 'Company City', key: 'companyCity' },
  { header: 'Company State', key: 'companyState' },
  { header: 'Company Country', key: 'companyCountry' },
  { header: 'Company Zip Code', key: 'companyZipCode' },
  
  // Demographics
  { header: 'Age', key: 'age' },
  { header: 'Gender', key: 'gender' },
  { header: 'Married', key: 'married' },
  { header: 'Children', key: 'children' },
  { header: 'Homeowner', key: 'homeowner' },
  { header: 'Net Worth', key: 'netWorth' },
  { header: 'Income Range', key: 'incomeRange' },
  
  // Additional
  { header: 'Skills', key: 'skills' },
  { header: 'Interests', key: 'interests' },
  { header: 'Education History', key: 'educationHistory' },
  { header: 'Technologies', key: 'technologies' },
  { header: 'Keywords', key: 'keywords' },
];

/**
 * Field mapping for company CSV export
 */
const COMPANY_FIELD_MAP: { header: string; key: keyof CompanyEntity }[] = [
  // Basic Info
  { header: 'ID', key: 'id' },
  { header: 'Name', key: 'name' },
  { header: 'Domain', key: 'domain' },
  { header: 'Description', key: 'description' },
  
  // Business Info
  { header: 'Industry', key: 'industry' },
  { header: 'Employee Count', key: 'employeeCount' },
  { header: 'Company Size', key: 'companySize' },
  { header: 'Revenue', key: 'revenue' },
  { header: 'Funding Stage', key: 'fundingStage' },
  { header: 'SIC', key: 'sic' },
  { header: 'NAICS', key: 'naics' },
  
  // Contact Info
  { header: 'Email', key: 'email' },
  { header: 'Phone', key: 'phone' },
  { header: 'LinkedIn', key: 'linkedin' },
  
  // Location
  { header: 'Location', key: 'location' },
  { header: 'Address', key: 'companyAddress' },
  { header: 'City', key: 'city' },
  { header: 'State', key: 'state' },
  { header: 'Country', key: 'country' },
  { header: 'Zip Code', key: 'zipCode' },
  
  // Additional
  { header: 'Technologies', key: 'technologies' },
  { header: 'Keywords', key: 'keywords' },
];

/**
 * Escapes special characters for CSV format
 */
function escapeCSVValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const stringValue = String(value);
  
  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  
  return stringValue;
}

/**
 * Converts array of objects to CSV string using explicit field mapping
 */
function convertToCSV<T>(data: T[], fieldMap: { header: string; key: keyof T }[]): string {
  const headers = fieldMap.map(f => f.header);
  const headerRow = headers.join(',');
  
  const dataRows = data.map(item => {
    return fieldMap.map(field => {
      let value = item[field.key];
      
      // Handle arrays (like technologies, keywords)
      if (Array.isArray(value)) {
        value = value.join('; ') as any;
      }
      
      return escapeCSVValue(value);
    }).join(',');
  });
  
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Triggers browser download of CSV content
 */
function downloadCSV(csvContent: string, filename: string): void {
  // Add UTF-8 BOM for Excel compatibility
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Exports people data to CSV
 */
export function exportPeopleToCSV(people: PersonEntity[]): void {
  console.log('[CSV EXPORT]', {
    totalRecords: people.length,
    sampleRecord: people[0],
    fieldsExported: PERSON_FIELD_MAP.length,
  });
  
  const csvContent = convertToCSV(people, PERSON_FIELD_MAP);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `people-export-${timestamp}.csv`;
  
  downloadCSV(csvContent, filename);
}

/**
 * Exports company data to CSV
 */
export function exportCompaniesToCSV(companies: CompanyEntity[]): void {
  console.log('[CSV EXPORT]', {
    totalRecords: companies.length,
    sampleRecord: companies[0],
    fieldsExported: COMPANY_FIELD_MAP.length,
  });
  
  const csvContent = convertToCSV(companies, COMPANY_FIELD_MAP);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `companies-export-${timestamp}.csv`;
  
  downloadCSV(csvContent, filename);
}
