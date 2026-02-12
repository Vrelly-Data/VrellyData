import { useState, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { Upload, CheckCircle, XCircle, Wand2, Loader2, Check, Circle, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { SalesKnowledgeInsert, KnowledgeCategory } from '@/hooks/useAdminSalesKnowledge';
import { useAdminSalesKnowledge } from '@/hooks/useAdminSalesKnowledge';
import { detectStatsCSV, transformStatsRows } from '@/lib/statsCSVDetector';

const VALID_CATEGORIES: { value: KnowledgeCategory; label: string }[] = [
  { value: 'email_template', label: 'Email Template' },
  { value: 'sequence_playbook', label: 'Sequence Playbook' },
  { value: 'campaign_result', label: 'Campaign Result' },
  { value: 'sales_guideline', label: 'Sales Guideline' },
  { value: 'audience_insight', label: 'Audience Insight' },
];

/** Target fields a CSV column can be mapped to */
type TargetField = 'skip' | 'title' | 'content' | 'category' | 'tags' | 'source_campaign' | 'metric';

const TARGET_OPTIONS: { value: TargetField; label: string }[] = [
  { value: 'skip', label: 'Skip this column' },
  { value: 'title', label: 'Title' },
  { value: 'content', label: 'Content' },
  { value: 'category', label: 'Category' },
  { value: 'tags', label: 'Tags' },
  { value: 'source_campaign', label: 'Source Campaign' },
  { value: 'metric', label: 'Metric' },
];

/** Per-column mapping state */
interface ColumnTargetMapping {
  csvHeader: string;
  target: TargetField;
  metricName?: string; // only when target === 'metric'
  preview: string[];
}

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

/** Convert column-first mappings back to the ColumnMapping shape used by transformRow */
function columnMappingsToLegacy(
  colMappings: ColumnTargetMapping[],
  globalCategory: KnowledgeCategory
): ColumnMapping | null {
  const titleCol = colMappings.find(m => m.target === 'title');
  const contentCol = colMappings.find(m => m.target === 'content');
  if (!titleCol || !contentCol) return null;

  const categoryCol = colMappings.find(m => m.target === 'category');
  const tagsCol = colMappings.find(m => m.target === 'tags');
  const sourceCol = colMappings.find(m => m.target === 'source_campaign');
  const metricCols = colMappings.filter(m => m.target === 'metric' && m.metricName);

  const metrics: Record<string, string> = {};
  for (const mc of metricCols) {
    metrics[mc.metricName!] = mc.csvHeader;
  }

  return {
    title: titleCol.csvHeader,
    content: contentCol.csvHeader,
    suggestedCategory: globalCategory,
    categoryColumn: categoryCol?.csvHeader ?? null,
    tags: tagsCol?.csvHeader ?? null,
    sourceCampaign: sourceCol?.csvHeader ?? null,
    metrics,
  };
}

export function SalesKnowledgeImportDialog({ open, onOpenChange, onImport, isPending }: Props) {
  const { analyzeCSV } = useAdminSalesKnowledge();

  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [colMappings, setColMappings] = useState<ColumnTargetMapping[]>([]);
  const [globalCategory, setGlobalCategory] = useState<KnowledgeCategory>('campaign_result');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isStatsMode, setIsStatsMode] = useState(false);
  const [statsTransformed, setStatsTransformed] = useState<{ entry: SalesKnowledgeInsert; valid: boolean; error?: string }[]>([]);

  const legacyMapping = useMemo(
    () => columnMappingsToLegacy(colMappings, globalCategory),
    [colMappings, globalCategory]
  );

  const transformedRows = useMemo(() => {
    if (isStatsMode) return statsTransformed;
    if (!legacyMapping) return [];
    return allRows.map((row) => transformRow(row, legacyMapping));
  }, [allRows, legacyMapping, isStatsMode, statsTransformed]);

  const validRows = transformedRows.filter((r) => r.valid);
  const invalidRows = transformedRows.filter((r) => !r.valid);

  const mappedCount = colMappings.filter(m => m.target !== 'skip').length;
  const hasTitleMapped = colMappings.some(m => m.target === 'title');
  const hasContentMapped = colMappings.some(m => m.target === 'content');
  const canPreview = hasTitleMapped && hasContentMapped;

  /** Build initial column mappings from parsed headers */
  const buildInitialColMappings = (csvHeaders: string[], data: Record<string, string>[]): ColumnTargetMapping[] => {
    return csvHeaders.filter(h => h.trim()).map(header => ({
      csvHeader: header,
      target: 'skip' as TargetField,
      preview: data.slice(0, 2).map(row => {
        const v = String(row[header] ?? '').slice(0, 60);
        return v;
      }).filter(Boolean),
    }));
  };

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedHeaders = results.meta.fields ?? [];
        setHeaders(parsedHeaders);
        setAllRows(results.data);

        // Try stats auto-detection first
        const statsConfig = detectStatsCSV(parsedHeaders, results.data);
        if (statsConfig) {
          const transformed = transformStatsRows(results.data, statsConfig);
          setIsStatsMode(true);
          setStatsTransformed(transformed);
          setStep('preview');
          toast({ title: 'Stats CSV detected', description: `Auto-mapped ${transformed.filter(r => r.valid).length} campaign results.` });
          return;
        }

        // Fallback: normal mapping flow
        setColMappings(buildInitialColMappings(parsedHeaders, results.data));
        setStep('mapping');
        triggerAIAnalysis(parsedHeaders, results.data);
      },
    });
  }, []);

  /** Apply AI analysis result to column-first mappings */
  const applyAIResult = (aiMapping: any, csvHeaders: string[], data: Record<string, string>[]) => {
    const resolvedTitle = resolveHeader(aiMapping.title, csvHeaders);
    const resolvedContent = resolveHeader(aiMapping.content, csvHeaders);
    const resolvedTags = resolveHeader(aiMapping.tags, csvHeaders);
    const resolvedSource = resolveHeader(aiMapping.sourceCampaign, csvHeaders);
    const resolvedCategory = resolveHeader(aiMapping.categoryColumn, csvHeaders);

    const resolvedMetrics: Record<string, string> = {};
    for (const [metricName, colName] of Object.entries(aiMapping.metrics || {})) {
      if (typeof colName === 'string' && colName.trim()) {
        const resolved = resolveHeader(colName, csvHeaders);
        if (resolved) resolvedMetrics[resolved] = metricName;
      }
    }

    if (aiMapping.suggestedCategory) {
      setGlobalCategory(aiMapping.suggestedCategory);
    }

    const newMappings = buildInitialColMappings(csvHeaders, data).map(cm => {
      if (cm.csvHeader === resolvedTitle) return { ...cm, target: 'title' as TargetField };
      if (cm.csvHeader === resolvedContent) return { ...cm, target: 'content' as TargetField };
      if (cm.csvHeader === resolvedTags) return { ...cm, target: 'tags' as TargetField };
      if (cm.csvHeader === resolvedSource) return { ...cm, target: 'source_campaign' as TargetField };
      if (cm.csvHeader === resolvedCategory) return { ...cm, target: 'category' as TargetField };
      if (resolvedMetrics[cm.csvHeader]) return { ...cm, target: 'metric' as TargetField, metricName: resolvedMetrics[cm.csvHeader] };
      return cm;
    });

    setColMappings(newMappings);
  };

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
      applyAIResult(result.mapping, csvHeaders, data);
      toast({ title: 'AI analysis complete', description: 'Review the suggested mapping below.' });
    } catch (err) {
      console.error('AI analysis failed:', err);
      toast({
        title: 'AI analysis failed',
        description: 'Map columns manually using the dropdowns below.',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTargetChange = (csvHeader: string, newTarget: TargetField) => {
    setColMappings(prev => {
      // For unique targets (title, content, category, tags, source_campaign),
      // clear any other column that had this target
      const uniqueTargets: TargetField[] = ['title', 'content', 'category', 'tags', 'source_campaign'];
      let updated = prev.map(cm => {
        if (uniqueTargets.includes(newTarget) && cm.target === newTarget && cm.csvHeader !== csvHeader) {
          return { ...cm, target: 'skip' as TargetField, metricName: undefined };
        }
        return cm;
      });
      // Apply the new target
      updated = updated.map(cm =>
        cm.csvHeader === csvHeader
          ? {
              ...cm,
              target: newTarget,
              metricName: newTarget === 'metric' ? (cm.metricName || snakeCase(csvHeader)) : undefined,
            }
          : cm
      );
      return updated;
    });
  };

  const handleMetricNameChange = (csvHeader: string, name: string) => {
    setColMappings(prev =>
      prev.map(cm =>
        cm.csvHeader === csvHeader ? { ...cm, metricName: name } : cm
      )
    );
  };

  const clearMapping = (csvHeader: string) => {
    handleTargetChange(csvHeader, 'skip');
  };

  const reset = () => {
    setStep('upload');
    setFileName('');
    setHeaders([]);
    setAllRows([]);
    setColMappings([]);
    setGlobalCategory('campaign_result');
    setIsAnalyzing(false);
    setIsStatsMode(false);
    setStatsTransformed([]);
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

        {/* Step 2: Mapping — CSV columns first */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{fileName}</span>
              <Badge variant="secondary">{allRows.length} rows</Badge>
              <Badge
                variant={canPreview ? 'default' : 'secondary'}
                className={cn(canPreview && 'bg-green-600 hover:bg-green-600')}
              >
                {mappedCount} of {colMappings.length} mapped
              </Badge>
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

            {/* Global category selector */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium whitespace-nowrap">Default Category:</span>
              <Select value={globalCategory} onValueChange={(v) => setGlobalCategory(v as KnowledgeCategory)}>
                <SelectTrigger className="w-[200px]">
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
              <span className="text-xs text-muted-foreground">
                Used unless a column is mapped to Category
              </span>
            </div>

            {/* Column mapping rows */}
            {!isAnalyzing && (
              <div className="max-h-[400px] overflow-y-auto pr-2 space-y-2">
                {colMappings.map((cm) => {
                  const isMapped = cm.target !== 'skip';
                  return (
                    <div
                      key={cm.csvHeader}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                        isMapped
                          ? 'border-l-4 border-l-green-500 border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20'
                          : 'border-dashed border-muted-foreground/30 bg-muted/30'
                      )}
                    >
                      {/* CSV column info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isMapped ? (
                            <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                          )}
                          <p className={cn(
                            'font-medium text-sm truncate',
                            isMapped && 'text-green-700 dark:text-green-400'
                          )}>
                            {cm.csvHeader}
                          </p>
                        </div>
                        {cm.preview.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1 truncate ml-6">
                            e.g. {cm.preview.slice(0, 2).map(v => `"${v}"`).join(', ')}
                          </p>
                        )}
                      </div>

                      {/* Target dropdown */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Select
                          value={cm.target}
                          onValueChange={(v) => handleTargetChange(cm.csvHeader, v as TargetField)}
                        >
                          <SelectTrigger className={cn(
                            'w-[180px]',
                            isMapped
                              ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                              : 'border-dashed border-muted-foreground/40'
                          )}>
                            <SelectValue placeholder="Skip this column" />
                          </SelectTrigger>
                          <SelectContent>
                            {TARGET_OPTIONS.map((opt) => {
                              // Disable unique targets already used by another column
                              const uniqueTargets: TargetField[] = ['title', 'content', 'category', 'tags', 'source_campaign'];
                              const isUsedElsewhere =
                                uniqueTargets.includes(opt.value) &&
                                colMappings.some(m => m.target === opt.value && m.csvHeader !== cm.csvHeader);
                              return (
                                <SelectItem
                                  key={opt.value}
                                  value={opt.value}
                                  disabled={isUsedElsewhere}
                                >
                                  {isUsedElsewhere ? `${opt.label} (mapped)` : opt.label}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>

                        {/* Metric name input */}
                        {cm.target === 'metric' && (
                          <Input
                            value={cm.metricName ?? ''}
                            onChange={(e) => handleMetricNameChange(cm.csvHeader, e.target.value)}
                            placeholder="metric_name"
                            className="w-[120px] h-9 text-xs"
                          />
                        )}

                        {isMapped && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => clearMapping(cm.csvHeader)}
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
            )}

            {/* Validation hints */}
            {!isAnalyzing && !canPreview && (
              <p className="text-xs text-destructive">
                Map at least one column to <strong>Title</strong> and one to <strong>Content</strong> to continue.
              </p>
            )}

            {!isAnalyzing && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => triggerAIAnalysis(headers, allRows)}
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Re-analyze with AI
                </Button>
                <Button onClick={() => setStep('preview')} disabled={!canPreview}>
                  Apply Mapping & Preview
                </Button>
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
              <Button variant="ghost" size="sm" onClick={() => {
                if (isStatsMode) {
                  // Switch from stats mode to manual mapping
                  setIsStatsMode(false);
                  setStatsTransformed([]);
                  setColMappings(buildInitialColMappings(headers, allRows));
                  setStep('mapping');
                  triggerAIAnalysis(headers, allRows);
                } else {
                  setStep('mapping');
                }
              }} className="ml-auto">
                {isStatsMode ? 'Edit Mapping' : 'Back to mapping'}
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

/** Simple snake_case helper for auto-generating metric names */
function snakeCase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}