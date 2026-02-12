import { useState, useMemo, useCallback } from 'react';
import { SalesKnowledgeImportDialog } from './SalesKnowledgeImportDialog';
import { SalesKnowledgeDocImportDialog } from './SalesKnowledgeDocImportDialog';
import {
  useAdminSalesKnowledge,
  type SalesKnowledgeEntry,
  type SalesKnowledgeInsert,
  type KnowledgeCategory,
} from '@/hooks/useAdminSalesKnowledge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from '@/components/ui/tag-input';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Search, Upload, FileText } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES: { value: KnowledgeCategory; label: string }[] = [
  { value: 'email_template', label: 'Email Template' },
  { value: 'sequence_playbook', label: 'Sequence Playbook' },
  { value: 'campaign_result', label: 'Campaign Result' },
  { value: 'sales_guideline', label: 'Sales Guideline' },
  { value: 'audience_insight', label: 'Audience Insight' },
];

const categoryLabel = (cat: KnowledgeCategory) =>
  CATEGORIES.find((c) => c.value === cat)?.label ?? cat;

const EMPTY_FORM: SalesKnowledgeInsert = {
  category: 'email_template',
  title: '',
  content: '',
  tags: [],
  metrics: {},
  source_campaign: '',
};

export function SalesKnowledgeTab() {
  const { entries, isLoading, createEntry, updateEntry, deleteEntry, bulkCreateEntries, bulkDeleteEntries } =
    useAdminSalesKnowledge();
  const [importOpen, setImportOpen] = useState(false);
  const [docImportOpen, setDocImportOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SalesKnowledgeInsert>({ ...EMPTY_FORM });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Filters
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    let result = entries;
    if (filterCategory !== 'all') {
      result = result.filter((e) => e.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entries, filterCategory, searchQuery]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  const someVisibleSelected = filtered.some((e) => selectedIds.has(e.id));

  const toggleSelectAll = useCallback(() => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((e) => e.id)));
    }
  }, [allVisibleSelected, filtered]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = () => {
    bulkDeleteEntries.mutate([...selectedIds], {
      onSuccess: () => {
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
      },
    });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (entry: SalesKnowledgeEntry) => {
    setEditingId(entry.id);
    setForm({
      category: entry.category,
      title: entry.title,
      content: entry.content,
      tags: entry.tags ?? [],
      metrics: (entry.metrics as Record<string, number>) ?? {},
      source_campaign: entry.source_campaign ?? '',
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.content.trim()) return;

    const payload = {
      ...form,
      source_campaign: form.source_campaign || undefined,
      metrics:
        form.metrics && Object.keys(form.metrics).length > 0
          ? form.metrics
          : undefined,
    };

    if (editingId) {
      updateEntry.mutate({ id: editingId, ...payload }, { onSuccess: () => setDialogOpen(false) });
    } else {
      createEntry.mutate(payload, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteEntry.mutate(deleteId, { onSuccess: () => setDeleteId(null) });
    }
  };

  const setMetric = (key: string, value: string) => {
    const num = parseFloat(value);
    setForm((prev) => ({
      ...prev,
      metrics: {
        ...(prev.metrics ?? {}),
        ...(value === '' ? {} : { [key]: isNaN(num) ? 0 : num }),
      },
    }));
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
            onCheckedChange={toggleSelectAll}
            disabled={filtered.length === 0}
          />
          <span className="text-sm text-muted-foreground">Select All</span>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Entry
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
        <Button variant="outline" onClick={() => setDocImportOpen(true)}>
          <FileText className="h-4 w-4 mr-2" />
          Import Doc
        </Button>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {selectedIds.size > 0 && (
          <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Selected ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* Entries */}
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          {entries.length === 0
            ? 'No knowledge entries yet. Click "Add Entry" to get started.'
            : 'No entries match your filters.'}
        </p>
      ) : (
        <div className="grid gap-4">
          {filtered.map((entry) => (
            <Card key={entry.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedIds.has(entry.id)}
                      onCheckedChange={() => toggleSelect(entry.id)}
                      className="mt-1"
                    />
                    <div className="space-y-1">
                      <Badge variant="outline" className="text-xs mb-1">
                        {categoryLabel(entry.category)}
                      </Badge>
                      <CardTitle className="text-base">{entry.title}</CardTitle>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(entry)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteId(entry.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                  {entry.content}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {entry.tags?.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {entry.metrics &&
                    Object.entries(entry.metrics as Record<string, number>).map(
                      ([k, v]) => (
                        <span key={k} className="text-xs">
                          {k.replace(/_/g, ' ')}: {v}
                          {k.toLowerCase().includes('rate') ? '%' : ''}
                        </span>
                      )
                    )}
                  <span className="ml-auto">
                    {format(new Date(entry.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Knowledge Entry' : 'Add Knowledge Entry'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Category</label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, category: v as KnowledgeCategory }))
                }
              >
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
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Cold Intro for SaaS CTOs"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Content</label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="The actual email copy, playbook steps, or learning..."
                rows={6}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Tags</label>
              <TagInput
                value={form.tags ?? []}
                onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                placeholder="Type a tag and press Enter"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Source Campaign (optional)</label>
              <Input
                value={form.source_campaign ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source_campaign: e.target.value }))
                }
                placeholder="e.g. Healthcare Outreach Q1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Reply Rate %</label>
                <Input
                  type="number"
                  value={form.metrics?.reply_rate ?? ''}
                  onChange={(e) => setMetric('reply_rate', e.target.value)}
                  placeholder="e.g. 9.2"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Sent</label>
                <Input
                  type="number"
                  value={form.metrics?.sent ?? ''}
                  onChange={(e) => setMetric('sent', e.target.value)}
                  placeholder="e.g. 2400"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !form.title.trim() ||
                !form.content.trim() ||
                createEntry.isPending ||
                updateEntry.isPending
              }
            >
              {editingId ? 'Save Changes' : 'Save Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All selected entries will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={bulkDeleteEntries.isPending}>
              {bulkDeleteEntries.isPending ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SalesKnowledgeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(entries) => {
          bulkCreateEntries.mutate(entries, { onSuccess: () => setImportOpen(false) });
        }}
        isPending={bulkCreateEntries.isPending}
      />

      {/* Import Doc Dialog */}
      <SalesKnowledgeDocImportDialog
        open={docImportOpen}
        onOpenChange={setDocImportOpen}
        onImport={(entry) => {
          createEntry.mutate(entry, { onSuccess: () => setDocImportOpen(false) });
        }}
        isPending={createEntry.isPending}
      />
    </div>
  );
}
