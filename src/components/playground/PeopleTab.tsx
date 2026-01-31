import { useState } from 'react';
import { useSyncedContactsPaged, fetchAllContactsForExport } from '@/hooks/useSyncedContactsPaged';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Users, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PaginationControls } from '@/components/search/PaginationControls';

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

export function PeopleTab() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [isExporting, setIsExporting] = useState(false);
  
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

  const syncContactsMutation = useMutation({
    mutationFn: async (campaignId: string) => {
      if (!activeIntegration) throw new Error('No active integration');
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('sync-reply-contacts', {
        body: { campaignId, integrationId: activeIntegration.id },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['synced-contacts-paged'] });
      const count = data.verifiedCount || data.uniquePrepared || data.contactsSynced;
      toast.success(`Synced ${count} contacts`);
    },
    onError: (error) => {
      toast.error(`Failed to sync contacts: ${error.message}`);
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

      const headers = ['Email', 'First Name', 'Last Name', 'Job Title', 'Status', 'Replied', 'Opened', 'Bounced'];
      const rows = allContacts.map(c => [
        c.email,
        c.first_name || '',
        c.last_name || '',
        c.job_title || '',
        c.status || '',
        c.engagement_data?.replied ? 'Yes' : 'No',
        c.engagement_data?.opened ? 'Yes' : 'No',
        c.engagement_data?.bounced ? 'Yes' : 'No',
      ]);

      const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
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

  if (totalCount === 0 && selectedCampaignId === 'all' && statusFilter === 'all') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Users className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Contacts Synced</h2>
        <p className="text-muted-foreground max-w-md mb-4">
          Sync your campaigns to fetch contact details and engagement data.
        </p>
        {campaigns?.length ? (
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
    );
  }

  return (
    <div className="space-y-6">
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
          {selectedCampaignId !== 'all' && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => syncContactsMutation.mutate(selectedCampaignId)}
              disabled={syncContactsMutation.isPending}
            >
              {syncContactsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh Contacts
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">
                    {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
                  </TableCell>
                  <TableCell>{contact.email}</TableCell>
                  <TableCell>{contact.job_title || '—'}</TableCell>
                  <TableCell>
                    {contact.engagement_data?.opened ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        Yes
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="secondary" 
                      className={statusColors[contact.status || 'unknown'] || statusColors.unknown}
                    >
                      {contact.status || 'Unknown'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
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
    </div>
  );
}
