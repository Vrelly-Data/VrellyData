import { useState, useCallback } from 'react';
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
import type { SalesKnowledgeInsert, KnowledgeCategory } from '@/hooks/useAdminSalesKnowledge';

const VALID_CATEGORIES: KnowledgeCategory[] = [
  'email_template',
  'sequence_playbook',
  'campaign_result',
  'sales_guideline',
  'audience_insight',
];

interface ParsedRow {
  entry: SalesKnowledgeInsert;
  valid: boolean;
  error?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (entries: SalesKnowledgeInsert[]) => void;
  isPending: boolean;
}

function parseRow(raw: Record<string, string>): ParsedRow {
  const category = (raw.category ?? '').trim().toLowerCase() as KnowledgeCategory;
  const title = (raw.title ?? '').trim();
  const content = (raw.content ?? '').trim();

  if (!VALID_CATEGORIES.includes(category)) {
    return { entry: {} as any, valid: false, error: `Invalid category "${raw.category}"` };
  }
  if (!title) return { entry: {} as any, valid: false, error: 'Missing title' };
  if (!content) return { entry: {} as any, valid: false, error: 'Missing content' };

  const tags = (raw.tags ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

  const metrics: Record<string, number> = {};
  const replyRate = parseFloat(raw.reply_rate ?? '');
  const sent = parseFloat(raw.sent ?? '');
  if (!isNaN(replyRate)) metrics.reply_rate = replyRate;
  if (!isNaN(sent)) metrics.sent = sent;

  return {
    valid: true,
    entry: {
      category,
      title,
      content,
      tags: tags.length ? tags : undefined,
      metrics: Object.keys(metrics).length ? metrics : undefined,
      source_campaign: (raw.source_campaign ?? '').trim() || undefined,
    },
  };
}

export function SalesKnowledgeImportDialog({ open, onOpenChange, onImport, isPending }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows(results.data.map(parseRow));
      },
    });
  }, []);

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);

  const handleImport = () => {
    onImport(validRows.map((r) => r.entry));
  };

  const reset = () => {
    setRows([]);
    setFileName('');
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
          <DialogTitle>Import Sales Knowledge from CSV</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-muted-foreground/30 rounded-lg p-10 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Drag & drop a CSV file here, or click to browse
            </span>
            <span className="text-xs text-muted-foreground">
              Expected columns: category, title, content, tags, reply_rate, sent, source_campaign
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
        ) : (
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
                    <TableHead>Category</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-16">Valid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
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
          <Button
            onClick={handleImport}
            disabled={validRows.length === 0 || isPending}
          >
            {isPending ? 'Importing...' : `Import ${validRows.length} Entries`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
