import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSyncedContacts, SyncedContact } from '@/hooks/useSyncedContacts';
import { Loader2, Mail, Building2, Briefcase } from 'lucide-react';

interface ContactsListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getStatusBadge(status: string | null) {
  switch (status?.toLowerCase()) {
    case 'active':
      return <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">Active</Badge>;
    case 'finished':
      return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">Finished</Badge>;
    case 'bounced':
      return <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20">Bounced</Badge>;
    case 'replied':
      return <Badge className="bg-purple-500/10 text-purple-600 hover:bg-purple-500/20">Replied</Badge>;
    case 'opted_out':
      return <Badge className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20">Opted Out</Badge>;
    default:
      return status ? <Badge variant="outline">{status}</Badge> : null;
  }
}

function ContactRow({ contact }: { contact: SyncedContact }) {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
  
  return (
    <div className="flex items-start justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <p className="font-medium truncate">{fullName}</p>
        <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
          <Mail className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{contact.email}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {contact.company && (
            <div className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              <span className="truncate max-w-[150px]">{contact.company}</span>
            </div>
          )}
          {contact.job_title && (
            <div className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              <span className="truncate max-w-[150px]">{contact.job_title}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0">
        {getStatusBadge(contact.status)}
      </div>
    </div>
  );
}

export function ContactsListDialog({ open, onOpenChange }: ContactsListDialogProps) {
  const { data: contacts, isLoading, error } = useSyncedContacts();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Synced Contacts ({contacts?.length ?? 0})
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            Failed to load contacts
          </div>
        ) : contacts?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No contacts synced yet
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-4">
            <div className="space-y-2">
              {contacts?.map(contact => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
