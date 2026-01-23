import { Card, CardContent } from '@/components/ui/card';
import { usePlaygroundStats } from '@/hooks/usePlaygroundStats';
import { Send, MessageSquare, Users, Zap, Target, Trophy, Loader2 } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  isPlaceholder?: boolean;
}

function StatCard({ title, value, icon, description, isPlaceholder }: StatCardProps) {
  return (
    <Card className={isPlaceholder ? 'border-dashed' : ''}>
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

export function PlaygroundStatsGrid() {
  const { data: stats, isLoading, error } = usePlaygroundStats();

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
      />
      <StatCard
        title="Active Campaigns"
        value={stats?.activeCampaigns ?? 0}
        icon={<Zap className="h-5 w-5 text-primary" />}
        description="Currently running"
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
  );
}
