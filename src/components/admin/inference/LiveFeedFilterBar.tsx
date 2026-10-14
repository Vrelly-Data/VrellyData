import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';
import { useFeedTeams } from '@/hooks/useInferenceInsights';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  type Channel,
  DEFAULT_CATEGORIES,
  type LiveFeedFilters,
  PLATFORM_LABELS,
  PLATFORMS,
  type Platform,
} from '@/lib/liveFeedFilters';

const ALL = '__all__';

export function LiveFeedFilterBar({
  filters,
  onChange,
}: {
  filters: LiveFeedFilters;
  onChange: (f: LiveFeedFilters) => void;
}) {
  const teams = useFeedTeams();
  const set = (patch: Partial<LiveFeedFilters>) => onChange({ ...filters, ...patch });
  const reset = () =>
    onChange({ team: null, platforms: [], categories: [...DEFAULT_CATEGORIES], channel: null, from: null, to: null });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Team</Label>
        <Select value={filters.team ?? ALL} onValueChange={(v) => set({ team: v === ALL ? null : v })}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All teams</SelectItem>
            {(teams.data ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 w-48">
        <Label className="text-xs">Platform</Label>
        <MultiSelectDropdown
          options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
          selected={filters.platforms}
          onChange={(v) => set({ platforms: v as Platform[] })}
          placeholder="All platforms"
        />
      </div>
      <div className="space-y-1 w-56">
        <Label className="text-xs">Reply category</Label>
        <MultiSelectDropdown
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          selected={filters.categories}
          onChange={(v) => set({ categories: v as Category[] })}
          placeholder="All categories"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Channel</Label>
        <Select value={filters.channel ?? ALL} onValueChange={(v) => set({ channel: v === ALL ? null : (v as Channel) })}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All channels</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input
          type="date"
          className="w-40"
          value={filters.from ?? ''}
          onChange={(e) => set({ from: e.target.value || null })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" className="w-40" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
      </div>
      <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
        <X className="h-3.5 w-3.5" /> Reset
      </Button>
    </div>
  );
}
