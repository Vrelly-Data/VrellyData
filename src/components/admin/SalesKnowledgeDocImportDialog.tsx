import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from '@/components/ui/tag-input';
import { FileText, Upload } from 'lucide-react';
import type { KnowledgeCategory, SalesKnowledgeInsert } from '@/hooks/useAdminSalesKnowledge';

const CATEGORIES: { value: KnowledgeCategory; label: string }[] = [
  { value: 'email_template', label: 'Email Template' },
  { value: 'sequence_playbook', label: 'Sequence Playbook' },
  { value: 'campaign_result', label: 'Campaign Result' },
  { value: 'sales_guideline', label: 'Sales Guideline' },
  { value: 'audience_insight', label: 'Audience Insight' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (entry: SalesKnowledgeInsert) => void;
  isPending: boolean;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    pages.push(text);
  }

  return pages.join('\n\n');
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function SalesKnowledgeDocImportDialog({ open, onOpenChange, onImport, isPending }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extractedContent, setExtractedContent] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('campaign_result');
  const [tags, setTags] = useState<string[]>([]);
  const [sourceCampaign, setSourceCampaign] = useState('');

  const reset = useCallback(() => {
    setFile(null);
    setExtractedContent('');
    setExtractError('');
    setExtracting(false);
    setTitle('');
    setCategory('campaign_result');
    setTags([]);
    setSourceCampaign('');
  }, []);

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleFileSelect = async (selected: File) => {
    setFile(selected);
    setExtractError('');
    setExtracting(true);

    try {
      const ext = selected.name.split('.').pop()?.toLowerCase();
      let content: string;

      if (ext === 'pdf') {
        content = await extractPdfText(selected);
      } else {
        content = await readTextFile(selected);
      }

      setExtractedContent(content);

      // Auto-fill title and source_campaign from filename (without extension)
      if (!title) {
        const baseName = selected.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setTitle(baseName);
        // Auto-link to matching campaign stats
        if (!sourceCampaign) {
          setSourceCampaign(baseName);
        }
      }
    } catch (err: any) {
      setExtractError(err.message || 'Failed to extract content');
      setExtractedContent('');
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = () => {
    if (!title.trim() || !extractedContent.trim()) return;

    const entry: SalesKnowledgeInsert = {
      category,
      title: title.trim(),
      content: extractedContent,
      tags: tags.length > 0 ? tags : undefined,
      source_campaign: sourceCampaign.trim() || undefined,
    };

    onImport(entry);
  };

  const canSave = title.trim() && extractedContent.trim() && !extracting && !isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Document</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File picker */}
          <div>
            <label className="text-sm font-medium">File (.txt, .md, .pdf)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />
            <Button
              variant="outline"
              className="w-full mt-1 justify-start gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {file ? file.name : 'Choose file...'}
            </Button>
            {extracting && (
              <p className="text-sm text-muted-foreground mt-1">Extracting content...</p>
            )}
            {extractError && (
              <p className="text-sm text-destructive mt-1">{extractError}</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="text-sm font-medium">Title (Campaign Name)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Healthcare Outreach Q1"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium">Category</label>
            <Select value={category} onValueChange={(v) => setCategory(v as KnowledgeCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">Tags</label>
            <TagInput
              value={tags}
              onChange={setTags}
              placeholder="Type a tag and press Enter"
            />
          </div>

          {/* Source Campaign */}
          <div>
            <label className="text-sm font-medium">Source Campaign (optional)</label>
            <Input
              value={sourceCampaign}
              onChange={(e) => setSourceCampaign(e.target.value)}
              placeholder="e.g. Healthcare Outreach Q1"
            />
          </div>

          {/* Content Preview */}
          {extractedContent && (
            <div>
              <label className="text-sm font-medium">Content Preview</label>
              <Textarea
                value={extractedContent.slice(0, 2000)}
                readOnly
                rows={8}
                className="mt-1 text-xs text-muted-foreground"
              />
              {extractedContent.length > 2000 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Showing first 2,000 of {extractedContent.length.toLocaleString()} characters
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            <FileText className="h-4 w-4 mr-2" />
            {isPending ? 'Saving...' : 'Save as Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
