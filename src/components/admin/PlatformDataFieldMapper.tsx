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
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
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

  const mappedCount = mappings.filter(m => m.systemField).length;
  const allMapped = mappedCount === headers.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Map CSV Columns</Label>
        <Badge 
          variant={allMapped ? "default" : "secondary"}
          className={cn(
            allMapped && "bg-green-600 hover:bg-green-600"
          )}
        >
          {mappedCount} of {headers.length} mapped
        </Badge>
      </div>
      
      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-3">
          {mappings.map((mapping) => {
            const isMapped = !!mapping.systemField;
            
            return (
              <div 
                key={mapping.csvHeader} 
                className={cn(
                  "flex items-start gap-4 p-3 rounded-lg border transition-colors",
                  isMapped 
                    ? "border-l-4 border-l-green-500 border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20" 
                    : "border-dashed border-muted-foreground/30 bg-muted/30"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isMapped ? (
                      <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                    )}
                    <p className={cn(
                      "font-medium text-sm truncate",
                      isMapped && "text-green-700 dark:text-green-400"
                    )}>
                      {mapping.csvHeader}
                    </p>
                  </div>
                  {mapping.preview.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 truncate ml-6">
                      e.g. {mapping.preview.slice(0, 2).join(', ')}
                    </p>
                  )}
                </div>
                
                <Select
                  value={mapping.systemField || 'skip'}
                  onValueChange={(value) => handleMappingChange(mapping.csvHeader, value)}
                >
                  <SelectTrigger className={cn(
                    "w-[200px]",
                    isMapped 
                      ? "border-green-500 bg-green-50 dark:bg-green-950/30" 
                      : "border-dashed border-muted-foreground/40"
                  )}>
                    <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="skip">
                      <span className="text-muted-foreground">Skip this column</span>
                    </SelectItem>
                    
                    <SelectGroup>
                      <SelectLabel className="text-xs font-semibold text-primary">Person Fields</SelectLabel>
                      {personFields.map(field => {
                        const isUsedElsewhere = usedFields.has(field.id) && mapping.systemField !== field.id;
                        const mappedTo = isUsedElsewhere 
                          ? mappings.find(m => m.systemField === field.id)?.csvHeader 
                          : null;
                        return (
                          <SelectItem 
                            key={field.id} 
                            value={field.id}
                            disabled={isUsedElsewhere}
                            className={cn(isUsedElsewhere && "opacity-60")}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className={cn(isUsedElsewhere && "line-through")}>{field.label}</span>
                              {isUsedElsewhere && mappedTo && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-auto">
                                  ✓ {mappedTo}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                    
                    <SelectGroup>
                      <SelectLabel className="text-xs font-semibold text-primary">Company Fields</SelectLabel>
                      {companyFields.map(field => {
                        const isUsedElsewhere = usedFields.has(field.id) && mapping.systemField !== field.id;
                        const mappedTo = isUsedElsewhere 
                          ? mappings.find(m => m.systemField === field.id)?.csvHeader 
                          : null;
                        return (
                          <SelectItem 
                            key={field.id} 
                            value={field.id}
                            disabled={isUsedElsewhere}
                            className={cn(isUsedElsewhere && "opacity-60")}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className={cn(isUsedElsewhere && "line-through")}>{field.label}</span>
                              {isUsedElsewhere && mappedTo && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-auto">
                                  ✓ {mappedTo}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
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
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
