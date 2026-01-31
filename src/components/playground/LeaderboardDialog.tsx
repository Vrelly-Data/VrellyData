import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { Loader2, Shield, Trophy } from 'lucide-react';

interface LeaderboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeaderboardDialog({ open, onOpenChange }: LeaderboardDialogProps) {
  const { data: entries, isLoading, error } = useLeaderboard();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Campaign Leaderboard
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">Completely Anonymous</p>
            <p className="text-xs text-muted-foreground">
              Data is aggregated across all platform users. No campaign names, team info, or personal data is shown.
            </p>
          </div>
          <Badge variant="secondary" className="text-xs">
            Top 50
          </Badge>
        </div>

        <ScrollArea className="h-[500px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              Failed to load leaderboard data
            </div>
          ) : entries && entries.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Reply Rate</TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                  <TableHead className="text-right">Completion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.rank}>
                    <TableCell className="font-medium">
                      {entry.rank <= 3 ? (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          entry.rank === 1 ? 'bg-yellow-500/20 text-yellow-600' :
                          entry.rank === 2 ? 'bg-gray-400/20 text-gray-600' :
                          'bg-orange-500/20 text-orange-600'
                        }`}>
                          {entry.rank}
                        </span>
                      ) : (
                        entry.rank
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.messages_sent.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.replies.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {entry.reply_rate}%
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.contacts.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.completion_rate}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Trophy className="h-8 w-8 mb-2 opacity-50" />
              <p>No campaign data available yet</p>
              <p className="text-xs">Rankings will appear once campaigns have activity</p>
            </div>
          )}
        </ScrollArea>

        <p className="text-xs text-muted-foreground text-center pt-2 border-t">
          Rankings based on reply rate. Only campaigns with sent messages are included.
        </p>
      </DialogContent>
    </Dialog>
  );
}
