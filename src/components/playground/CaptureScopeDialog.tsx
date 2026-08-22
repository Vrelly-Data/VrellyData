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
import { Loader2, Search, Users, Building2, Mail } from 'lucide-react';
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

  // Reset local state whenever the dialog is opened for an integration, so a
  // previous session's unsaved edits can never leak into a new one.
  useEffect(() => {
    if (!open) return;
    setSearchQuery('');
    setSelections(new Map());
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
            <DialogTitle>Capture Scope{platformLabel ? ` — ${platformLabel}` : ''}</DialogTitle>
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

            <div className="flex items-center gap-3 text-sm flex-wrap">
              <Button variant="ghost" size="sm" className="h-8"
                onClick={() => setMany(filtered, true)}>
                Enable all ({filtered.length})
              </Button>
              <Button variant="ghost" size="sm" className="h-8"
                onClick={() => setMany(filtered, false)}>
                Disable all
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
                    <><Mail className="h-3.5 w-3.5 mr-1.5" />Load senders</>
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
                      onToggle={() => {
                        const next = new Map(selections);
                        next.set(c.externalId, !effective(c));
                        setSelections(next);
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
  campaign, checked, sendersFetched, onToggle,
}: {
  campaign: CaptureScopeCampaign;
  checked: boolean;
  sendersFetched: boolean;
  onToggle: () => void;
}) {
  const { volume, senders, group } = campaign;
  const personas = [...new Set(senders.map((s) => s.label))];

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer"
      onClick={onToggle}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{campaign.name}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
          <span className="font-mono">{campaign.externalId}</span>
          {group && <Badge variant="secondary" className="text-[10px]">{group.label}</Badge>}
          {sendersFetched && (
            personas.length > 0
              ? <span className="truncate">{personas.slice(0, 2).join(', ')}
                  {personas.length > 2 ? ` +${personas.length - 2}` : ''}
                  {senders.length > 0 ? ` · ${senders.length} inbox${senders.length === 1 ? '' : 'es'}` : ''}
                </span>
              : <span className="italic">no sender accounts</span>
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
  );
}
