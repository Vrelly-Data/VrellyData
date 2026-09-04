import { Lock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AUDIENCE_SOURCES, SOURCE_ORDER, getAudienceSource, type AudienceSourceId,
} from '@/lib/audienceSources';

/**
 * Which data source an audience searches.
 *
 * STAGE 2. Every option is rendered from AUDIENCE_SOURCES rather than written
 * out here, so enabling a source later is a one-line change to the registry and
 * touches no JSX. Today that means Apollo is the only selectable entry and the
 * other three are visible-but-disabled — which is the point of showing them at
 * all: an operator who wants Vrelly should find out it is coming, not conclude
 * the product does not have it.
 *
 * DISABLED ITEMS EXPLAIN THEMSELVES INLINE rather than through a tooltip.
 * Radix marks a disabled SelectItem pointer-events-none, so a tooltip on one
 * never fires — the reason would be invisible precisely on the items that need
 * it. Printing it under the label always works.
 */
export function AudienceSourceSelect({
  value, onChange, locked = false,
}: {
  value: AudienceSourceId;
  onChange: (v: AudienceSourceId) => void;
  /**
   * Editing an existing audience. See the caller for why this is not editable:
   * filters are stored in the selected source's own vocabulary, so changing the
   * source under saved filters reinterprets them as a language they are not.
   */
  locked?: boolean;
}) {
  const selected = getAudienceSource(value);

  // Available first, then the rest — SOURCE_ORDER prefers Vrelly, which is not
  // selectable yet, and an unpickable first row reads as a broken dropdown.
  const available = SOURCE_ORDER.filter((id) => AUDIENCE_SOURCES[id].available);
  const unavailable = SOURCE_ORDER.filter((id) => !AUDIENCE_SOURCES[id].available);

  const renderItem = (id: AudienceSourceId) => {
    const s = AUDIENCE_SOURCES[id];
    return (
      <SelectItem key={s.id} value={s.id} disabled={!s.available}>
        <div className="flex flex-col items-start gap-0.5 py-0.5">
          <span className="font-medium">{s.label}</span>
          <span className="text-xs text-muted-foreground">
            {s.available ? s.description : s.unavailableReason}
          </span>
        </div>
      </SelectItem>
    );
  };

  return (
    <div>
      <Label className="flex items-center gap-1.5">
        Source
        {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={locked}>
        <SelectTrigger>
          <SelectValue>{selected.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {available.map(renderItem)}
          {unavailable.length > 0 && <SelectSeparator />}
          {unavailable.map(renderItem)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground mt-1">
        {locked
          ? "A saved audience keeps its source — its filters are written in that source's own vocabulary."
          : selected.description}
      </p>
    </div>
  );
}
