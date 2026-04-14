import { useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useNavigate } from 'react-router-dom';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { UserMenu } from '@/components/UserMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Inbox, Loader2 } from 'lucide-react';
import { useAgentLeads } from '@/hooks/useAgentLeads';
import { LeadDetailPanel } from '@/components/agent/LeadDetailPanel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function AgentInbox() {
  const navigate = useNavigate();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');

  const { data: leads = [], isLoading } = useAgentLeads({
    status: statusFilter === 'all' ? undefined : statusFilter,
    channel: channelFilter === 'all' ? undefined : channelFilter,
  });

  const selectedLead = leads.find((l) => l.id === selectedLeadId) || null;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <img
              src={vrellyLogo}
              alt="Vrelly Data"
              className="h-[4.5rem] cursor-pointer"
              onClick={() => navigate('/dashboard')}
            />
            <h1 className="text-lg font-semibold ml-4">Agent Inbox</h1>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>

          <main className="flex-1 overflow-hidden flex">
            {/* Left panel — lead list */}
            <div className="w-[380px] border-r flex flex-col">
              {/* Filters */}
              <div className="p-3 border-b flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="replied">Replied</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={channelFilter} onValueChange={setChannelFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All channels</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Lead list */}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : leads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <Inbox className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No leads yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Leads will appear here when prospects reply to your campaigns
                    </p>
                  </div>
                ) : (
                  leads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors ${
                        selectedLeadId === lead.id ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">
                          {lead.full_name || 'Unknown'}
                        </span>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 capitalize"
                          >
                            {lead.channel}
                          </Badge>
                          <Badge
                            variant={lead.inbox_status === 'pending' ? 'default' : 'secondary'}
                            className="text-[10px] px-1.5 py-0 capitalize"
                          >
                            {lead.inbox_status}
                          </Badge>
                        </div>
                      </div>
                      {lead.last_reply_text && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {lead.last_reply_text}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right panel — lead detail */}
            <div className="flex-1 overflow-y-auto">
              {selectedLead ? (
                <div className="max-w-2xl mx-auto p-6">
                  <LeadDetailPanel lead={selectedLead} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Select a lead to view details</p>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
