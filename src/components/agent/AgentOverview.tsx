import { useAgentConfig, useUpsertAgentConfig } from '@/hooks/useAgent';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, Play, Clock, Users, MessageSquare, CalendarCheck } from 'lucide-react';

export function AgentOverview() {
  const { data: config, isLoading } = useAgentConfig();
  const upsertConfig = useUpsertAgentConfig();

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toggleActive = () => {
    upsertConfig.mutate({
      company_name: config.company_name,
      sender_name: config.sender_name,
      offer_description: config.offer_description,
      is_active: !config.is_active,
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Overview</h2>
        <Badge variant={config.mode === 'auto' ? 'default' : 'secondary'} className="text-xs">
          {config.mode === 'auto' ? 'Auto' : 'Co-pilot'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Agent Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Agent Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{config.sender_name}</div>
                <div className="text-sm text-muted-foreground">{config.company_name}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{config.is_active ? 'Active' : 'Paused'}</span>
                <Switch
                  checked={config.is_active ?? false}
                  onCheckedChange={toggleActive}
                  disabled={upsertConfig.isPending}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Run */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Next Run</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Monday at 6:00 AM</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* This Week Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">This Week</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">0</div>
                <div className="text-xs text-muted-foreground">Contacts Pushed</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">0</div>
                <div className="text-xs text-muted-foreground">Replies Received</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CalendarCheck className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">0</div>
                <div className="text-xs text-muted-foreground">Meetings Booked</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Action */}
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button disabled className="gap-2">
                <Play className="h-4 w-4" />
                Run Now
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Coming in next update</TooltipContent>
        </Tooltip>
      </div>

      {/* Recent Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your first run hasn't happened yet. Check back Monday.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
