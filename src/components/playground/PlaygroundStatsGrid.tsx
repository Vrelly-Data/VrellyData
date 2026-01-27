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

  // Use actual email-specific data from Reply.io API
  const emailsDelivered = stats?.emailDeliveries ?? 0;
  const emailReplies = stats?.emailReplies ?? 0;
  const linkedinCampaignCount = stats?.linkedinCampaignCount ?? 0;
  
  // LinkedIn metrics from webhooks
  const linkedinMessagesSent = stats?.linkedinMessagesSent ?? 0;
  const linkedinConnectionsSent = stats?.linkedinConnectionsSent ?? 0;
  const linkedinReplies = stats?.linkedinReplies ?? 0;
  const hasWebhookData = linkedinMessagesSent > 0 || linkedinConnectionsSent > 0 || linkedinReplies > 0;

  // Check if we have LinkedIn steps from the channel metrics hook
  const hasLinkedInSteps = channelMetrics && channelMetrics.totalLinkedInSteps > 0;

  const messagesTooltipContent = (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-foreground border-b pb-1">Messages Breakdown</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Emails Sent:
          </span>
          <span className="font-medium">{emailsDelivered.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Linkedin className="h-3.5 w-3.5" />
            LinkedIn Messages:
          </span>
          <span className="font-medium">
            {hasWebhookData ? linkedinMessagesSent.toLocaleString() : 'Not tracked'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Linkedin className="h-3.5 w-3.5" />
            Connection Requests:
          </span>
          <span className="font-medium">
            {hasWebhookData ? linkedinConnectionsSent.toLocaleString() : 'Not tracked'}
          </span>
        </div>
        {linkedinCampaignCount > 0 && !hasWebhookData && (
          <div className="flex items-center justify-between gap-4 pt-1 border-t">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              LinkedIn-only Campaigns:
            </span>
            <span className="font-medium">{linkedinCampaignCount}</span>
          </div>
        )}
      </div>
      {hasWebhookData ? (
        <p className="text-xs text-green-600 pt-1 border-t flex items-center gap-1">
          <Zap className="h-3 w-3" /> Real-time via webhooks
        </p>
      ) : (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          Enable webhooks for LinkedIn tracking
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
          <span className="font-medium">{emailReplies.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Linkedin className="h-3.5 w-3.5" />
            LinkedIn Replies:
          </span>
          <span className="font-medium">
            {hasWebhookData ? linkedinReplies.toLocaleString() : 'Not tracked'}
          </span>
        </div>
      </div>
      {hasWebhookData ? (
        <p className="text-xs text-green-600 pt-1 border-t flex items-center gap-1">
          <Zap className="h-3 w-3" /> Real-time via webhooks
        </p>
      ) : (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          Enable webhooks for LinkedIn tracking
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
