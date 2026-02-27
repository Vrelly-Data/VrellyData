import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useListItems } from '@/hooks/useLists';
import { Loader2 } from 'lucide-react';

interface ViewAudienceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  listName: string;
}

export function ViewAudienceDialog({ open, onOpenChange, listId, listName }: ViewAudienceDialogProps) {
  const { data: items, isLoading } = useListItems(listId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{listName}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !items?.length ? (
          <p className="text-center text-muted-foreground py-12">No contacts in this audience.</p>
        ) : (
          <ScrollArea className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[150px]">Name</TableHead>
                  <TableHead className="min-w-[150px]">Title</TableHead>
                  <TableHead className="min-w-[150px]">Company</TableHead>
                  <TableHead className="min-w-[120px]">Industry</TableHead>
                  <TableHead className="min-w-[150px]">Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const d = item.entity_data as Record<string, any>;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{d?.name || '—'}</TableCell>
                      <TableCell>{d?.title || '—'}</TableCell>
                      <TableCell>{d?.company || '—'}</TableCell>
                      <TableCell>{d?.industry || '—'}</TableCell>
                      <TableCell>{d?.location || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
