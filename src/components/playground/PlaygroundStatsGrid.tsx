import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { usePlaygroundStats } from '@/hooks/usePlaygroundStats';
import { Send, MessageSquare, Users, Zap, Target, Trophy, Loader2 } from 'lucide-react';
import { CampaignListDialog } from './CampaignListDialog';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  isPlaceholder?: boolean;
  onClick?: () => void;
  clickable?: boolean;
}

function StatCard({ title, value, icon, description, isPlaceholder, onClick, clickable }: StatCardProps) {
  return (
    <Card 
      className={`${isPlaceholder ? 'border-dashed' : ''} ${clickable ? 'cursor-pointer hover:bg-accent/50 transition-colors' : ''}`}
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
}

type DialogFilter = 'all' | 'active' | null;

export function PlaygroundStatsGrid() {
  const { data: stats, isLoading, error } = usePlaygroundStats();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFilter, setDialogFilter] = useState<DialogFilter>(null);

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

  if (isLoading) {
    return (
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

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Messages Sent"
          value={stats?.totalMessagesSent.toLocaleString() ?? 0}
          icon={<Send className="h-5 w-5 text-primary" />}
          description="Across all campaigns"
        />
        <StatCard
          title="Total Replies"
          value={stats?.totalReplies.toLocaleString() ?? 0}
          icon={<MessageSquare className="h-5 w-5 text-primary" />}
          description="Positive responses"
        />
        <StatCard
          title="Total Contacts"
          value={stats?.totalContacts.toLocaleString() ?? 0}
          icon={<Users className="h-5 w-5 text-primary" />}
          description="Synced from platforms"
          onClick={() => openDialog('all')}
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
          title="Campaign Score"
          value=""
          icon={<Trophy className="h-5 w-5 text-muted-foreground" />}
          description="Proprietary scoring system"
          isPlaceholder
        />
      </div>

      <CampaignListDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={getDialogTitle()}
        statusFilter={dialogFilter === 'all' ? null : dialogFilter}
      />
    </>
  );
}
