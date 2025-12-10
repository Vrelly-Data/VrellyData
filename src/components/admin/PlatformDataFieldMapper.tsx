import { useState, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PERSON_IMPORT_FIELDS, COMPANY_IMPORT_FIELDS } from '@/config/csvImportFields';
import { autoMapFields } from '@/lib/csvImportMapper';

export interface FieldMapping {
  csvHeader: string;
  systemField: string | null;
  preview: string[];
}

interface PlatformDataFieldMapperProps {
  headers: string[];
  rawData: any[];
  mappings: FieldMapping[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
}

// Combine all fields for unified mapping (both person and company)
const ALL_SYSTEM_FIELDS = [
  ...PERSON_IMPORT_FIELDS.filter(f => f.id !== 'custom').map(f => ({
    ...f,
    category: 'person' as const
  })),
  ...COMPANY_IMPORT_FIELDS.filter(f => f.id !== 'custom' && !PERSON_IMPORT_FIELDS.some(pf => pf.id === f.id)).map(f => ({
    ...f,
    category: 'company' as const
  })),
  { id: 'custom', label: 'Custom Field (Keep Original)', category: 'other' as const, aliases: [] }
];

export function initializeMappings(headers: string[], rawData: any[]): FieldMapping[] {
  // Auto-map based on aliases
  const personAutoMap = autoMapFields(headers, PERSON_IMPORT_FIELDS);
  const companyAutoMap = autoMapFields(headers, COMPANY_IMPORT_FIELDS);
  
  return headers.map(header => {
    // Check person fields first, then company
    const systemField = personAutoMap.get(header) || companyAutoMap.get(header) || null;
    
    // Get first 3 values for preview
    const preview = rawData
      .slice(0, 3)
      .map(row => String(row[header] || '').slice(0, 50))
      .filter(v => v);
    
    return {
      csvHeader: header,
      systemField,
      preview
    };
  });
}

export function PlatformDataFieldMapper({ 
  headers, 
  rawData, 
  mappings, 
  onMappingsChange 
}: PlatformDataFieldMapperProps) {
  const handleMappingChange = (csvHeader: string, systemField: string | null) => {
    const updated = mappings.map(m => 
      m.csvHeader === csvHeader 
        ? { ...m, systemField: systemField === 'skip' ? null : systemField }
        : m
    );
    onMappingsChange(updated);
  };

  const usedFields = useMemo(() => {
    return new Set(mappings.map(m => m.systemField).filter(Boolean));
  }, [mappings]);

  const personFields = ALL_SYSTEM_FIELDS.filter(f => f.category === 'person');
  const companyFields = ALL_SYSTEM_FIELDS.filter(f => f.category === 'company');
  const otherFields = ALL_SYSTEM_FIELDS.filter(f => f.category === 'other');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Map CSV Columns</Label>
        <Badge variant="secondary">
          {mappings.filter(m => m.systemField).length} of {headers.length} mapped
        </Badge>
      </div>
      
      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-3">
          {mappings.map((mapping) => (
            <div 
              key={mapping.csvHeader} 
              className="flex items-start gap-4 p-3 rounded-lg border bg-card"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{mapping.csvHeader}</p>
                {mapping.preview.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    e.g. {mapping.preview.slice(0, 2).join(', ')}
                  </p>
                )}
              </div>
              
              <Select
                value={mapping.systemField || 'skip'}
                onValueChange={(value) => handleMappingChange(mapping.csvHeader, value)}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select field..." />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="skip">
                    <span className="text-muted-foreground">Skip this column</span>
                  </SelectItem>
                  
                  <SelectGroup>
                    <SelectLabel className="text-xs font-semibold text-primary">Person Fields</SelectLabel>
                    {personFields.map(field => (
                      <SelectItem 
                        key={field.id} 
                        value={field.id}
                        disabled={usedFields.has(field.id) && mapping.systemField !== field.id}
                      >
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  
                  <SelectGroup>
                    <SelectLabel className="text-xs font-semibold text-primary">Company Fields</SelectLabel>
                    {companyFields.map(field => (
                      <SelectItem 
                        key={field.id} 
                        value={field.id}
                        disabled={usedFields.has(field.id) && mapping.systemField !== field.id}
                      >
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  
                  <SelectGroup>
                    <SelectLabel className="text-xs font-semibold text-muted-foreground">Other</SelectLabel>
                    {otherFields.map(field => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
