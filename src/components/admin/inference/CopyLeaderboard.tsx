import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { MIN_SAMPLE, ReplyRow, copyLeaderboard, pct } from '@/lib/inferenceAnalytics';
import { SourceSplit } from '@/components/admin/inference/SourceSplit';

const TOP = 25;

export function CopyLeaderboard({ rows, segmentLabel }: { rows: ReplyRow[]; segmentLabel: string }) {
  const [rankBy, setRankBy] = useState<'count' | 'share'>('count');
  const { rows: copies, withoutCopy } = useMemo(() => copyLeaderboard(rows), [rows]);
  const ranked = useMemo(() => {
    if (rankBy === 'count') return copies.slice(0, TOP);
    // Share is only meaningful with enough replies behind it
    return copies
      .filter((c) => c.replies >= MIN_SAMPLE)
      .sort((a, b) => b.interestedShare - a.interestedShare || b.interested - a.interested)
      .slice(0, TOP);
  }, [copies, rankBy]);
  const live = rows.filter((r) => r.origin === 'live').length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Trophy className="h-4 w-4" /> Copy leaderboard
          <span className="text-xs font-normal text-muted-foreground">{segmentLabel}</span>
          <SourceSplit live={live} backfill={rows.length - live} className="ml-auto" />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Outbound copy (copy fingerprint, labelled by subject) ranked by interested replies.{' '}
          {withoutCopy.toLocaleString()} replies carry no copy id and are not ranked.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToggleGroup type="single" value={rankBy} onValueChange={(v) => v && setRankBy(v as 'count' | 'share')} className="justify-start">
          <ToggleGroupItem value="count" size="sm">By interested count</ToggleGroupItem>
          <ToggleGroupItem value="share" size="sm">By interested share (n ≥ {MIN_SAMPLE})</ToggleGroupItem>
        </ToggleGroup>
        {ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No copy with enough replies in this selection.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Copy</TableHead>
                  <TableHead className="text-right">Interested</TableHead>
                  <TableHead className="text-right">Replies (n)</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Interested share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map((c, i) => (
                  <TableRow key={c.key} className={cn(c.replies < MIN_SAMPLE && 'opacity-50')}>
                    <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-[28rem]">
                      <div className="truncate">{c.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">{c.key}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.interested.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{c.replies.toLocaleString()}</div>
                      <SourceSplit live={c.live} backfill={c.backfill} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(c.interestedShare)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
