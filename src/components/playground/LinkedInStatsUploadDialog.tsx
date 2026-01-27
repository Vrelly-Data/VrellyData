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
import { Upload, FileSpreadsheet, Check, X, Loader2, Linkedin } from 'lucide-react';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useLinkedInStatsUpload, LinkedInStatsRow } from '@/hooks/useLinkedInStatsUpload';

interface LinkedInStatsUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type UploadStep = 'upload' | 'preview' | 'importing';

// Column aliases for auto-mapping
const CAMPAIGN_NAME_ALIASES = ['campaign', 'name', 'sequence', 'sequence name', 'campaign name'];
const LI_MESSAGES_ALIASES = ['li messages', 'linkedin messages', 'messages sent', 'linkedin messages sent', 'li messages sent'];
const LI_CONNECTIONS_ALIASES = ['li connections', 'connection requests', 'connections sent', 'linkedin connections', 'linkedin connection requests'];
const LI_REPLIES_ALIASES = ['li replies', 'linkedin replies', 'replies', 'linkedin message replies'];

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

export function LinkedInStatsUploadDialog({ open, onOpenChange }: LinkedInStatsUploadDialogProps) {
  const [step, setStep] = useState<UploadStep>('upload');
  const [parsedStats, setParsedStats] = useState<LinkedInStatsRow[]>([]);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [error, setError] = useState<string | null>(null);

  const { data: campaigns = [] } = useSyncedCampaigns();
  const uploadMutation = useLinkedInStatsUpload();

  const resetDialog = useCallback(() => {
    setStep('upload');
    setParsedStats([]);
    setError(null);
    setMode('replace');
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
        
        // Find column mappings
        const campaignCol = findMatchingColumn(headers, CAMPAIGN_NAME_ALIASES);
        const messagesCol = findMatchingColumn(headers, LI_MESSAGES_ALIASES);
        const connectionsCol = findMatchingColumn(headers, LI_CONNECTIONS_ALIASES);
        const repliesCol = findMatchingColumn(headers, LI_REPLIES_ALIASES);

        if (!campaignCol) {
          setError('Could not find campaign name column. Expected columns: ' + CAMPAIGN_NAME_ALIASES.join(', '));
          return;
        }

        if (!messagesCol && !connectionsCol && !repliesCol) {
          setError('Could not find any LinkedIn metric columns. Expected at least one of: LI Messages, LI Connections, or LI Replies');
          return;
        }

        // Parse rows and match to campaigns
        const stats: LinkedInStatsRow[] = results.data.map((row: Record<string, unknown>) => {
          const campaignName = String(row[campaignCol] || '').trim();
          const linkedinMessagesSent = messagesCol ? parseNumber(row[messagesCol]) : 0;
          const linkedinConnectionsSent = connectionsCol ? parseNumber(row[connectionsCol]) : 0;
          const linkedinReplies = repliesCol ? parseNumber(row[repliesCol]) : 0;

          // Try to match campaign by name (case-insensitive)
          const matchedCampaign = campaigns.find(
            c => c.name.toLowerCase() === campaignName.toLowerCase()
          );

          return {
            campaignName,
            linkedinMessagesSent,
            linkedinConnectionsSent,
            linkedinReplies,
            matched: !!matchedCampaign,
            campaignId: matchedCampaign?.id,
          };
        }).filter(s => s.campaignName); // Filter out empty rows

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
            Import historical LinkedIn metrics from a Reply.io report CSV
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
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  <Check className="h-3 w-3 mr-1" />
                  {matchedCount} matched
                </Badge>
                {unmatchedCount > 0 && (
                  <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    <X className="h-3 w-3 mr-1" />
                    {unmatchedCount} not found
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="mode" className="text-sm">Mode:</Label>
                <Select value={mode} onValueChange={(v: 'replace' | 'add') => setMode(v)}>
                  <SelectTrigger id="mode" className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">Replace</SelectItem>
                    <SelectItem value="add">Add to existing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex-1 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Connections</TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedStats.map((stat, index) => (
                    <TableRow key={index} className={!stat.matched ? 'opacity-50' : ''}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {stat.campaignName}
                      </TableCell>
                      <TableCell className="text-right">{stat.linkedinMessagesSent}</TableCell>
                      <TableCell className="text-right">{stat.linkedinConnectionsSent}</TableCell>
                      <TableCell className="text-right">{stat.linkedinReplies}</TableCell>
                      <TableCell className="text-center">
                        {stat.matched ? (
                          <Check className="h-4 w-4 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-amber-500 mx-auto" />
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
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={matchedCount === 0}
              >
                Import {matchedCount} Campaign{matchedCount !== 1 ? 's' : ''}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
