import { useState, useRef, useEffect } from 'react';
import { useFreeData } from '@/hooks/useFreeData';
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
import { Trash2, Loader2, FileSpreadsheet, ArrowRight } from 'lucide-react';
import { parseCSVFile, transformImportData } from '@/lib/csvImportMapper';
import { extractCompaniesFromPeople } from '@/lib/companyExtraction';
import { PlatformDataFieldMapper, FieldMapping, initializeMappings } from './PlatformDataFieldMapper';
import { toast } from 'sonner';
import { PersonEntity } from '@/types/audience';
import { CSVFieldMapping } from '@/types/csvImport';
import { generatePersonId, generateCompanyId } from '@/lib/entityIdGenerator';

type UploadStep = 'select-file' | 'map-fields';

interface FreeDataTabProps {
  showUploadDialog: boolean;
  onCloseUploadDialog: () => void;
}

export function FreeDataTab({ showUploadDialog, onCloseUploadDialog }: FreeDataTabProps) {
  const [entityType, setEntityType] = useState<'person' | 'company'>('person');
  const { records, loading, totalCount, uploadFreeData, deleteFreeData, refetch } = useFreeData(entityType);
  const { templates, createTemplate } = useDataSourceTemplates();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState<UploadStep>('select-file');
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // CSV parsing state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRawData, setCsvRawData] = useState<any[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  
  // Template selection and saving
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Open dialog when parent triggers it
  useEffect(() => {
    if (showUploadDialog) {
      setDialogOpen(true);
    }
  }, [showUploadDialog]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { headers, data } = await parseCSVFile(file);
      
      if (headers.length === 0 || data.length === 0) {
        toast.error('CSV file appears to be empty');
        return;
      }
      
      setCsvHeaders(headers);
      setCsvRawData(data);
      
      // Initialize mappings - apply template if selected, otherwise auto-detect
      let initialMappings = initializeMappings(headers, data);
      
      if (selectedTemplateId) {
        const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
        if (selectedTemplate && selectedTemplate.column_mappings) {
          const templateMappings = selectedTemplate.column_mappings as Array<{ csvHeader: string; systemField: string }>;
          
          // Apply template mappings to matching headers
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
      toast.success(`Loaded ${data.length} rows with ${headers.length} columns`);
    } catch (error: any) {
      toast.error('Failed to parse CSV file');
      console.error(error);
    }
  };

  const handleUpload = async () => {
    if (csvRawData.length === 0) {
      toast.error('No data to upload');
      return;
    }

    setUploading(true);
    try {
      // Convert FieldMapping[] to CSVFieldMapping[] for transformImportData
      const csvMappings: CSVFieldMapping[] = fieldMappings.map(m => ({
        csvHeader: m.csvHeader,
        systemField: m.systemField,
        preview: m.preview
      }));
      
      // Transform data to person entities
      const personEntities = transformImportData(csvMappings, csvRawData, 'person') as PersonEntity[];
      
      // Extract companies from people
      const companyEntities = extractCompaniesFromPeople(personEntities);
      
      // Prepare person records for upload with deterministic IDs
      const personRecords = personEntities.map((person) => ({
        entity_type: 'person' as const,
        entity_data: person as Record<string, any>,
        entity_external_id: generatePersonId(person)
      }));
      
      // Prepare company records for upload with deterministic IDs
      const companyRecords = companyEntities.map((company) => ({
        entity_type: 'company' as const,
        entity_data: company as Record<string, any>,
        entity_external_id: generateCompanyId(company)
      }));
      
      // Upload both
      const allRecords = [...personRecords, ...companyRecords];
      
      await uploadFreeData(allRecords);
      
      // Optionally save as template
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
      
      toast.success(`Created ${personRecords.length} people and ${companyRecords.length} companies`);
      
      // Reset dialog state
      handleCloseDialog();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Failed to upload data');
    } finally {
      setUploading(false);
    }
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setUploadStep('select-file');
    setCsvHeaders([]);
    setCsvRawData([]);
    setFieldMappings([]);
    setSelectedTemplateId(null);
    setSaveAsTemplate(false);
    setTemplateName('');
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

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) handleCloseDialog();
        else setDialogOpen(true);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {uploadStep === 'select-file' && 'Upload CSV'}
              {uploadStep === 'map-fields' && 'Map CSV Columns'}
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
                  <Badge variant="outline">{csvRawData.length} rows</Badge>
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
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            {uploadStep === 'map-fields' && (
              <Button 
                onClick={handleUpload} 
                disabled={mappedFieldsCount === 0 || uploading || (saveAsTemplate && !templateName.trim())}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  `Upload ${csvRawData.length} Records`
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
