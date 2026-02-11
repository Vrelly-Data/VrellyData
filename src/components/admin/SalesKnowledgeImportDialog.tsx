import { useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, CheckCircle, XCircle, Wand2, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { SalesKnowledgeInsert, KnowledgeCategory } from '@/hooks/useAdminSalesKnowledge';
import { useAdminSalesKnowledge } from '@/hooks/useAdminSalesKnowledge';

const VALID_CATEGORIES: { value: KnowledgeCategory; label: string }[] = [
  { value: 'email_template', label: 'Email Template' },
  { value: 'sequence_playbook', label: 'Sequence Playbook' },
  { value: 'campaign_result', label: 'Campaign Result' },
  { value: 'sales_guideline', label: 'Sales Guideline' },
  { value: 'audience_insight', label: 'Audience Insight' },
];

const NONE = '__none__';

interface ColumnMapping {
  title: string;
  content: string;
  suggestedCategory: KnowledgeCategory;
  categoryColumn: string | null;
  tags: string | null;
  sourceCampaign: string | null;
  metrics: Record<string, string>;
}

interface TransformedRow {
  entry: SalesKnowledgeInsert;
  valid: boolean;
  error?: string;
}

type Step = 'upload' | 'mapping' | 'preview';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (entries: SalesKnowledgeInsert[]) => void;
  isPending: boolean;
}

/** Case-insensitive header resolution for AI-returned column names */
function resolveHeader(aiValue: string | null | undefined, csvHeaders: string[]): string | null {
  if (!aiValue) return null;
  if (csvHeaders.includes(aiValue)) return aiValue;
  const lower = aiValue.toLowerCase().trim();
  const match = csvHeaders.find(h => h.toLowerCase().trim() === lower);
  return match || null;
}

/** Get sample value from the first data row for a given column */
function getSampleValue(column: string | null, rows: Record<string, string>[]): string {
  if (!column || rows.length === 0) return '';
  const val = rows[0]?.[column] ?? '';
  return val.length > 60 ? val.slice(0, 60) + '…' : val;
}

function transformRow(
  raw: Record<string, string>,
  mapping: ColumnMapping
): TransformedRow {
  const title = (raw[mapping.title] ?? '').trim();
  const content = (raw[mapping.content] ?? '').trim();

  if (!title) return { entry: {} as any, valid: false, error: 'Missing title' };
  if (!content) return { entry: {} as any, valid: false, error: 'Missing content' };

  let category = mapping.suggestedCategory;
  if (mapping.categoryColumn) {
    const rawCat = (raw[mapping.categoryColumn] ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    const validCats: string[] = VALID_CATEGORIES.map((c) => c.value);
    if (validCats.includes(rawCat)) {
      category = rawCat as KnowledgeCategory;
    }
  }

  const tags = mapping.tags
    ? (raw[mapping.tags] ?? '')
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  const metrics: Record<string, number> = {};
  if (mapping.metrics) {
    for (const [metricName, colName] of Object.entries(mapping.metrics)) {
      const val = parseFloat(raw[colName] ?? '');
      if (!isNaN(val)) metrics[metricName] = val;
    }
  }

  const sourceCampaign = mapping.sourceCampaign
    ? (raw[mapping.sourceCampaign] ?? '').trim() || undefined
    : undefined;

  return {
    valid: true,
    entry: {
      category,
      title,
      content,
      tags: tags?.length ? tags : undefined,
      metrics: Object.keys(metrics).length ? metrics : undefined,
      source_campaign: sourceCampaign,
    },
  };
}

export function SalesKnowledgeImportDialog({ open, onOpenChange, onImport, isPending }: Props) {
  const { analyzeCSV } = useAdminSalesKnowledge();

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const headerOptions = useMemo(
    () => [{ value: NONE, label: '— None —' }, ...headers.filter((h) => h.trim() !== '').map((h) => ({ value: h, label: h }))],
    [headers]
  );

  const transformedRows = useMemo(() => {
    if (!mapping) return [];
    return allRows.map((row) => transformRow(row, mapping));
  }, [allRows, mapping]);

  const validRows = transformedRows.filter((r) => r.valid);
  const invalidRows = transformedRows.filter((r) => !r.valid);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedHeaders = results.meta.fields ?? [];
        setHeaders(parsedHeaders);
        setAllRows(results.data);
        setStep('mapping');
        triggerAIAnalysis(parsedHeaders, results.data);
      },
    });
  }, []);

  const triggerAIAnalysis = async (
    csvHeaders: string[],
    data: Record<string, string>[]
  ) => {
    setIsAnalyzing(true);
    try {
      const sampleRows = data.slice(0, 5);
      const result = await analyzeCSV({
        headers: csvHeaders,
        sampleRows,
        rowCount: data.length,
      });
      const validHeaders = csvHeaders.filter((h) => h.trim() !== '');

      // Resolve AI-returned column names against actual headers (case-insensitive)
      const resolvedMetrics: Record<string, string> = {};
      for (const [metricName, colName] of Object.entries(result.mapping.metrics || {})) {
        if (typeof colName === 'string' && colName.trim() !== '') {
          const resolved = resolveHeader(colName, csvHeaders);
          if (resolved) resolvedMetrics[metricName] = resolved;
        }
      }

      const sanitized: ColumnMapping = {
        ...result.mapping,
        title: resolveHeader(result.mapping.title, csvHeaders) || validHeaders[0] || '',
        content: resolveHeader(result.mapping.content, csvHeaders) || validHeaders[1] || validHeaders[0] || '',
        suggestedCategory: result.mapping.suggestedCategory || 'campaign_result',
        categoryColumn: resolveHeader(result.mapping.categoryColumn, csvHeaders),
        tags: resolveHeader(result.mapping.tags, csvHeaders),
        sourceCampaign: resolveHeader(result.mapping.sourceCampaign, csvHeaders),
        metrics: resolvedMetrics,
      };
      setMapping(sanitized);
      toast({ title: 'AI analysis complete', description: 'Review the suggested mapping below.' });
    } catch (err) {
      console.error('AI analysis failed:', err);
      toast({
        title: 'AI analysis failed',
        description: 'Map columns manually using the dropdowns below.',
        variant: 'destructive',
      });
      setMapping({
        title: csvHeaders[0] ?? '',
        content: csvHeaders[1] ?? '',
        suggestedCategory: 'campaign_result',
        categoryColumn: null,
        tags: null,
        sourceCampaign: null,
        metrics: {},
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateMapping = (field: keyof ColumnMapping, value: string) => {
    if (!mapping) return;
    setMapping((prev) => {
      if (!prev) return prev;
      if (field === 'metrics') return prev;
      if (field === 'categoryColumn' || field === 'tags' || field === 'sourceCampaign') {
        return { ...prev, [field]: value === NONE ? null : value };
      }
      return { ...prev, [field]: value };
    });
  };

  const updateMetric = (metricName: string, colName: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const metrics = { ...prev.metrics };
      if (colName === NONE) {
        delete metrics[metricName];
      } else {
        metrics[metricName] = colName;
      }
      return { ...prev, metrics };
    });
  };

  const addMetric = () => {
    const name = prompt('Metric name (e.g. open_rate, clicks):');
    if (!name?.trim()) return;
    setMapping((prev) => {
      if (!prev) return prev;
      return { ...prev, metrics: { ...prev.metrics, [name.trim()]: headers[0] ?? '' } };
    });
  };

  const removeMetric = (name: string) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const metrics = { ...prev.metrics };
      delete metrics[name];
      return { ...prev, metrics };
    });
  };

  const reset = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setAllRows([]);
    setMapping(null);
    setIsAnalyzing(false);
  };

  const handleImport = () => {
    onImport(validRows.map((r) => r.entry));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Import Sales Knowledge from CSV'}
            {step === 'mapping' && 'Map CSV Columns'}
            {step === 'preview' && 'Preview & Confirm Import'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-muted-foreground/30 rounded-lg p-10 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Drop or select any CSV file — we'll auto-detect the columns
            </span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        )}

        {/* Step 2: Mapping */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{fileName}</span>
              <Badge variant="secondary">{allRows.length} rows</Badge>
              {isAnalyzing && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analyzing...
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">
                Choose different file
              </Button>
            </div>

            {/* CSV Data Preview */}
            {headers.length > 0 && allRows.length > 0 && (
              <div className="rounded border overflow-auto max-h-[180px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.filter(h => h.trim()).map((h) => (
                        <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allRows.slice(0, 3).map((row, i) => (
                      <TableRow key={i}>
                        {headers.filter(h => h.trim()).map((h) => (
                          <TableCell key={h} className="text-xs py-1.5 max-w-[200px] truncate">
                            {(row[h] ?? '').length > 50
                              ? (row[h] ?? '').slice(0, 50) + '…'
                              : row[h] ?? ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {mapping && !isAnalyzing && (
              <div className="space-y-3 border rounded-lg p-4">
                <div className="mb-2">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Column Mapping</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    For each field below, choose which column from your CSV ("{fileName}") should fill it. The dropdown lists your CSV column headers.
                  </p>
                </div>
                <div className="grid grid-cols-[160px_1fr] items-center gap-1 text-xs text-muted-foreground font-medium border-b pb-1 mb-1">
                  <span>Save as →</span>
                  <span>← Your CSV column</span>
                </div>

                {/* Title */}
                <MappingRow
                  label="Title column"
                  required
                  value={mapping.title}
                  options={headerOptions}
                  onChange={(v) => updateMapping('title', v)}
                  sampleValue={getSampleValue(mapping.title, allRows)}
                />

                {/* Content */}
                <MappingRow
                  label="Content column"
                  required
                  value={mapping.content}
                  options={headerOptions}
                  onChange={(v) => updateMapping('content', v)}
                  sampleValue={getSampleValue(mapping.content, allRows)}
                />

                {/* Category */}
                <div className="grid grid-cols-[160px_1fr] items-center gap-2">
                  <span className="text-sm">Category</span>
                  <div className="flex gap-2">
                    <Select
                      value={mapping.suggestedCategory}
                      onValueChange={(v) => updateMapping('suggestedCategory', v)}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VALID_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground self-center">or from column:</span>
                    <Select
                      value={mapping.categoryColumn ?? NONE}
                      onValueChange={(v) => updateMapping('categoryColumn', v)}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {headerOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Tags */}
                <MappingRow
                  label="Tags column"
                  value={mapping.tags ?? NONE}
                  options={headerOptions}
                  onChange={(v) => updateMapping('tags', v)}
                  sampleValue={getSampleValue(mapping.tags, allRows)}
                />

                {/* Source Campaign */}
                <MappingRow
                  label="Source Campaign"
                  value={mapping.sourceCampaign ?? NONE}
                  options={headerOptions}
                  onChange={(v) => updateMapping('sourceCampaign', v)}
                  sampleValue={getSampleValue(mapping.sourceCampaign, allRows)}
                />

                {/* Metrics */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm w-[160px]">Metrics</span>
                    <Button variant="ghost" size="sm" onClick={addMetric}>
                      + Add metric
                    </Button>
                  </div>
                  {Object.entries(mapping.metrics).map(([name, col]) => (
                    <div key={name} className="grid grid-cols-[160px_1fr_auto] items-center gap-2">
                      <span className="text-sm text-muted-foreground pl-2">
                        {name.replace(/_/g, ' ')}
                      </span>
                      <div className="space-y-0.5">
                        <Select value={col || NONE} onValueChange={(v) => updateMetric(name, v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headerOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {col && col !== NONE && getSampleValue(col, allRows) && (
                          <p className="text-xs text-muted-foreground truncate pl-1">
                            Preview: "{getSampleValue(col, allRows)}"
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMetric(name)}
                        className="text-destructive"
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mapping && !isAnalyzing && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    triggerAIAnalysis(headers, allRows);
                  }}
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Re-analyze with AI
                </Button>
                <Button onClick={() => setStep('preview')}>Apply Mapping & Preview</Button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{fileName}</span>
              <Badge variant="secondary">{validRows.length} valid</Badge>
              {invalidRows.length > 0 && (
                <Badge variant="destructive">{invalidRows.length} invalid</Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => setStep('mapping')} className="ml-auto">
                Back to mapping
              </Button>
            </div>

            <div className="max-h-[400px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-16">Valid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transformedRows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? '' : 'bg-destructive/5'}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">
                        {row.valid ? row.entry.category.replace(/_/g, ' ') : row.error}
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-[250px]">
                        {row.valid ? row.entry.title : '—'}
                      </TableCell>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === 'preview' && (
            <Button
              onClick={handleImport}
              disabled={validRows.length === 0 || isPending}
            >
              {isPending ? 'Importing...' : `Import ${validRows.length} Entries`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingRow({
  label,
  value,
  options,
  onChange,
  required,
  sampleValue,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  required?: boolean;
  sampleValue?: string;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-2">
      <span className="text-sm">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </span>
      <div className="space-y-0.5">
        <Select value={value || NONE} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sampleValue && value && value !== NONE && (
          <p className="text-xs text-muted-foreground truncate pl-1">
            Preview: "{sampleValue}"
          </p>
        )}
      </div>
    </div>
  );
}
