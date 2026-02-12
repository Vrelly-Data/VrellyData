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
import { Upload, CheckCircle, XCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { SalesKnowledgeInsert } from '@/hooks/useAdminSalesKnowledge';
import { detectStatsCSV, transformStatsRows } from '@/lib/statsCSVDetector';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (entries: SalesKnowledgeInsert[]) => void;
  isPending: boolean;
}

type Step = 'upload' | 'preview';

export function SalesKnowledgeImportDialog({ open, onOpenChange, onImport, isPending }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [transformedRows, setTransformedRows] = useState<{ entry: SalesKnowledgeInsert; valid: boolean; error?: string }[]>([]);

  const validRows = useMemo(() => transformedRows.filter(r => r.valid), [transformedRows]);
  const invalidRows = useMemo(() => transformedRows.filter(r => !r.valid), [transformedRows]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedHeaders = results.meta.fields ?? [];
        const config = detectStatsCSV(parsedHeaders, results.data);
        const transformed = transformStatsRows(results.data, config);
        setTransformedRows(transformed);
        setStep('preview');
        toast({
          title: 'CSV parsed',
          description: `Found ${transformed.filter(r => r.valid).length} campaign results.`,
        });
      },
    });
  }, []);

  const reset = () => {
    setStep('upload');
    setFileName('');
    setTransformedRows([]);
  };

  const handleImport = () => {
    onImport(validRows.map(r => r.entry));
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
            {step === 'upload' ? 'Import Campaign Stats from CSV' : 'Preview & Confirm Import'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-muted-foreground/30 rounded-lg p-10 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Drop or select a CSV with campaign stats — we'll extract the title and metrics
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

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{fileName}</span>
              <Badge variant="secondary">{validRows.length} valid</Badge>
              {invalidRows.length > 0 && (
                <Badge variant="destructive">{invalidRows.length} invalid</Badge>
              )}
              <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">
                Choose different file
              </Button>
            </div>

            <div className="max-h-[400px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Metrics</TableHead>
                    <TableHead className="w-16">Valid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transformedRows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? '' : 'bg-destructive/5'}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm truncate max-w-[250px]">
                        {row.valid ? row.entry.title : row.error}
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-[250px] text-muted-foreground">
                        {row.valid ? row.entry.content : '—'}
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
