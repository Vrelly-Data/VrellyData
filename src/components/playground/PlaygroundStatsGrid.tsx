import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePlaygroundStats } from '@/hooks/usePlaygroundStats';
import { useChannelMetrics } from '@/hooks/useChannelMetrics';
import { Send, MessageSquare, Users, Zap, Target, Clock, Loader2, Mail, Linkedin } from 'lucide-react';
import { CampaignListDialog } from './CampaignListDialog';
import { ContactsListDialog } from './ContactsListDialog';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  isPlaceholder?: boolean;
  onClick?: () => void;
  clickable?: boolean;
  tooltipContent?: React.ReactNode;
}

function StatCard({ title, value, icon, description, isPlaceholder, onClick, clickable, tooltipContent }: StatCardProps) {
  const cardContent = (
    <Card 
      className={`${isPlaceholder ? 'border-dashed' : ''} ${clickable || tooltipContent ? 'cursor-pointer hover:bg-accent/50 transition-colors' : ''}`}
      onClick={clickable ? onClick : undefined}
    >
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">
              {isPlaceholder ? (
                <span className="text-muted-foreground">Coming Soon</span>
              ) : (
                value
              )}
            </p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          <div className={`p-3 rounded-full ${isPlaceholder ? 'bg-muted' : 'bg-primary/10'}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (tooltipContent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {cardContent}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-64">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    );
  }

  return cardContent;
}

type DialogFilter = 'all' | 'active' | null;

export function PlaygroundStatsGrid() {
  const { data: stats, isLoading, error } = usePlaygroundStats();
  const { data: channelMetrics } = useChannelMetrics();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFilter, setDialogFilter] = useState<DialogFilter>(null);
  const [contactsDialogOpen, setContactsDialogOpen] = useState(false);

  const openDialog = (filter: DialogFilter) => {
    setDialogFilter(filter);
    setDialogOpen(true);
  };

  const getDialogTitle = () => {
    switch (dialogFilter) {
      case 'active':
        return 'Active Campaigns';
      case 'all':
        return 'All Campaigns';
      default:
        return 'Campaigns';
    }
  };

  // Calculate estimated channel breakdown based on step ratios
  // Note: Until we have per-step delivery data, these are estimates based on step counts
  const emailRatio = channelMetrics && (channelMetrics.totalEmailSteps + channelMetrics.totalLinkedInSteps) > 0
    ? channelMetrics.totalEmailSteps / (channelMetrics.totalEmailSteps + channelMetrics.totalLinkedInSteps)
    : 1;
  
  const estimatedEmailsSent = Math.round((stats?.totalMessagesSent ?? 0) * emailRatio);
  const estimatedLinkedInSent = (stats?.totalMessagesSent ?? 0) - estimatedEmailsSent;
  
  const estimatedEmailReplies = Math.round((stats?.totalReplies ?? 0) * emailRatio);
  const estimatedLinkedInReplies = (stats?.totalReplies ?? 0) - estimatedEmailReplies;

  if (isLoading) {
    return (
      <TooltipProvider>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </TooltipProvider>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-destructive">
          Failed to load stats. Please try again.
        </CardContent>
      </Card>
    );
  }

  const messagesTooltipContent = (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-foreground border-b pb-1">Messages Breakdown</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Emails Sent:
          </span>
          <span className="font-medium">{estimatedEmailsSent.toLocaleString()}</span>
        </div>
        {channelMetrics && channelMetrics.linkedinConnectSteps > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Linkedin className="h-3.5 w-3.5" />
              Connection Requests:
            </span>
            <span className="font-medium">—</span>
          </div>
        )}
        {channelMetrics && channelMetrics.linkedinMessageSteps > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Linkedin className="h-3.5 w-3.5" />
              LinkedIn Messages:
            </span>
            <span className="font-medium">—</span>
          </div>
        )}
        {estimatedLinkedInSent > 0 && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Linkedin className="h-3.5 w-3.5" />
              LinkedIn (est.):
            </span>
            <span className="font-medium">{estimatedLinkedInSent.toLocaleString()}</span>
          </div>
        )}
      </div>
      {channelMetrics && channelMetrics.totalLinkedInSteps > 0 && (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          Based on {channelMetrics.totalEmailSteps} email steps & {channelMetrics.totalLinkedInSteps} LinkedIn steps
        </p>
      )}
    </div>
  );

  const repliesTooltipContent = (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-foreground border-b pb-1">Replies Breakdown</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Email Replies:
          </span>
          <span className="font-medium">{estimatedEmailReplies.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Linkedin className="h-3.5 w-3.5" />
            LinkedIn Replies:
          </span>
          <span className="font-medium">{estimatedLinkedInReplies.toLocaleString()}</span>
        </div>
      </div>
      {channelMetrics && channelMetrics.totalLinkedInSteps > 0 && (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          Estimated based on step type distribution
        </p>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Messages Sent"
          value={stats?.totalMessagesSent.toLocaleString() ?? 0}
          icon={<Send className="h-5 w-5 text-primary" />}
          description="Across all campaigns"
          tooltipContent={messagesTooltipContent}
        />
        <StatCard
          title="Total Replies"
          value={stats?.totalReplies.toLocaleString() ?? 0}
          icon={<MessageSquare className="h-5 w-5 text-primary" />}
          description="Positive responses"
          tooltipContent={repliesTooltipContent}
        />
        <StatCard
          title="Total Contacts"
          value={stats?.totalContacts.toLocaleString() ?? 0}
          icon={<Users className="h-5 w-5 text-primary" />}
          description="Synced from platforms"
          onClick={() => setContactsDialogOpen(true)}
          clickable
        />
        <StatCard
          title="Active Campaigns"
          value={stats?.activeCampaigns ?? 0}
          icon={<Zap className="h-5 w-5 text-primary" />}
          description="Currently running"
          onClick={() => openDialog('active')}
          clickable
        />
        <StatCard
          title="Completion Rate"
          value={`${stats?.completionPercentage ?? 0}%`}
          icon={<Target className="h-5 w-5 text-primary" />}
          description="Average across campaigns"
        />
        <StatCard
          title="Out of Office"
          value={stats?.outOfOfficeCount ?? 0}
          icon={<Clock className="h-5 w-5 text-primary" />}
          description="Auto-replies detected"
        />
      </div>

      <CampaignListDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={getDialogTitle()}
        statusFilter={dialogFilter === 'all' ? null : dialogFilter}
      />

      <ContactsListDialog
        open={contactsDialogOpen}
        onOpenChange={setContactsDialogOpen}
      />
    </TooltipProvider>
  );
}
