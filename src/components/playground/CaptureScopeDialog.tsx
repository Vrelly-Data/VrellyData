// Capture Scope — campaign selection for platforms with no capture control.
// Stage 3 of 5.
//
// A FORK of ManageCampaignsDialog, not a generalisation of it. That dialog
// serves Reply.io, most clients are on Reply.io, and making it platform-
// agnostic would mean reshaping the props and hook return it consumes. This
// file imports nothing from it and nothing from useAvailableCampaigns.
//
// It is meaningfully smaller than the original because the Reply.io workspace
// machinery (skipTeamFilter, discoveredTeamIds, multi-team badges, add-another-
// workspace) has no analogue on any other platform and is simply absent.
//
// WHAT THE TOGGLE MEANS: capture_enabled controls whether Vrelly ingests
// replies at all — when off, no lead row is created. It is NOT is_linked,
// which is Data Analysis reporting scope. Keeping those distinct in the copy
// is the point; conflating them is the confusion this feature exists to end.

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Users, Building2, Mail, ChevronRight, ChevronDown } from 'lucide-react';
import { useCaptureScope, type CaptureScopeCampaign } from '@/hooks/useCaptureScope';

interface CaptureScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationId: string | null;
  platformLabel?: string;
}

function statusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'in_progress':
      return <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-xs">Sending</Badge>;
    case 'paused':
      return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 text-xs">Paused</Badge>;
    case 'completed':
      return <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs">Completed</Badge>;
    case 'draft':
      return <Badge className="bg-gray-500/15 text-gray-600 border-gray-500/30 text-xs">Draft</Badge>;
    case 'stopped':
    case 'archived':
      return <Badge variant="outline" className="text-xs capitalize">{status}</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export function CaptureScopeDialog({
  open, onOpenChange, integrationId, platformLabel,
}: CaptureScopeDialogProps) {
  const {
    campaigns, groups, counts, sendersAvailable, sendersLoadedFor,
    isLoading, error, refetch, loadSenders, sendersLoading, sendersProgress,
    save, isSaving,
  } = useCaptureScope(integrationId, open);

  const [searchQuery, setSearchQuery] = useState('');
  const [selections, setSelections] = useState<Map<string, boolean>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Reset local state whenever the dialog is opened for an integration, so a
  // previous session's unsaved edits can never leak into a new one.
  useEffect(() => {
    if (!open) return;
    setSearchQuery('');
    setSelections(new Map());
    setExpanded(new Set());
    refetch();
  }, [open, integrationId]);

  const effective = (c: CaptureScopeCampaign) => selections.get(c.externalId) ?? c.captureEnabled;

  const changes = useMemo(
    () => campaigns
      .filter((c) => effective(c) !== c.captureEnabled)
      .map((c) => ({ externalId: c.externalId, captureEnabled: effective(c) })),
    [campaigns, selections],
  );
  const turningOff = changes.filter((c) => !c.captureEnabled).length;

  const isFiltered = searchQuery.trim().length > 0;

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.externalId.includes(q) ||
      c.group?.label.toLowerCase().includes(q) ||
      c.senders.some((s) => s.label.toLowerCase().includes(q) || s.identifier.includes(q)));
  }, [campaigns, searchQuery]);

  const enabledCount = campaigns.filter(effective).length;
  const setMany = (list: CaptureScopeCampaign[], value: boolean) => {
    const next = new Map(selections);
    list.forEach((c) => next.set(c.externalId, value));
    setSelections(next);
  };

  const commit = async () => {
    if (changes.length > 0) await save(changes);
    setSelections(new Map());
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            {/* Same user-facing name as Reply.io's dialog: it is the same
                concept to the user. The separate implementation underneath is
                an engineering safety decision, not a product distinction. The
                two buttons are mutually exclusive per integration row
                (isReplyIo vs isCaptureScopePlatform), so they never appear
                together and the shared label cannot be ambiguous. */}
            <DialogTitle>Manage Campaigns{platformLabel ? ` — ${platformLabel}` : ''}</DialogTitle>
            <DialogDescription>
              Choose which campaigns Vrelly listens to. Replies from campaigns that are switched
              off are not captured at all — no lead is created and no draft is written. This is
              separate from Data Analysis reporting scope.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 flex-1 min-h-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={sendersAvailable
                  ? 'Search campaign, ID, sender or client…'
                  : 'Search campaign or ID…'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Sub-tenants. This is how a separate business ended up inside a
                client's account — surfacing it is the point, not decoration. */}
            {groups.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-md border border-border">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-sm flex-1 min-w-0">
                  <span className="text-muted-foreground">
                    This account contains campaigns belonging to separate clients:
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {groups.map((g) => (
                      <Badge key={g.id} variant="secondary" className="text-xs">
                        {g.label}: {g.campaignCount}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Bulk actions apply to the CURRENT SEARCH RESULTS, not the whole
                list. With 379 campaigns that distinction is the difference
                between enabling 12 and enabling everything, so the label says
                "matching" whenever a search is narrowing the set rather than
                leaving the count to be read ambiguously. */}
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <Button variant="ghost" size="sm" className="h-8"
                disabled={filtered.length === 0}
                onClick={() => setMany(filtered, true)}>
                {isFiltered
                  ? `Enable ${filtered.length} matching`
                  : `Enable all (${filtered.length})`}
              </Button>
              <Button variant="ghost" size="sm" className="h-8"
                disabled={filtered.length === 0}
                onClick={() => setMany(filtered, false)}>
                {isFiltered ? `Disable ${filtered.length} matching` : 'Disable all'}
              </Button>
              {sendersAvailable && (
                <Button
                  variant="outline" size="sm" className="h-8"
                  disabled={sendersLoading || filtered.length === 0}
                  onClick={() => loadSenders(filtered.map((c) => c.externalId))}
                >
                  {sendersLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      {sendersProgress ? `${sendersProgress.done}/${sendersProgress.total}` : 'Loading'}
                    </>
                  ) : (
                    <><Mail className="h-3.5 w-3.5 mr-1.5" />Load senders for all {filtered.length}</>
                  )}
                </Button>
              )}
              <span className="ml-auto text-muted-foreground">
                {enabledCount} of {counts.total || campaigns.length} capturing
              </span>
            </div>

            <ScrollArea className="h-[420px] border rounded-md">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="mt-2 text-muted-foreground">Loading campaigns…</span>
                </div>
              ) : error ? (
                <div className="text-center py-12 text-destructive px-6">
                  Failed to load campaigns: {error.message}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {searchQuery ? 'No campaigns match your search' : 'No campaigns found'}
                </div>
              ) : (
                <div className="divide-y">
                  {filtered.map((c) => (
                    <CampaignRow
                      key={c.externalId}
                      campaign={c}
                      checked={effective(c)}
                      sendersFetched={c.externalId in sendersLoadedFor}
                      expanded={expanded.has(c.externalId)}
                      sendersAvailable={sendersAvailable}
                      onToggle={() => {
                        const next = new Map(selections);
                        next.set(c.externalId, !effective(c));
                        setSelections(next);
                      }}
                      onToggleExpand={() => {
                        const next = new Set(expanded);
                        if (next.has(c.externalId)) next.delete(c.externalId);
                        else {
                          next.add(c.externalId);
                          // Fetch this one campaign's senders on demand. One
                          // request, ~1s — as opposed to the bulk button,
                          // which walks every filtered campaign and takes
                          // minutes against the vendor rate limit.
                          if (!(c.externalId in sendersLoadedFor)) loadSenders([c.externalId]);
                        }
                        setExpanded(next);
                      }}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={isSaving || changes.length === 0}
              onClick={() => (turningOff > 0 ? setConfirmOpen(true) : commit())}
            >
              {isSaving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
                : `Save${changes.length ? ` (${changes.length})` : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Switching capture off is the destructive direction — replies stop
          being captured entirely. Confirm it explicitly; enabling needs no
          prompt. Stage 4 extends this to also deregister the webhook. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Stop capturing {turningOff} campaign{turningOff === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Replies to {turningOff === 1 ? 'this campaign' : 'these campaigns'} will no longer be
              captured — no lead will be created and no draft written. Replies already in the inbox
              are not affected, and you can switch capture back on at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); commit(); }}>
              Stop capturing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CampaignRow({
  campaign, checked, sendersFetched, expanded, sendersAvailable, onToggle, onToggleExpand,
}: {
  campaign: CaptureScopeCampaign;
  checked: boolean;
  sendersFetched: boolean;
  expanded: boolean;
  sendersAvailable: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
}) {
  const { volume, senders, group } = campaign;
  const personas = [...new Set(senders.map((s) => s.label))];

  return (
    <div className="px-4 py-3 hover:bg-muted/50">
      <div className="flex items-start gap-3 cursor-pointer" onClick={onToggle}>
        <Checkbox checked={checked} onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{campaign.name}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{campaign.externalId}</span>
            {group && <Badge variant="secondary" className="text-[10px]">{group.label}</Badge>}
            {/* The sender summary is a CONTROL, not a label. Every inbox on a
                campaign usually shares one from_name, so "Marcus Reid · 30
                inboxes" collapsed 30 distinct addresses into what read as a
                bare count — the addresses were fetched and held in state but
                never rendered anywhere. This toggle reveals them. */}
            {sendersAvailable && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                className="inline-flex items-center gap-1 hover:text-foreground underline-offset-2 hover:underline"
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {!sendersFetched
                  ? 'Show senders'
                  : senders.length === 0
                    ? 'No sender accounts'
                    : `${personas.slice(0, 2).join(', ')}${personas.length > 2 ? ` +${personas.length - 2}` : ''} · ${senders.length} inbox${senders.length === 1 ? '' : 'es'}`}
              </button>
            )}
          </div>
        </div>
        {statusBadge(campaign.status)}
        {/* null volume means unknown, so render nothing rather than a false 0 */}
        {volume.sent !== null && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
            <Users className="h-3.5 w-3.5" />
            <span className="tabular-nums">{volume.sent.toLocaleString()}</span>
            {volume.replies !== null && (
              <span className="tabular-nums">· {volume.replies.toLocaleString()} repl</span>
            )}
          </div>
        )}
      </div>

      {/* The actual sending inboxes. This is the thing the counts were hiding:
          which addresses a campaign sends from, which is how you tell whose
          campaign it is. */}
      {expanded && (
        <div className="mt-2 ml-7 rounded-md border bg-muted/30 px-3 py-2">
          {!sendersFetched ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading senders…
            </div>
          ) : senders.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              No sender accounts are attached to this campaign in Smartlead.
            </div>
          ) : (
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {senders.map((s) => (
                <li key={s.identifier} className="text-xs min-w-0">
                  <span className="font-medium">{s.label}</span>
                  {s.label !== s.identifier && (
                    <span className="text-muted-foreground font-mono block truncate">{s.identifier}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
