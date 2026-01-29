import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, FileSpreadsheet, Check, Plus, Loader2, Linkedin } from 'lucide-react';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useLinkedInStatsUpload, LinkedInStatsRow } from '@/hooks/useLinkedInStatsUpload';

interface LinkedInStatsUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type UploadStep = 'upload' | 'preview' | 'importing';

// Column aliases for auto-mapping (aggregated format)
const CAMPAIGN_NAME_ALIASES = ['campaign', 'name', 'sequence', 'sequence name', 'campaign name'];
const LI_MESSAGES_ALIASES = ['li messages', 'linkedin messages', 'messages sent', 'linkedin messages sent', 'li messages sent'];
const LI_CONNECTIONS_ALIASES = ['li connections', 'connection requests', 'connections sent', 'linkedin connections', 'linkedin connection requests'];
const LI_REPLIES_ALIASES = ['li replies', 'linkedin replies', 'replies', 'linkedin message replies'];

// Column aliases for action-based format
const ACTION_COLUMN_ALIASES = ['action', 'activity', 'step', 'action type'];

// Action value to metric mapping
type LinkedInMetric = 'linkedinMessagesSent' | 'linkedinConnectionsSent' | 'linkedinReplies' | 'linkedinConnectionsAccepted';

const ACTION_MAPPINGS: Record<string, LinkedInMetric> = {
  // Replies
  'replied auto connection note': 'linkedinReplies',
  'replied auto connection': 'linkedinReplies',
  'replied auto message': 'linkedinReplies',
  'replied message': 'linkedinReplies',
  
  // Connection Acceptances
  'accepted auto connection': 'linkedinConnectionsAccepted',
  'accepted connection': 'linkedinConnectionsAccepted',
  
  // Connection Requests Sent
  'sent auto connection note': 'linkedinConnectionsSent',
  'sent auto connection': 'linkedinConnectionsSent',
  'sent connection request': 'linkedinConnectionsSent',
  
  // Messages Sent
  'sent auto message': 'linkedinMessagesSent',
  'sent message': 'linkedinMessagesSent',
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim();
}

function findMatchingColumn(headers: string[], aliases: string[]): string | null {
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (aliases.includes(normalized)) {
      return header;
    }
  }
  return null;
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function normalizeAction(action: unknown): string {
  if (typeof action !== 'string') return '';
  return action.toLowerCase().trim();
}

function getMetricForAction(action: string): LinkedInMetric | null {
  const normalized = normalizeAction(action);
  
  // Exact match first
  if (ACTION_MAPPINGS[normalized]) {
    return ACTION_MAPPINGS[normalized];
  }
  
  // Partial matching fallback for variations
  if (normalized.includes('replied') && normalized.includes('connection')) {
    return 'linkedinReplies';
  }
  if (normalized.includes('replied') && normalized.includes('message')) {
    return 'linkedinReplies';
  }
  if (normalized.includes('accepted') && normalized.includes('connection')) {
    return 'linkedinConnectionsAccepted';
  }
  if (normalized.includes('sent') && normalized.includes('connection')) {
    return 'linkedinConnectionsSent';
  }
  if (normalized.includes('sent') && normalized.includes('message')) {
    return 'linkedinMessagesSent';
  }
  
  return null;
}

interface AggregatedStats {
  linkedinMessagesSent: number;
  linkedinConnectionsSent: number;
  linkedinReplies: number;
  linkedinConnectionsAccepted: number;
}

function createEmptyStats(): AggregatedStats {
  return {
    linkedinMessagesSent: 0,
    linkedinConnectionsSent: 0,
    linkedinReplies: 0,
    linkedinConnectionsAccepted: 0,
  };
}

export function LinkedInStatsUploadDialog({ open, onOpenChange }: LinkedInStatsUploadDialogProps) {
  const [step, setStep] = useState<UploadStep>('upload');
  const [parsedStats, setParsedStats] = useState<LinkedInStatsRow[]>([]);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [error, setError] = useState<string | null>(null);
  const [detectedActions, setDetectedActions] = useState<string[]>([]);
  const [unrecognizedActions, setUnrecognizedActions] = useState<string[]>([]);

  const { data: campaigns = [] } = useSyncedCampaigns();
  const uploadMutation = useLinkedInStatsUpload();

  const resetDialog = useCallback(() => {
    setStep('upload');
    setParsedStats([]);
    setError(null);
    setMode('replace');
    setDetectedActions([]);
    setUnrecognizedActions([]);
  }, []);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      resetDialog();
    }
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
        
        // Detect format: action-based or aggregated
        const actionCol = findMatchingColumn(headers, ACTION_COLUMN_ALIASES);
        const campaignCol = findMatchingColumn(headers, CAMPAIGN_NAME_ALIASES);

        if (!campaignCol) {
          setError('Could not find campaign/sequence name column. Expected columns: ' + CAMPAIGN_NAME_ALIASES.join(', '));
          return;
        }

        let stats: LinkedInStatsRow[];

        if (actionCol) {
          // ACTION-BASED FORMAT: Aggregate rows by campaign
          const campaignStats = new Map<string, AggregatedStats>();
          const detectedSet = new Set<string>();
          const unrecognizedSet = new Set<string>();

          for (const row of results.data as Record<string, unknown>[]) {
            const campaignName = String(row[campaignCol] || '').trim();
            if (!campaignName) continue;

            const action = String(row[actionCol] || '').trim();
            if (!action) continue;
            
            const metric = getMetricForAction(action);

            if (metric) {
              detectedSet.add(action.toLowerCase());
              const existing = campaignStats.get(campaignName) || createEmptyStats();
              existing[metric] += 1;
              campaignStats.set(campaignName, existing);
            } else {
              unrecognizedSet.add(action.toLowerCase());
            }
          }
          
          setDetectedActions(Array.from(detectedSet).sort());
          setUnrecognizedActions(Array.from(unrecognizedSet).sort());

          // Convert Map to array
          stats = Array.from(campaignStats.entries()).map(([campaignName, metrics]) => {
            const matchedCampaign = campaigns.find(
              c => c.name.toLowerCase() === campaignName.toLowerCase()
            );

            return {
              campaignName,
              ...metrics,
              matched: !!matchedCampaign,
              campaignId: matchedCampaign?.id,
            };
          });

          if (stats.length === 0) {
            setError('No LinkedIn actions found in CSV. Expected action values: ' + Object.keys(ACTION_MAPPINGS).join(', '));
            return;
          }
        } else {
          // AGGREGATED FORMAT: Original parsing logic
          const messagesCol = findMatchingColumn(headers, LI_MESSAGES_ALIASES);
          const connectionsCol = findMatchingColumn(headers, LI_CONNECTIONS_ALIASES);
          const repliesCol = findMatchingColumn(headers, LI_REPLIES_ALIASES);

          if (!messagesCol && !connectionsCol && !repliesCol) {
            setError('Could not find any LinkedIn metric columns. Expected at least one of: LI Messages, LI Connections, LI Replies, or an Action column');
            return;
          }

          stats = (results.data as Record<string, unknown>[]).map((row) => {
            const campaignName = String(row[campaignCol] || '').trim();
            const linkedinMessagesSent = messagesCol ? parseNumber(row[messagesCol]) : 0;
            const linkedinConnectionsSent = connectionsCol ? parseNumber(row[connectionsCol]) : 0;
            const linkedinReplies = repliesCol ? parseNumber(row[repliesCol]) : 0;

            const matchedCampaign = campaigns.find(
              c => c.name.toLowerCase() === campaignName.toLowerCase()
            );

            return {
              campaignName,
              linkedinMessagesSent,
              linkedinConnectionsSent,
              linkedinReplies,
              linkedinConnectionsAccepted: 0,
              matched: !!matchedCampaign,
              campaignId: matchedCampaign?.id,
            };
          }).filter(s => s.campaignName);

          if (stats.length === 0) {
            setError('No valid data rows found in CSV');
            return;
          }
        }

        setParsedStats(stats);
        setStep('preview');
      },
      error: (parseError) => {
        setError(`Failed to parse CSV: ${parseError.message}`);
      },
    });

    // Reset file input
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Linkedin className="h-5 w-5 text-[#0A66C2]" />
            Upload LinkedIn Stats
          </DialogTitle>
        <DialogDescription>
            Import or update LinkedIn metrics. Use 'Replace' to overwrite existing stats with fresh data.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="flex flex-col items-center justify-center py-10 px-4 border-2 border-dashed rounded-lg">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground mb-4 text-center">
              Upload a CSV file exported from Reply.io containing LinkedIn metrics
            </p>
            <Label htmlFor="csv-upload" className="cursor-pointer">
              <div className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                <Upload className="h-4 w-4" />
                Select CSV File
              </div>
              <Input
                id="csv-upload"
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
              <p>Campaign Name, LI Messages Sent, LI Connections, LI Replies</p>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <>
            {/* Debug info for detected actions */}
            {(detectedActions.length > 0 || unrecognizedActions.length > 0) && (
              <div className="text-xs text-muted-foreground mb-3 p-2 bg-muted/50 rounded">
                {detectedActions.length > 0 && (
                  <div className="mb-1">
                    <span className="font-medium text-green-600 dark:text-green-400">Detected actions:</span>{' '}
                    {detectedActions.join(', ')}
                  </div>
                )}
                {unrecognizedActions.length > 0 && (
                  <div className="text-amber-600 dark:text-amber-400">
                    <span className="font-medium">Unrecognized actions:</span>{' '}
                    {unrecognizedActions.join(', ')}
                  </div>
                )}
              </div>
            )}
            
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {matchedCount > 0 && (
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <Check className="h-3 w-3 mr-1" />
                    {matchedCount} will update
                  </Badge>
                )}
                {unmatchedCount > 0 && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    <Plus className="h-3 w-3 mr-1" />
                    {unmatchedCount} will create
                  </Badge>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="mode" className="text-sm">Mode:</Label>
                  <Select value={mode} onValueChange={(v: 'replace' | 'add') => setMode(v)}>
                    <SelectTrigger id="mode" className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replace">Replace LinkedIn Stats</SelectItem>
                      <SelectItem value="add">Add to Existing Stats</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {mode === 'replace' 
                    ? 'Clears ALL existing LinkedIn stats, then applies this CSV. Email stats are preserved.'
                    : 'Adds CSV values on top of existing LinkedIn stats (for cumulative updates).'}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Conn. Sent</TableHead>
                    <TableHead className="text-right">Conn. Accepted</TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedStats.map((stat, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium max-w-[180px] truncate">
                        {stat.campaignName}
                      </TableCell>
                      <TableCell className="text-right">{stat.linkedinMessagesSent}</TableCell>
                      <TableCell className="text-right">{stat.linkedinConnectionsSent}</TableCell>
                      <TableCell className="text-right">{stat.linkedinConnectionsAccepted}</TableCell>
                      <TableCell className="text-right">{stat.linkedinReplies}</TableCell>
                      <TableCell className="text-center">
                        {stat.matched ? (
                          <Check className="h-4 w-4 text-green-600 mx-auto" />
                        ) : (
                          <Plus className="h-4 w-4 text-blue-500 mx-auto" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Importing LinkedIn stats...</p>
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && (
            <>
              {mode === 'replace' && (
                <p className="text-xs text-muted-foreground mr-auto">
                  This will clear LinkedIn stats from ALL campaigns{matchedCount > 0 ? `, then apply data to ${matchedCount} matched campaign${matchedCount > 1 ? 's' : ''}` : ''}.
                </p>
              )}
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={parsedStats.length === 0}
              >
                Import LinkedIn Data
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
