import { useState } from 'react';
import { BuildAudienceDialog } from './BuildAudienceDialog';
import { ViewAudienceDialog } from './ViewAudienceDialog';
import { useLists } from '@/hooks/useLists';
import { useSyncedContactsPaged, fetchAllContactsForExport } from '@/hooks/useSyncedContactsPaged';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Loader2, Users, RefreshCw, Download, ExternalLink, Check, X, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PaginationControls } from '@/components/search/PaginationControls';
import { useDeleteList } from '@/hooks/useLists';
import { formatDistanceToNow } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  replied: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  delivered: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  opened: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  bounced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  opted_out: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  finished: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

interface SyncProgress {
  current: number;
  total: number;
  campaignName: string;
}

export function PeopleTab() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [isExporting, setIsExporting] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [buildAudienceOpen, setBuildAudienceOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

  const { data: savedLists } = useLists('person');
  const deleteListMutation = useDeleteList();
  const { data: pagedData, isLoading: contactsLoading } = useSyncedContactsPaged({
    campaignId: selectedCampaignId,
    status: statusFilter,
    page: currentPage,
    perPage,
  });
  
  const { data: campaigns } = useSyncedCampaigns(true);
  const { integrations } = useOutboundIntegrations();
  const queryClient = useQueryClient();

  const activeIntegration = integrations?.find(i => i.platform === 'reply.io' && i.is_active);
  const linkedCampaigns = campaigns?.filter(c => c.is_linked) || [];

  const contacts = pagedData?.contacts || [];
  const totalCount = pagedData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / perPage);

  // Reset to page 1 when filters change
  const handleCampaignChange = (value: string) => {
    setSelectedCampaignId(value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handlePerPageChange = (value: number) => {
    setPerPage(value);
    setCurrentPage(1);
  };

  const syncSingleCampaign = async (campaignId: string) => {
    if (!activeIntegration) throw new Error('No active integration');
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await supabase.functions.invoke('sync-reply-contacts', {
      body: { campaignId, integrationId: activeIntegration.id },
    });

    if (response.error) throw response.error;
    return response.data;
  };

  const syncContactsMutation = useMutation({
    mutationFn: syncSingleCampaign,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['synced-contacts-paged'] });
      const count = data.verifiedCount || data.uniquePrepared || data.contactsSynced;
      toast.success(`Synced ${count} contacts`);
    },
    onError: (error) => {
      toast.error(`Failed to sync contacts: ${error.message}`);
    },
  });

  const syncAllCampaignsMutation = useMutation({
    mutationFn: async () => {
      if (!activeIntegration) throw new Error('No active integration');
      if (!linkedCampaigns.length) throw new Error('No linked campaigns to sync');

      let totalSynced = 0;
      const errors: string[] = [];

      for (let i = 0; i < linkedCampaigns.length; i++) {
        const campaign = linkedCampaigns[i];
        setSyncProgress({
          current: i + 1,
          total: linkedCampaigns.length,
          campaignName: campaign.name,
        });

        try {
          const result = await syncSingleCampaign(campaign.id);
          totalSynced += result.verifiedCount || result.uniquePrepared || 0;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`${campaign.name}: ${errorMsg}`);
          console.error(`Failed to sync campaign ${campaign.name}:`, err);
        }

        // Small delay between campaigns to avoid rate limiting
        if (i < linkedCampaigns.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setSyncProgress(null);

      if (errors.length > 0) {
        console.warn('Some campaigns failed to sync:', errors);
      }

      return { totalSynced, errors };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['synced-contacts-paged'] });
      if (data.errors.length > 0) {
        toast.warning(`Synced ${data.totalSynced} contacts (${data.errors.length} campaigns had errors)`);
      } else {
        toast.success(`Synced ${data.totalSynced} contacts from ${linkedCampaigns.length} campaigns`);
      }
    },
    onError: (error) => {
      setSyncProgress(null);
      toast.error(`Failed to sync campaigns: ${error.message}`);
    },
  });

  // Get unique statuses for filter dropdown
  const statusOptions = ['active', 'replied', 'bounced', 'opened', 'delivered', 'opted_out', 'finished', 'unknown'];

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      // Fetch all contacts matching current filters
      const allContacts = await fetchAllContactsForExport(
        selectedCampaignId !== 'all' ? selectedCampaignId : undefined,
        statusFilter !== 'all' ? statusFilter : undefined
      );

      if (!allContacts.length) {
        toast.error('No contacts to export');
        return;
      }

      const headers = [
        'Email', 'First Name', 'Last Name', 'Company', 'Job Title', 
        'Industry', 'City', 'State', 'Country', 'Phone', 'LinkedIn',
        'Status', 'Opened', 'Replied', 'Clicked', 'Opted Out', 'Added Date'
      ];
      const rows = allContacts.map(c => [
        c.email,
        c.first_name || '',
        c.last_name || '',
        c.company || '',
        c.job_title || '',
        c.industry || '',
        c.city || '',
        c.state || '',
        c.country || '',
        c.phone || '',
        c.linkedin_url || '',
        c.status || '',
        c.engagement_data?.opened ? 'Yes' : 'No',
        c.engagement_data?.replied ? 'Yes' : 'No',
        c.engagement_data?.clicked ? 'Yes' : 'No',
        c.engagement_data?.optedOut ? 'Yes' : 'No',
        c.added_at ? new Date(c.added_at).toLocaleDateString() : '',
      ]);

      const csvContent = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${allContacts.length} contacts`);
    } catch (error) {
      toast.error('Failed to export contacts');
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  if (contactsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleDeleteList = async () => {
    if (!deleteListId) return;
    try {
      await deleteListMutation.mutateAsync(deleteListId);
    } catch {
      // useDeleteList already shows error toast
    } finally {
      setDeleteListId(null);
    }
  };

  const renderSavedAudiences = () => {
    if (!savedLists || savedLists.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-sm font-medium text-muted-foreground">Saved Audiences</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {savedLists.map((list) => (
            <div
              key={list.id}
              className="group relative rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200"
              onClick={() => setSelectedListId(list.id)}
            >
              <div className="h-8 bg-gradient-to-r from-primary/20 to-primary/10 flex items-center px-3 gap-2">
                <Users className="h-3.5 w-3.5 text-primary/70" />
                <Target className="h-3 w-3 text-primary/50" />
              </div>
              <div className="p-3 space-y-1.5">
                <p className="font-semibold text-sm leading-snug line-clamp-2">{list.name}</p>
                <p className="text-xs text-muted-foreground">
                  {list.item_count} contact{list.item_count !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(list.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="px-3 pb-3 flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs gap-1"
                  onClick={(e) => { e.stopPropagation(); setSelectedListId(list.id); }}
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); setDeleteListId(list.id); }}
                  disabled={deleteListMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (totalCount === 0 && selectedCampaignId === 'all' && statusFilter === 'all') {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setBuildAudienceOpen(true)}>
            <Target className="h-4 w-4 mr-2" />
            Build Audience with AI
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center h-64 text-center border-2 border-dashed rounded-lg">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Contacts Synced</h2>
          <p className="text-muted-foreground max-w-md mb-4">
            Sync your campaigns to fetch contact details and engagement data.
          </p>
          {linkedCampaigns.length > 0 ? (
            <Button
              onClick={() => syncAllCampaignsMutation.mutate()}
              disabled={syncAllCampaignsMutation.isPending}
            >
              {syncAllCampaignsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync All {linkedCampaigns.length} Linked Campaigns
            </Button>
          ) : campaigns?.length ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Select a campaign to sync its contacts:</p>
              <Select
                onValueChange={(id) => syncContactsMutation.mutate(id)}
                disabled={syncContactsMutation.isPending}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select campaign..." />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              First sync your campaigns from the Playground tab.
            </p>
          )}
        </div>

        {renderSavedAudiences()}

        <AlertDialog open={!!deleteListId} onOpenChange={(open) => !open && setDeleteListId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Audience</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this saved audience? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteList}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <BuildAudienceDialog open={buildAudienceOpen} onOpenChange={setBuildAudienceOpen} />
        {selectedListId && (
          <ViewAudienceDialog
            open={!!selectedListId}
            onOpenChange={(open) => !open && setSelectedListId(null)}
            listId={selectedListId}
            listName={savedLists?.find(l => l.id === selectedListId)?.name || 'Audience'}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setBuildAudienceOpen(true)}>
          <Target className="h-4 w-4 mr-2" />
          Build Audience with AI
        </Button>
      </div>

      {/* Sync Progress */}
      {syncProgress && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Syncing campaign {syncProgress.current} of {syncProgress.total}: {syncProgress.campaignName}
                </p>
                <Progress
                  value={(syncProgress.current / syncProgress.total) * 100}
                  className="mt-2 h-2"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters and Actions */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Select value={selectedCampaignId} onValueChange={handleCampaignChange}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Filter by campaign..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns?.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statusOptions.map(status => (
                <SelectItem key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {linkedCampaigns.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncAllCampaignsMutation.mutate()}
              disabled={syncAllCampaignsMutation.isPending || syncContactsMutation.isPending}
            >
              {syncAllCampaignsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync All ({linkedCampaigns.length})
            </Button>
          )}
          {selectedCampaignId !== 'all' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncContactsMutation.mutate(selectedCampaignId)}
              disabled={syncContactsMutation.isPending || syncAllCampaignsMutation.isPending}
            >
              {syncContactsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh This
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Contacts</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <p className="text-2xl font-bold">{totalCount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">On This Page</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <p className="text-2xl font-bold">{contacts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Page</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <p className="text-2xl font-bold">{currentPage} / {totalPages || 1}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Per Page</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <p className="text-2xl font-bold">{perPage}</p>
          </CardContent>
        </Card>
      </div>

      {/* Contacts Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="w-full whitespace-nowrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[150px]">Name</TableHead>
                  <TableHead className="min-w-[200px]">Email</TableHead>
                  <TableHead className="min-w-[150px]">Company</TableHead>
                  <TableHead className="min-w-[150px]">Title</TableHead>
                  <TableHead className="min-w-[120px]">Industry</TableHead>
                  <TableHead className="min-w-[150px]">Location</TableHead>
                  <TableHead className="min-w-[80px]">Status</TableHead>
                  <TableHead className="min-w-[70px] text-center">Opened</TableHead>
                  <TableHead className="min-w-[70px] text-center">Replied</TableHead>
                  <TableHead className="min-w-[70px] text-center">Clicked</TableHead>
                  <TableHead className="min-w-[80px] text-center">Opted Out</TableHead>
                  <TableHead className="min-w-[100px]">Added</TableHead>
                  <TableHead className="min-w-[60px]">LinkedIn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => {
                  const location = [contact.city, contact.state, contact.country]
                    .filter(Boolean)
                    .join(', ');
                  
                  return (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">
                        {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{contact.email}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{contact.company || '—'}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{contact.job_title || '—'}</TableCell>
                      <TableCell className="max-w-[120px] truncate">{contact.industry || '—'}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{location || '—'}</TableCell>
                      <TableCell>
                        <Badge 
                          variant="secondary" 
                          className={statusColors[contact.status || 'unknown'] || statusColors.unknown}
                        >
                          {contact.status || 'Unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {contact.engagement_data?.opened ? (
                          <Check className="h-4 w-4 text-green-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {contact.engagement_data?.replied ? (
                          <Check className="h-4 w-4 text-blue-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {contact.engagement_data?.clicked ? (
                          <Check className="h-4 w-4 text-purple-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {contact.engagement_data?.optedOut ? (
                          <Check className="h-4 w-4 text-orange-600 mx-auto" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                        )}
                      </TableCell>
                      <TableCell>
                        {contact.added_at 
                          ? new Date(contact.added_at).toLocaleDateString() 
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {contact.linkedin_url ? (
                          <a 
                            href={contact.linkedin_url.startsWith('http') ? contact.linkedin_url : `https://${contact.linkedin_url}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-4 border-t">
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                perPage={perPage}
                totalResults={totalCount}
                onPageChange={setCurrentPage}
                onPerPageChange={handlePerPageChange}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {renderSavedAudiences()}

      <AlertDialog open={!!deleteListId} onOpenChange={(open) => !open && setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Audience</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this saved audience? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteList}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BuildAudienceDialog open={buildAudienceOpen} onOpenChange={setBuildAudienceOpen} />
      {selectedListId && (
        <ViewAudienceDialog
          open={!!selectedListId}
          onOpenChange={(open) => !open && setSelectedListId(null)}
          listId={selectedListId}
          listName={savedLists?.find(l => l.id === selectedListId)?.name || 'Audience'}
        />
      )}
    </div>
  );
}
