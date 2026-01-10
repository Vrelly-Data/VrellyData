import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PERSON_IMPORT_FIELDS, COMPANY_IMPORT_FIELDS } from '@/config/csvImportFields';
import { autoMapFields } from '@/lib/csvImportMapper';
import { Check, Circle, X } from 'lucide-react';
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

// Combine all fields into a single flat list, remove duplicates by id AND label, sorted alphabetically
const ALL_SYSTEM_FIELDS = [
  ...PERSON_IMPORT_FIELDS.filter(f => f.id !== 'custom'),
  ...COMPANY_IMPORT_FIELDS.filter(f => f.id !== 'custom' && 
    !PERSON_IMPORT_FIELDS.some(pf => pf.id === f.id || pf.label === f.label)),
  { id: 'custom', label: 'Custom Field (Keep Original)', aliases: [] }
].sort((a, b) => {
  // Keep "Custom Field" at the end
  if (a.id === 'custom') return 1;
  if (b.id === 'custom') return -1;
  return a.label.localeCompare(b.label);
});

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
      
      <div className="max-h-[400px] overflow-y-auto pr-4">
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
                
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Select
                    value={mapping.systemField || 'skip'}
                    onValueChange={(value) => handleMappingChange(mapping.csvHeader, value)}
                  >
                  <SelectTrigger className={cn(
                    "w-[220px] flex-shrink-0",
                    isMapped 
                      ? "border-green-500 bg-green-50 dark:bg-green-950/30" 
                      : "border-dashed border-muted-foreground/40"
                  )}>
                    <SelectValue placeholder="Skip this column" />
                  </SelectTrigger>
                    <SelectContent className="max-h-[300px]" position="popper" sideOffset={4} style={{ zIndex: 9999 }}>
                      <SelectItem value="skip">
                        Skip this column
                      </SelectItem>
                      
                      {ALL_SYSTEM_FIELDS.map(field => {
                        const isUsedElsewhere = usedFields.has(field.id) && mapping.systemField !== field.id;
                        return (
                          <SelectItem 
                            key={field.id} 
                            value={field.id}
                            disabled={isUsedElsewhere}
                          >
                            {isUsedElsewhere ? `${field.label} (mapped)` : field.label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {isMapped && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleMappingChange(mapping.csvHeader, 'skip')}
                      title="Clear mapping"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

