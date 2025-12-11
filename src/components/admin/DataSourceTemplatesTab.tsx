import { useState, useEffect } from 'react';
import { useDataSourceTemplates, ColumnMapping } from '@/hooks/useDataSourceTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { PERSON_IMPORT_FIELDS, COMPANY_IMPORT_FIELDS } from '@/config/csvImportFields';
import { Pencil, Trash2, Loader2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DataSourceTemplatesTabProps {
  showCreateDialog: boolean;
  onCloseCreateDialog: () => void;
}

export function DataSourceTemplatesTab({ showCreateDialog, onCloseCreateDialog }: DataSourceTemplatesTabProps) {
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } = useDataSourceTemplates();
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState<'person' | 'company'>('person');
  const [description, setDescription] = useState('');
  const [csvHeaders, setCsvHeaders] = useState('');
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [step, setStep] = useState<'info' | 'mapping'>('info');

  // Combine all fields, remove duplicates by id AND label, sort alphabetically (custom at end)
  const allSystemFields = [
    ...PERSON_IMPORT_FIELDS.filter(f => f.id !== 'custom'),
    ...COMPANY_IMPORT_FIELDS.filter(f => f.id !== 'custom' && 
      !PERSON_IMPORT_FIELDS.some(pf => pf.id === f.id || pf.label === f.label))
  ]
    .sort((a, b) => a.label.localeCompare(b.label))
    .concat([{ id: 'custom', label: 'Custom Field', required: false, aliases: [] }]);

  // Open dialog when parent triggers it
  useEffect(() => {
    if (showCreateDialog) {
      handleOpenCreate();
    }
  }, [showCreateDialog]);

  const resetForm = () => {
    setName('');
    setEntityType('person');
    setDescription('');
    setCsvHeaders('');
    setMappings([]);
    setStep('info');
    setEditingTemplate(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  const handleOpenEdit = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    setEditingTemplate(templateId);
    setName(template.name);
    setEntityType(template.entity_type);
    setDescription(template.description || '');
    setMappings(template.column_mappings);
    setCsvHeaders(template.column_mappings.map(m => m.csvHeader).join('\n'));
    setStep('mapping');
    setShowDialog(true);
  };

  const handleParseHeaders = () => {
    const headers = csvHeaders
      .split(/[\n,\t]/)
      .map(h => h.trim())
      .filter(h => h.length > 0);

    if (headers.length === 0) {
      toast.error('Please paste CSV headers');
      return;
    }

    // Auto-map based on aliases
    const newMappings: ColumnMapping[] = headers.map(header => {
      const lowerHeader = header.toLowerCase();
      const matchedField = allSystemFields.find(
        f => f.id === lowerHeader || 
             f.label.toLowerCase() === lowerHeader ||
             f.aliases?.some(a => a.toLowerCase() === lowerHeader)
      );
      
      return {
        csvHeader: header,
        systemField: matchedField?.id || null
      };
    });

    setMappings(newMappings);
    setStep('mapping');
  };

  const handleMappingChange = (index: number, systemField: string | null) => {
    const updated = [...mappings];
    updated[index] = { ...updated[index], systemField };
    setMappings(updated);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    if (mappings.length === 0) {
      toast.error('Please add column mappings');
      return;
    }

    if (editingTemplate) {
      await updateTemplate(editingTemplate, {
        name,
        column_mappings: mappings,
        description: description || null
      });
    } else {
      await createTemplate(name, entityType, mappings, description);
    }

    handleCloseDialog();
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    resetForm();
    onCloseCreateDialog();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      await deleteTemplate(id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Data Source Templates</h3>
        <p className="text-sm text-muted-foreground">
          Reusable mappings for auto-mapping CSV columns from different data sources
        </p>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No templates created yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Columns</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell className="capitalize">{template.entity_type}</TableCell>
                  <TableCell>{template.column_mappings.length} columns</TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {template.description || '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(template.id)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(template.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Data Source Template'}
            </DialogTitle>
          </DialogHeader>

          {step === 'info' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input
                  placeholder="e.g., Apollo, LinkedIn, ZoomInfo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Entity Type</Label>
                <Select value={entityType} onValueChange={(v) => setEntityType(v as 'person' | 'company')}>
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
                <Label>Description (optional)</Label>
                <Input
                  placeholder="Brief description of this data source"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Paste CSV Headers</Label>
                <Textarea
                  placeholder="Paste your CSV headers here (separated by commas, tabs, or new lines)"
                  rows={6}
                  value={csvHeaders}
                  onChange={(e) => setCsvHeaders(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  You can copy and paste the first row of your CSV file
                </p>
              </div>
            </div>
          )}

          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Map each CSV column to a system field
                </p>
                {!editingTemplate && (
                  <Button variant="ghost" size="sm" onClick={() => setStep('info')}>
                    Back
                  </Button>
                )}
              </div>

              <div className="border rounded-lg max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CSV Column</TableHead>
                      <TableHead>System Field</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((mapping, index) => (
                      <TableRow 
                        key={index}
                        className={cn(mapping.systemField && "bg-green-50 dark:bg-green-950/20")}
                      >
                        <TableCell className="font-mono text-sm">
                          <div className="flex items-center gap-2">
                            {mapping.systemField && (
                              <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                            )}
                            {mapping.csvHeader}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Select
                              value={mapping.systemField || 'skip'}
                              onValueChange={(v) => handleMappingChange(index, v === 'skip' ? null : v)}
                            >
                              <SelectTrigger 
                                className={cn(
                                  "w-[200px]",
                                  mapping.systemField && "border-green-500 bg-green-50 dark:bg-green-950/30"
                                )}
                              >
                                <SelectValue placeholder="Select field" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Skip this column</SelectItem>
                                {allSystemFields.map((field) => (
                                  <SelectItem key={field.id} value={field.id}>
                                    {field.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {mapping.systemField && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => handleMappingChange(index, null)}
                                title="Clear mapping"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            {step === 'info' ? (
              <Button onClick={handleParseHeaders}>
                Continue to Mapping
              </Button>
            ) : (
              <Button onClick={handleSave}>
                {editingTemplate ? 'Save Changes' : 'Create Template'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
