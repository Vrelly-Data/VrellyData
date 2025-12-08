import { useState, useRef } from 'react';
import { useFreeData } from '@/hooks/useFreeData';
import { useDataSourceTemplates, ColumnMapping } from '@/hooks/useDataSourceTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Upload, Trash2, Loader2, FileSpreadsheet } from 'lucide-react';
import { parseCSVFile } from '@/lib/csvImportMapper';
import { toast } from 'sonner';

export function FreeDataTab() {
  const [entityType, setEntityType] = useState<'person' | 'company'>('person');
  const { records, loading, totalCount, uploadFreeData, deleteFreeData, refetch } = useFreeData(entityType);
  const { templates } = useDataSourceTemplates();
  
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [uploadEntityType, setUploadEntityType] = useState<'person' | 'company'>('person');
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredTemplates = templates.filter(t => t.entity_type === uploadEntityType);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { headers, data } = await parseCSVFile(file);
      
      const template = templates.find(t => t.id === selectedTemplate);
      if (!template) {
        toast.error('Please select a data source template');
        return;
      }

      // Transform data using template mappings
      const transformedData = data.map((row, index) => {
        const entityData: Record<string, any> = {};
        let externalId = '';

        template.column_mappings.forEach((mapping: ColumnMapping) => {
          if (mapping.systemField && mapping.csvHeader in row) {
            const value = row[mapping.csvHeader];
            entityData[mapping.systemField] = value;
            
            // Use email or name as external ID
            if (mapping.systemField === 'email' || mapping.systemField === 'domain') {
              externalId = value;
            }
          }
        });

        // Generate external ID if not found
        if (!externalId) {
          if (uploadEntityType === 'person') {
            externalId = entityData.email || entityData.linkedin || `person-${index}-${Date.now()}`;
          } else {
            externalId = entityData.domain || entityData.name || `company-${index}-${Date.now()}`;
          }
        }

        return {
          entity_type: uploadEntityType,
          entity_data: entityData,
          entity_external_id: externalId,
          source_template_id: selectedTemplate
        };
      });

      setParsedData(transformedData);
    } catch (error: any) {
      toast.error('Failed to parse CSV file');
      console.error(error);
    }
  };

  const handleUpload = async () => {
    if (parsedData.length === 0) {
      toast.error('No data to upload');
      return;
    }

    setUploading(true);
    try {
      await uploadFreeData(parsedData);
      setShowUploadDialog(false);
      setParsedData([]);
      setSelectedTemplate('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } finally {
      setUploading(false);
    }
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Free Data</h3>
          <p className="text-sm text-muted-foreground">
            Upload data that will be available to all users for free
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={entityType} onValueChange={(v) => setEntityType(v as 'person' | 'company')}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="person">People</SelectItem>
              <SelectItem value="company">Companies</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowUploadDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload CSV
          </Button>
        </div>
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
            <p className="text-muted-foreground">No free data uploaded yet</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowUploadDialog(true)}>
              Upload your first CSV
            </Button>
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
                      '-'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Free Data</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Entity Type</Label>
              <Select value={uploadEntityType} onValueChange={(v) => {
                setUploadEntityType(v as 'person' | 'company');
                setSelectedTemplate('');
                setParsedData([]);
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="person">Person</SelectItem>
                  <SelectItem value="company">Company</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Data Source Template</Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filteredTemplates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No templates for this entity type. Create one first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>CSV File</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                disabled={!selectedTemplate}
              />
            </div>

            {parsedData.length > 0 && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium">
                  {parsedData.length} records ready to upload
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Preview: {Object.keys(parsedData[0]?.entity_data || {}).join(', ')}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUploadDialog(false);
              setParsedData([]);
              setSelectedTemplate('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={parsedData.length === 0 || uploading}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                `Upload ${parsedData.length} Records`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
