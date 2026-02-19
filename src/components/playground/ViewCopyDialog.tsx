import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Copy, Mail, Pencil, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CopyGroup } from '@/hooks/useCopyTemplates';
import { useRenameCopyGroup } from '@/hooks/useCopyTemplates';

interface ViewCopyDialogProps {
  group: CopyGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function channelFromName(name: string): string | null {
  return name.match(/\(([^)]+)\)/)?.[1] || null;
}

function stepNumberFromName(name: string): number {
  return parseInt(name.match(/Step\s*(\d+)/i)?.[1] || '1');
}

export function ViewCopyDialog({ group, open, onOpenChange }: ViewCopyDialogProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const renameMutation = useRenameCopyGroup();

  useEffect(() => {
    if (group?.name) {
      setEditedName(group.name);
      setIsEditingName(false);
    }
  }, [group?.name]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleSaveName = async () => {
    if (!group || !editedName.trim() || editedName.trim() === group.name) {
      setIsEditingName(false);
      return;
    }
    try {
      await renameMutation.mutateAsync({ groupId: group.groupId, newName: editedName.trim(), rows: group.rows });
      toast.success('Title updated');
      setIsEditingName(false);
    } catch {
      toast.error('Failed to update title');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSaveName();
    if (e.key === 'Escape') {
      setEditedName(group?.name || '');
      setIsEditingName(false);
    }
  };

  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                className="h-8 text-base font-semibold"
              />
              <Button size="sm" onClick={handleSaveName} disabled={renameMutation.isPending}>
                {renameMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditedName(group.name); setIsEditingName(false); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <DialogTitle className="flex items-center gap-2 group/title">
              <Mail className="h-5 w-5 text-primary" />
              {group.name}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover/title:opacity-100 transition-opacity"
                onClick={() => setIsEditingName(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </DialogTitle>
          )}
          <DialogDescription>
            {group.stepCount} step{group.stepCount !== 1 ? 's' : ''} · {group.channels.join(', ') || 'Email'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {group.rows.map((row) => {
            const stepNum = stepNumberFromName(row.name);
            const channel = channelFromName(row.name);

            return (
              <Card key={row.id}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Step {stepNum}
                    {channel && (
                      <Badge variant="outline" className="text-xs">{channel}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-0 pb-4 space-y-3">
                  {row.subject && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopy(row.subject!, 'Subject')}>
                          <Copy className="h-3 w-3 mr-1" />Copy
                        </Button>
                      </div>
                      <p className="text-sm font-medium">{row.subject}</p>
                    </div>
                  )}
                  {row.body_text && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body</p>
                        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleCopy(row.body_text!, 'Body')}>
                          <Copy className="h-3 w-3 mr-1" />Copy
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded-md p-3">{row.body_text}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
