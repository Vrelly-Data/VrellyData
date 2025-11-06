import { PersonEntity, CompanyEntity } from '@/types/audience';

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
 * Converts array of objects to CSV string
 */
function convertToCSV(data: any[], headers: string[]): string {
  const headerRow = headers.join(',');
  
  const dataRows = data.map(item => {
    return headers.map(header => {
      const key = header.toLowerCase().replace(/ /g, '');
      let value = item[key];
      
      // Handle arrays (like technologies)
      if (Array.isArray(value)) {
        value = value.join('; ');
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
  // Verification: Ensure we're exporting full data
  console.log('[CSV EXPORT VERIFICATION]', {
    totalRecords: people.length,
    sampleRecord: people[0],
    allHaveEmails: people.every(p => p.email),
  });
  
  const headers = [
    'ID',
    'Name',
    'Title',
    'Seniority',
    'Department',
    'Company',
    'Location',
    'Email',
    'Phone',
    'LinkedIn',
  ];
  
  const csvContent = convertToCSV(people, headers);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `people-export-${timestamp}.csv`;
  
  downloadCSV(csvContent, filename);
}

/**
 * Exports company data to CSV
 */
export function exportCompaniesToCSV(companies: CompanyEntity[]): void {
  // Verification: Ensure we're exporting full data
  console.log('[CSV EXPORT VERIFICATION]', {
    totalRecords: companies.length,
    sampleRecord: companies[0],
  });
  
  const headers = [
    'ID',
    'Name',
    'Domain',
    'Industry',
    'Employee Count',
    'Revenue',
    'Location',
    'Technologies',
    'Funding Stage',
  ];
  
  const csvContent = convertToCSV(companies, headers);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `companies-export-${timestamp}.csv`;
  
  downloadCSV(csvContent, filename);
}
