import { useState, useRef } from 'react';
import { useFreeData, UploadProgress } from '@/hooks/useFreeData';
import { useDataSourceTemplates } from '@/hooks/useDataSourceTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox as CheckboxComponent } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Trash2, Loader2, FileSpreadsheet, ArrowRight } from 'lucide-react';
import { parseCSVFile, transformImportData, streamParseCSV } from '@/lib/csvImportMapper';
import { extractCompaniesFromPeople } from '@/lib/companyExtraction';
import { PlatformDataFieldMapper, FieldMapping, initializeMappings } from './PlatformDataFieldMapper';
import { toast } from 'sonner';
import { PersonEntity } from '@/types/audience';
import { CSVFieldMapping } from '@/types/csvImport';
import { generatePersonId, generateCompanyId } from '@/lib/entityIdGenerator';

type UploadStep = 'select-file' | 'map-fields' | 'uploading' | 'complete';

const STREAM_THRESHOLD = 5000; // Use streaming for files with more than this many rows

interface FreeDataTabProps {
  showUploadDialog: boolean;
  onCloseUploadDialog: () => void;
}

export function FreeDataTab({ showUploadDialog, onCloseUploadDialog }: FreeDataTabProps) {
  const [entityType, setEntityType] = useState<'person' | 'company'>('person');
  const { records, loading, totalCount, uploadFreeData, deleteFreeData, refetch } = useFreeData(entityType);
  const { templates, createTemplate } = useDataSourceTemplates();
  
  const [uploadStep, setUploadStep] = useState<UploadStep>('select-file');
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // CSV parsing state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRawData, setCsvRawData] = useState<any[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvTotalRows, setCsvTotalRows] = useState(0);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  
  // Upload progress state
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadSummary, setUploadSummary] = useState<{ people: number; companies: number } | null>(null);
  
  // Template selection and saving
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Always stream-count first, only load preview rows
      const { headers, data, totalRows } = await parseCSVFile(file, 1000);
      
      if (headers.length === 0 || totalRows === 0) {
        toast.error('CSV file appears to be empty');
        return;
      }
      
      setCsvHeaders(headers);
      setCsvRawData(data);
      setCsvFile(file);
      setCsvTotalRows(totalRows);
      
      // Initialize mappings - apply template if selected, otherwise auto-detect
      let initialMappings = initializeMappings(headers, data);
      
      if (selectedTemplateId) {
        const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
        if (selectedTemplate && selectedTemplate.column_mappings) {
          const templateMappings = selectedTemplate.column_mappings as Array<{ csvHeader: string; systemField: string }>;
          
          initialMappings = initialMappings.map(mapping => {
            const templateMapping = templateMappings.find(
              tm => tm.csvHeader.toLowerCase() === mapping.csvHeader.toLowerCase()
            );
            if (templateMapping) {
              return { ...mapping, systemField: templateMapping.systemField };
            }
            return mapping;
          });
          
          toast.success(`Applied template "${selectedTemplate.name}" mappings`);
        }
      }
      
      setFieldMappings(initialMappings);
      setUploadStep('map-fields');
      toast.success(`Loaded ${totalRows.toLocaleString()} rows with ${headers.length} columns`);
    } catch (error: any) {
      toast.error('Failed to parse CSV file');
      console.error(error);
    }
  };

  const handleUpload = async () => {
    if (!csvFile || csvTotalRows === 0) {
      toast.error('No data to upload');
      return;
    }

    setUploading(true);
    setUploadStep('uploading');
    setUploadProgress(null);
    setUploadSummary(null);

    try {
      const csvMappings: CSVFieldMapping[] = fieldMappings.map(m => ({
        csvHeader: m.csvHeader,
        systemField: m.systemField,
        preview: m.preview
      }));

      let totalPeople = 0;
      let totalCompanies = 0;

      const useStreaming = csvTotalRows > STREAM_THRESHOLD;

      if (useStreaming) {
        // Streaming mode: process file in chunks
        await streamParseCSV(csvFile, 1000, async (rows, chunkIndex) => {
          const personEntities = transformImportData(csvMappings, rows, 'person') as PersonEntity[];
          const companyEntities = extractCompaniesFromPeople(personEntities);

          const personRecords = personEntities.map((person) => ({
            entity_type: 'person' as const,
            entity_data: person as Record<string, any>,
            entity_external_id: generatePersonId(person)
          }));

          const companyRecords = companyEntities.map((company) => ({
            entity_type: 'company' as const,
            entity_data: company as Record<string, any>,
            entity_external_id: generateCompanyId(company)
          }));

          const allRecords = [...personRecords, ...companyRecords];
          
          await uploadFreeData(allRecords, (progress) => {
            // Translate batch-level progress to overall progress
            const overallUploaded = (chunkIndex * 1000) + progress.recordsUploaded;
            setUploadProgress({
              currentBatch: chunkIndex + 1,
              totalBatches: Math.ceil(csvTotalRows / 1000),
              recordsUploaded: Math.min(overallUploaded, csvTotalRows),
              totalRecords: csvTotalRows,
              phase: 'uploading'
            });
          });

          totalPeople += personRecords.length;
          totalCompanies += companyRecords.length;
        });
      } else {
        // Small file: parse all at once (already have data from preview)
        const fullParse = csvRawData.length === csvTotalRows 
          ? csvRawData 
          : (await parseCSVFile(csvFile)).data;

        const personEntities = transformImportData(csvMappings, fullParse, 'person') as PersonEntity[];
        const companyEntities = extractCompaniesFromPeople(personEntities);

        const personRecords = personEntities.map((person) => ({
          entity_type: 'person' as const,
          entity_data: person as Record<string, any>,
          entity_external_id: generatePersonId(person)
        }));

        const companyRecords = companyEntities.map((company) => ({
          entity_type: 'company' as const,
          entity_data: company as Record<string, any>,
          entity_external_id: generateCompanyId(company)
        }));

        const allRecords = [...personRecords, ...companyRecords];

        await uploadFreeData(allRecords, (progress) => {
          setUploadProgress(progress);
        });

        totalPeople = personRecords.length;
        totalCompanies = companyRecords.length;
      }

      // Save template if requested
      if (saveAsTemplate && templateName.trim()) {
        const columnMappings = fieldMappings
          .filter(m => m.systemField)
          .map(m => ({
            csvHeader: m.csvHeader,
            systemField: m.systemField
          }));
        
        await createTemplate(templateName.trim(), 'person', columnMappings as any);
        toast.success(`Template "${templateName}" saved`);
      }

      setUploadSummary({ people: totalPeople, companies: totalCompanies });
      setUploadStep('complete');
      setUploadProgress({
        currentBatch: 0,
        totalBatches: 0,
        recordsUploaded: totalPeople + totalCompanies,
        totalRecords: totalPeople + totalCompanies,
        phase: 'done'
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Failed to upload data');
      setUploadStep('map-fields');
    } finally {
      setUploading(false);
    }
  };

  const handleCloseDialog = () => {
    if (uploading) return; // Prevent closing during upload
    setUploadStep('select-file');
    setCsvHeaders([]);
    setCsvRawData([]);
    setCsvFile(null);
    setCsvTotalRows(0);
    setFieldMappings([]);
    setSelectedTemplateId(null);
    setSaveAsTemplate(false);
    setTemplateName('');
    setUploadProgress(null);
    setUploadSummary(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onCloseUploadDialog();
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(records.map(r => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRecord = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    
    if (confirm(`Are you sure you want to delete ${selectedIds.size} records?`)) {
      await deleteFreeData(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const getDisplayColumns = () => {
    if (entityType === 'person') {
      return ['firstName', 'lastName', 'email', 'title', 'company'];
    }
    return ['name', 'domain', 'industry', 'employeeCount', 'location'];
  };

  const mappedFieldsCount = fieldMappings.filter(m => m.systemField).length;

  const progressPercent = uploadProgress 
    ? Math.round((uploadProgress.recordsUploaded / Math.max(uploadProgress.totalRecords, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Uploads</h3>
          <p className="text-sm text-muted-foreground">
            Uploaded data available to all users (credits charged on download)
          </p>
        </div>
        <Select value={entityType} onValueChange={(v) => setEntityType(v as 'person' | 'company')}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="person">People</SelectItem>
            <SelectItem value="company">Companies</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalCount.toLocaleString()} total records
        </p>
        {selectedIds.size > 0 && (
          <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete {selectedIds.size} selected
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No uploads yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={selectedIds.size === records.length && records.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                {getDisplayColumns().map((col) => (
                  <TableHead key={col} className="capitalize">
                    {col.replace(/([A-Z])/g, ' $1').trim()}
                  </TableHead>
                ))}
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(record.id)}
                      onCheckedChange={(checked) => handleSelectRecord(record.id, !!checked)}
                    />
                  </TableCell>
                  {getDisplayColumns().map((col) => (
                    <TableCell key={col} className="max-w-[200px] truncate">
                      {record.entity_data[col] || '-'}
                    </TableCell>
                  ))}
                  <TableCell>
                    {record.source_template_id ? (
                      <Badge variant="outline">
                        {templates.find(t => t.id === record.source_template_id)?.name || 'Unknown'}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Direct Upload</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={showUploadDialog} onOpenChange={(open) => {
        if (!open && !uploading) handleCloseDialog();
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {uploadStep === 'select-file' && 'Upload CSV'}
              {uploadStep === 'map-fields' && 'Map CSV Columns'}
              {uploadStep === 'uploading' && 'Uploading Records...'}
              {uploadStep === 'complete' && 'Upload Complete'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {uploadStep === 'select-file' && (
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Upload a CSV file containing contact data. The system will automatically create both people and company records.
                </p>
                
                {templates.length > 0 && (
                  <div className="space-y-2">
                    <Label>Apply Template (Optional)</Label>
                    <Select
                      value={selectedTemplateId || 'none'}
                      onValueChange={(v) => setSelectedTemplateId(v === 'none' ? null : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a template to auto-map columns" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No template (auto-detect)</SelectItem>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Templates apply saved column mappings to matching CSV headers
                    </p>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label>CSV File</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                  />
                </div>
              </div>
            )}

            {uploadStep === 'map-fields' && (
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <Badge variant="outline">{csvTotalRows.toLocaleString()} rows</Badge>
                  <ArrowRight className="h-4 w-4" />
                  <span>People + Auto-extracted Companies</span>
                </div>
                
                <PlatformDataFieldMapper
                  headers={csvHeaders}
                  rawData={csvRawData}
                  mappings={fieldMappings}
                  onMappingsChange={setFieldMappings}
                />
                
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckboxComponent
                      id="save-template"
                      checked={saveAsTemplate}
                      onCheckedChange={(checked) => setSaveAsTemplate(!!checked)}
                    />
                    <Label htmlFor="save-template" className="text-sm cursor-pointer">
                      Save this mapping as a template for future uploads
                    </Label>
                  </div>
                  
                  {saveAsTemplate && (
                    <Input
                      placeholder="Template name (e.g., Apollo Export, LinkedIn Sales Nav)"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                    />
                  )}
                </div>
              </div>
            )}

            {uploadStep === 'uploading' && uploadProgress && (
              <div className="space-y-6 py-8">
                <div className="space-y-2">
                  <Progress value={progressPercent} className="h-3" />
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      Uploading batch {uploadProgress.currentBatch} of {uploadProgress.totalBatches}...
                    </span>
                    <span>{progressPercent}%</span>
                  </div>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  {uploadProgress.recordsUploaded.toLocaleString()} / {uploadProgress.totalRecords.toLocaleString()} records
                </p>
              </div>
            )}

            {uploadStep === 'uploading' && !uploadProgress && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {uploadStep === 'complete' && uploadSummary && (
              <div className="space-y-4 py-8 text-center">
                <div className="text-4xl">✅</div>
                <h3 className="text-lg font-semibold">Upload Complete</h3>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>{uploadSummary.people.toLocaleString()} people uploaded</p>
                  <p>{uploadSummary.companies.toLocaleString()} companies extracted</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            {uploadStep !== 'uploading' && (
              <Button variant="outline" onClick={handleCloseDialog}>
                {uploadStep === 'complete' ? 'Close' : 'Cancel'}
              </Button>
            )}
            {uploadStep === 'map-fields' && (
              <Button 
                onClick={handleUpload} 
                disabled={mappedFieldsCount === 0 || uploading || (saveAsTemplate && !templateName.trim())}
              >
                Upload {csvTotalRows.toLocaleString()} Records
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
