export interface CSVFieldMapping {
  csvHeader: string;
  systemField: string | null;
  preview: string[]; // First 3 values for preview
}

export interface CSVImportConfig {
  entityType: 'person' | 'company';
  mappings: CSVFieldMapping[];
  totalRows: number;
  parsedData: any[];
}

export interface SystemField {
  id: string;
  label: string;
  required?: boolean;
  aliases?: string[];
}
