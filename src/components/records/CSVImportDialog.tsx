import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, CheckCircle2, AlertCircle, X, FileText } from 'lucide-react';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';
import { CSVFieldMapping, SystemField } from '@/types/csvImport';
import { parseCSVFile, autoMapFields, transformImportData } from '@/lib/csvImportMapper';
import { PERSON_IMPORT_FIELDS, COMPANY_IMPORT_FIELDS } from '@/config/csvImportFields';
import { validateRequiredFields } from '@/lib/csvImportValidation';
import { useToast } from '@/hooks/use-toast';

interface CSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityType;
  onImportComplete: (importedRecords: PersonEntity[] | CompanyEntity[]) => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'import';

export function CSVImportDialog({ open, onOpenChange, entityType, onImportComplete }: CSVImportDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [mappings, setMappings] = useState<CSVFieldMapping[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const systemFields = entityType === 'person' ? PERSON_IMPORT_FIELDS : COMPANY_IMPORT_FIELDS;

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a CSV file',
        variant: 'destructive'
      });
      return;
    }

    try {
      const { headers, data } = await parseCSVFile(selectedFile);
      
      if (headers.length === 0) {
        toast({
          title: 'Invalid CSV',
          description: 'CSV file has no headers',
          variant: 'destructive'
        });
        return;
      }

      setFile(selectedFile);
      setCsvHeaders(headers);
      setRawData(data);

      // Auto-map fields
      const autoMapped = autoMapFields(headers, systemFields);
      
      const initialMappings: CSVFieldMapping[] = headers.map(header => ({
        csvHeader: header,
        systemField: autoMapped.get(header) || null,
        preview: data.slice(0, 3).map(row => {
          const value = row[header] || '';
          // Truncate long values for preview (max 100 chars)
          return String(value).length > 100 ? String(value).substring(0, 100) + '...' : String(value);
        })
      }));

      setMappings(initialMappings);
      setStep('mapping');
      
      toast({
        title: 'CSV uploaded',
        description: `${data.length} rows found. Fields auto-mapped.`
      });
    } catch (error) {
      toast({
        title: 'Error parsing CSV',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  }, [systemFields, toast]);

  const handleMappingChange = (csvHeader: string, systemField: string | null) => {
    setMappings(prev => prev.map(m => 
      m.csvHeader === csvHeader ? { ...m, systemField } : m
    ));
  };

  const handleAutoMapRemaining = () => {
    const unmappedHeaders = mappings
      .filter(m => !m.systemField)
      .map(m => m.csvHeader);
    
    const autoMapped = autoMapFields(unmappedHeaders, systemFields);
    
    setMappings(prev => prev.map(m => {
      if (!m.systemField && autoMapped.has(m.csvHeader)) {
        return { ...m, systemField: autoMapped.get(m.csvHeader) || null };
      }
      return m;
    }));

    toast({
      title: 'Auto-mapping complete',
      description: `Mapped ${autoMapped.size} additional fields`
    });
  };

  const handleClearMappings = () => {
    setMappings(prev => prev.map(m => ({ ...m, systemField: null })));
  };

  const handlePreview = () => {
    const errors: string[] = [];
    const requiredFields = systemFields.filter(f => f.required).map(f => f.id);
    const mappedFields = new Set(mappings.filter(m => m.systemField).map(m => m.systemField));
    
    const missingRequired = requiredFields.filter(f => !mappedFields.has(f));
    if (missingRequired.length > 0) {
      errors.push(`Missing required fields: ${missingRequired.join(', ')}`);
    }

    setValidationErrors(errors);
    setStep('preview');
  };

  const handleImport = async () => {
    if (validationErrors.length > 0) {
      toast({
        title: 'Validation errors',
        description: 'Please fix all errors before importing',
        variant: 'destructive'
      });
      return;
    }

    setStep('import');
    setImportProgress(0);

    try {
      const transformedData = transformImportData(mappings, rawData, entityType);
      
      // Simulate progress for user feedback
      for (let i = 0; i <= 100; i += 10) {
        setImportProgress(i);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      onImportComplete(transformedData);
      
      toast({
        title: 'Import successful',
        description: `${transformedData.length} records imported`
      });

      handleClose();
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
      setStep('preview');
    }
  };

  const handleClose = () => {
    setStep('upload');
    setFile(null);
    setCsvHeaders([]);
    setRawData([]);
    setMappings([]);
    setImportProgress(0);
    setValidationErrors([]);
    onOpenChange(false);
  };

  const previewData = transformImportData(mappings, rawData.slice(0, 10), entityType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import {entityType === 'person' ? 'People' : 'Companies'} from CSV</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV file to import records'}
            {step === 'mapping' && 'Map CSV columns to system fields'}
            {step === 'preview' && 'Preview and validate import data'}
            {step === 'import' && 'Importing records...'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div 
              className="border-2 border-dashed rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => document.getElementById('csv-file-input')?.click()}
            >
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">Drop CSV file here or click to browse</p>
              <p className="text-sm text-muted-foreground">Accepts .csv files only</p>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
            </div>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{file?.name} ({rawData.length} rows)</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleAutoMapRemaining}>
                  Auto-map remaining
                </Button>
                <Button variant="outline" size="sm" onClick={handleClearMappings}>
                  Clear all
                </Button>
              </div>
            </div>

            <div className="border rounded-lg max-h-96 overflow-y-auto">
              <table className="w-full table-fixed">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-3 font-medium w-1/4">CSV Column</th>
                    <th className="text-left p-3 font-medium w-1/3">Maps To</th>
                    <th className="text-left p-3 font-medium w-5/12">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => {
                    const isMapped = !!mapping.systemField;
                    const isRequired = systemFields.find(f => f.id === mapping.systemField)?.required;
                    
                    return (
                      <tr key={mapping.csvHeader} className="border-t">
                        <td className="p-3 w-1/4">
                          <div className="flex items-center gap-2 min-w-0">
                            {isMapped ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            )}
                            <span className="font-medium truncate">{mapping.csvHeader}</span>
                          </div>
                        </td>
                        <td className="p-3 w-1/3">
                          <Select
                            value={mapping.systemField || 'none'}
                            onValueChange={(value) => handleMappingChange(mapping.csvHeader, value === 'none' ? null : value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select field..." />
                            </SelectTrigger>
                            <SelectContent className="bg-background z-50">
                              <SelectItem value="none">Don't import</SelectItem>
                              {systemFields.map(field => (
                                <SelectItem key={field.id} value={field.id}>
                                  {field.label}
                                  {field.required && <span className="text-destructive ml-1">*</span>}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground w-5/12">
                          <div className="truncate">
                            {mapping.preview[0] || '-'}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handlePreview}>Next: Preview</Button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            {validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside">
                    {validationErrors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="border rounded-lg overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {mappings.filter(m => m.systemField).map(m => (
                      <th key={m.csvHeader} className="text-left p-2 font-medium whitespace-nowrap">
                        {m.systemField === 'custom' 
                          ? m.csvHeader 
                          : systemFields.find(f => f.id === m.systemField)?.label
                        }
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((record, i) => (
                    <tr key={i} className="border-t">
                      {mappings.filter(m => m.systemField).map(m => {
                        let cellValue = '-';
                        if (m.systemField === 'custom') {
                          cellValue = String((record as any).customFields?.[m.csvHeader] || '-');
                        } else {
                          cellValue = String((record as any)[m.systemField!] || '-');
                        }
                        return (
                          <td key={m.csvHeader} className="p-2">
                            {cellValue}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-sm text-muted-foreground">
              Showing first 10 of {rawData.length} records
            </p>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('mapping')}>Back</Button>
              <Button 
                onClick={handleImport}
                disabled={validationErrors.length > 0}
              >
                Import {rawData.length} Records
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Import */}
        {step === 'import' && (
          <div className="space-y-4 py-8">
            <div className="text-center mb-4">
              <p className="text-lg font-medium">Importing records...</p>
            </div>
            <Progress value={importProgress} className="w-full" />
            <p className="text-center text-sm text-muted-foreground">
              {importProgress}% complete
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
