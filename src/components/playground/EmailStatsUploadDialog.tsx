import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileSpreadsheet, Check, Loader2, Mail } from 'lucide-react';
import { useSyncedCampaigns, findMatchingCampaign } from '@/hooks/useSyncedCampaigns';
import { useEmailStatsUpload, EmailStatsRow } from '@/hooks/useEmailStatsUpload';

interface EmailStatsUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type UploadStep = 'upload' | 'preview' | 'importing';

const CAMPAIGN_NAME_ALIASES = ['sequence name', 'sequence', 'campaign', 'name', 'campaign name'];
const SEQUENCE_ID_ALIASES = ['sequence id', 'sequence_id', 'campaign id'];
const DELIVERED_ALIASES = ['delivered count', 'delivered', 'emails delivered'];
const REPLIED_ALIASES = ['replied count', 'replied', 'replies', 'email replies'];
const OPENED_ALIASES = ['opened count', 'opened', 'opens'];
const BOUNCED_ALIASES = ['bounced count', 'bounced'];
const CLICKED_ALIASES = ['clicked count', 'clicked', 'clicks'];
const OOO_ALIASES = ['outofoffice count', 'outofoffice', 'out of office'];
const OPTED_OUT_ALIASES = ['optedout count', 'optedout', 'opted out'];
const INTERESTED_ALIASES = ['interested count', 'interested'];
const NOT_INTERESTED_ALIASES = ['notinterested count', 'notinterested', 'not interested'];
const AUTO_REPLIED_ALIASES = ['autoreplied count', 'autoreplied', 'auto replied'];

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim();
}

function findCol(headers: string[], aliases: string[]): string | null {
  for (const h of headers) {
    if (aliases.includes(normalizeHeader(h))) return h;
  }
  return null;
}

function parseNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function EmailStatsUploadDialog({ open, onOpenChange }: EmailStatsUploadDialogProps) {
  const [step, setStep] = useState<UploadStep>('upload');
  const [parsedStats, setParsedStats] = useState<EmailStatsRow[]>([]);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [error, setError] = useState<string | null>(null);

  const { data: campaigns = [] } = useSyncedCampaigns(false);
  const uploadMutation = useEmailStatsUpload();

  const resetDialog = useCallback(() => {
    setStep('upload');
    setParsedStats([]);
    setError(null);
    setMode('replace');
  }, []);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) resetDialog();
    onOpenChange(newOpen);
  }, [onOpenChange, resetDialog]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];

        const campaignCol = findCol(headers, CAMPAIGN_NAME_ALIASES);
        const seqIdCol = findCol(headers, SEQUENCE_ID_ALIASES);
        const deliveredCol = findCol(headers, DELIVERED_ALIASES);
        const repliedCol = findCol(headers, REPLIED_ALIASES);

        if (!campaignCol) {
          setError('Could not find campaign/sequence name column. Expected: ' + CAMPAIGN_NAME_ALIASES.join(', '));
          return;
        }
        if (!deliveredCol && !repliedCol) {
          setError('Could not find Delivered or Replied columns. Expected: ' + [...DELIVERED_ALIASES, ...REPLIED_ALIASES].join(', '));
          return;
        }

        const openedCol = findCol(headers, OPENED_ALIASES);
        const bouncedCol = findCol(headers, BOUNCED_ALIASES);
        const clickedCol = findCol(headers, CLICKED_ALIASES);
        const oooCol = findCol(headers, OOO_ALIASES);
        const optedOutCol = findCol(headers, OPTED_OUT_ALIASES);
        const interestedCol = findCol(headers, INTERESTED_ALIASES);
        const notInterestedCol = findCol(headers, NOT_INTERESTED_ALIASES);
        const autoRepliedCol = findCol(headers, AUTO_REPLIED_ALIASES);

        const stats: EmailStatsRow[] = (results.data as Record<string, unknown>[])
          .map((row) => {
            const campaignName = String(row[campaignCol] || '').trim();
            if (!campaignName) return null;

            const sequenceId = seqIdCol ? String(row[seqIdCol] || '').trim() || null : null;

            // Match by sequence ID first, then name
            let matchedCampaign = sequenceId
              ? campaigns.find(c => c.external_campaign_id === sequenceId)
              : null;
            if (!matchedCampaign) {
              matchedCampaign = findMatchingCampaign(campaigns, campaignName);
            }

            return {
              campaignName,
              sequenceId,
              delivered: deliveredCol ? parseNum(row[deliveredCol]) : 0,
              replies: repliedCol ? parseNum(row[repliedCol]) : 0,
              opens: openedCol ? parseNum(row[openedCol]) : 0,
              clicked: clickedCol ? parseNum(row[clickedCol]) : 0,
              bounced: bouncedCol ? parseNum(row[bouncedCol]) : 0,
              outOfOffice: oooCol ? parseNum(row[oooCol]) : 0,
              optedOut: optedOutCol ? parseNum(row[optedOutCol]) : 0,
              interested: interestedCol ? parseNum(row[interestedCol]) : 0,
              notInterested: notInterestedCol ? parseNum(row[notInterestedCol]) : 0,
              autoReplied: autoRepliedCol ? parseNum(row[autoRepliedCol]) : 0,
              matched: !!matchedCampaign,
              campaignId: matchedCampaign?.id,
            } as EmailStatsRow;
          })
          .filter(Boolean) as EmailStatsRow[];

        if (stats.length === 0) {
          setError('No valid data rows found in CSV');
          return;
        }

        setParsedStats(stats);
        setStep('preview');
      },
      error: (parseError) => {
        setError(`Failed to parse CSV: ${parseError.message}`);
      },
    });

    event.target.value = '';
  }, [campaigns]);

  const handleImport = useCallback(async () => {
    setStep('importing');
    try {
      await uploadMutation.mutateAsync({ stats: parsedStats, mode });
      handleOpenChange(false);
    } catch {
      setStep('preview');
    }
  }, [parsedStats, mode, uploadMutation, handleOpenChange]);

  const matchedCount = parsedStats.filter(s => s.matched).length;
  const unmatchedCount = parsedStats.length - matchedCount;
  const totalDelivered = parsedStats.reduce((sum, s) => sum + s.delivered, 0);
  const totalReplies = parsedStats.reduce((sum, s) => sum + s.replies, 0);
  const totalOpens = parsedStats.reduce((sum, s) => sum + s.opens, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Upload Email Stats
          </DialogTitle>
          <DialogDescription>
            Import email metrics from a Reply.io sequence-based CSV export to fill in dashboard stats.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="flex flex-col items-center justify-center py-10 px-4 border-2 border-dashed rounded-lg">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground mb-4 text-center">
              Upload a Sequence-based CSV export from Reply.io containing email engagement metrics
            </p>
            <Label htmlFor="email-csv-upload" className="cursor-pointer">
              <div className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                <Upload className="h-4 w-4" />
                Select CSV File
              </div>
              <Input
                id="email-csv-upload"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </Label>
            {error && (
              <p className="text-sm text-destructive mt-4 text-center">{error}</p>
            )}
            <div className="mt-6 text-xs text-muted-foreground text-center">
              <p className="font-medium mb-1">Expected columns:</p>
              <p>Sequence Name, Delivered count, Replied count, Opened count, Bounced count</p>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {matchedCount > 0 && (
                  <Badge variant="secondary">
                    <Check className="h-3 w-3 mr-1" />
                    {matchedCount} will update
                  </Badge>
                )}
                {unmatchedCount > 0 && (
                  <Badge variant="outline">
                    {unmatchedCount} unmatched
                  </Badge>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="email-mode" className="text-sm">Mode:</Label>
                  <Select value={mode} onValueChange={(v: 'replace' | 'add') => setMode(v)}>
                    <SelectTrigger id="email-mode" className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replace">Replace Email Stats</SelectItem>
                      <SelectItem value="add">Add to Existing Stats</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {mode === 'replace'
                    ? 'Clears ALL existing email stats, then applies this CSV. LinkedIn stats are preserved.'
                    : 'Adds CSV values on top of existing email stats.'}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Opens</TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                    <TableHead className="text-right">Bounced</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedStats.map((stat, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium max-w-[180px] truncate">
                        {stat.campaignName}
                      </TableCell>
                      <TableCell className="text-right">{stat.delivered.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{stat.opens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{stat.replies.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{stat.bounced.toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        {stat.matched ? (
                          <Badge variant="secondary">
                            <Check className="h-3 w-3 mr-1" />
                            Match
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-muted-foreground">
                            No match
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="text-xs text-muted-foreground mt-2 flex gap-4">
              <span>Total Delivered: <strong>{totalDelivered.toLocaleString()}</strong></span>
              <span>Total Opens: <strong>{totalOpens.toLocaleString()}</strong></span>
              <span>Total Replies: <strong>{totalReplies.toLocaleString()}</strong></span>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={matchedCount === 0}>
                Import {matchedCount} Campaign(s)
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Importing email stats...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
