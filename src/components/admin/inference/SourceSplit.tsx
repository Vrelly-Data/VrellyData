import { cn } from '@/lib/utils';

// Where the numbers next to it came from — shown on every panel that can mix live capture
// with backfilled history.
export function SourceSplit({ live, backfill, className }: { live: number; backfill: number; className?: string }) {
  return (
    <span className={cn('text-[10px] text-muted-foreground tabular-nums whitespace-nowrap', className)}>
      live {live.toLocaleString()} · backfill {backfill.toLocaleString()}
    </span>
  );
}
