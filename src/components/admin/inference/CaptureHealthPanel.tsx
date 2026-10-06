import { useState } from 'react';
import { ChevronDown, HeartPulse, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { DataCoverageCard } from '@/components/admin/DataCoverageCard';
import { useLinkedinAcceptance } from '@/hooks/useInferenceData';
import { useCaptureHealth } from '@/hooks/useInferenceInsights';

function Tile({ title, value, footnote }: { title: string; value: React.ReactNode; footnote: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{footnote}</p>
    </div>
  );
}

// Formerly "Vrelly-captured events" + "Data coverage". Scoped to live capture (backfill
// excluded) so it answers one question: is capture working?
export function CaptureHealthPanel() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useCaptureHealth(open);
  const { data: liAcceptance, isLoading: loadingAcceptance } = useLinkedinAcceptance();
  const email = data?.find((c) => c.channel === 'email');
  const linkedin = data?.find((c) => c.channel === 'linkedin');
  const n = (v: number | undefined) => (isLoading || v === undefined ? '…' : v.toLocaleString());

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none">
            <CardTitle className="text-base flex items-center gap-2">
              <HeartPulse className="h-4 w-4" /> Capture health
              <span className="text-xs font-normal text-muted-foreground">live capture only · backfill excluded</span>
              <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-6">
            {error ? (
              <p className="text-sm text-destructive">Failed to load capture health: {(error as Error).message}</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Tile title="Total LI Contacts" value={n(linkedin?.contacts)} footnote="People with a live LinkedIn event" />
                  <Tile title="Total Email Contacts" value={n(email?.contacts)} footnote="People with a live email event" />
                  <Tile title="Total LI Replies" value={n(linkedin?.repliedPeople)} footnote="People who replied on LinkedIn (live)" />
                  <Tile
                    title="Total LI Acceptance"
                    value={
                      loadingAcceptance ? '…' : liAcceptance ? (
                        liAcceptance.total.toLocaleString()
                      ) : (
                        <span className="text-xs font-normal text-muted-foreground">not available</span>
                      )
                    }
                    footnote={
                      liAcceptance
                        ? `Platform-reported, not captured: Reply.io team stats (${liAcceptance.replyIoAccepted.toLocaleString()}) + HeyReach overallStats (${liAcceptance.heyreachAccepted.toLocaleString()})`
                        : 'Platform-reported; needs the admin_linkedin_acceptance_stats migration'
                    }
                  />
                  <Tile title="Total Email Replies" value={n(email?.repliedPeople)} footnote="People who replied via email (live)" />
                  <Tile title="Interested Email Replies" value={n(email?.interestedPeople)} footnote="People classified interested (email, live)" />
                  <Tile title="Interested LI Replies" value={n(linkedin?.interestedPeople)} footnote="People classified interested (LinkedIn, live)" />
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Data coverage</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Share of live replied + interested events carrying each field as written at capture. "With people"
                    includes firmographics joined from the people table.
                  </p>
                  {isLoading || !data ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <DataCoverageCard data={data} />
                  )}
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
