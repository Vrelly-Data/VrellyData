import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  usePipelineTags,
  useLeadTags,
  useCreateTag,
  useApplyTag,
  useRemoveTag,
  type PipelineTag,
} from '@/hooks/usePipelineTags';

// Readable text color for a chip given its background hex (white on dark).
function chipTextColor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#fff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  // Perceived luminance.
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111827' : '#ffffff';
}

function Chip({ tag, onRemove }: { tag: PipelineTag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: tag.color, color: chipTextColor(tag.color) }}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-70 hover:opacity-100"
          title="Remove tag"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function LeadTagsSection({ leadId }: { leadId: string }) {
  const { data: allTags = [] } = usePipelineTags();
  const { data: leadTags = [] } = useLeadTags(leadId);
  const createTag = useCreateTag();
  const applyTag = useApplyTag();
  const removeTag = useRemoveTag();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const appliedIds = useMemo(() => new Set(leadTags.map((t) => t.id)), [leadTags]);
  const q = query.trim().toLowerCase();
  const available = allTags.filter(
    (t) => !appliedIds.has(t.id) && (!q || t.name.toLowerCase().includes(q)),
  );
  const exactExists = allTags.some((t) => t.name.toLowerCase() === q);

  const apply = async (tagId: string) => {
    try {
      await applyTag.mutateAsync({ leadId, tagId });
    } catch (e) {
      toast.error(`Couldn't apply tag: ${(e as Error).message}`);
    }
  };

  const createAndApply = async () => {
    const name = query.trim();
    if (!name) return;
    try {
      const tag = await createTag.mutateAsync(name);
      await applyTag.mutateAsync({ leadId, tagId: tag.id });
      setQuery('');
    } catch (e) {
      toast.error(`Couldn't create tag: ${(e as Error).message}`);
    }
  };

  const remove = async (tagId: string) => {
    try {
      await removeTag.mutateAsync({ leadId, tagId });
    } catch (e) {
      toast.error(`Couldn't remove tag: ${(e as Error).message}`);
    }
  };

  const busy = createTag.isPending || applyTag.isPending;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">Tags</h4>
      <div className="flex flex-wrap items-center gap-1.5">
        {leadTags.map((t) => (
          <Chip key={t.id} tag={t} onRemove={() => remove(t.id)} />
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/40"
            >
              <Plus className="h-3 w-3" /> Add tag
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find or create a tag…"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim() && !exactExists) createAndApply();
              }}
            />
            <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => apply(t.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-accent/50"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              {q && !exactExists && (
                <button
                  type="button"
                  onClick={createAndApply}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-primary hover:bg-accent/50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Create “{query.trim()}”
                </button>
              )}
              {!q && available.length === 0 && (
                <p className="px-1.5 py-1 text-xs text-muted-foreground">
                  Type to create your first tag.
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
