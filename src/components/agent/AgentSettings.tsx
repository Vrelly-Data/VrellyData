import { useState, useEffect } from 'react';
import { useAgentConfig, useUpsertAgentConfig, useReplyIntegration, type AgentConfigInput } from '@/hooks/useAgent';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Save, CheckCircle2, Eye, EyeOff, Wifi, WifiOff, ExternalLink, AlertTriangle } from 'lucide-react';

const COMMUNICATION_STYLES = [
  { value: 'conversational', label: 'Conversational', description: 'Warm, natural, like a real person' },
  { value: 'direct', label: 'Direct', description: 'Straight to the point, no fluff' },
  { value: 'formal', label: 'Formal', description: 'Professional and polished' },
  { value: 'consultative', label: 'Consultative', description: 'Thoughtful, insight-led' },
] as const;

const DESIRED_ACTIONS = [
  'Book a call',
  'Schedule a demo',
  'Reply to learn more',
  'Visit our website',
] as const;

export function AgentSettings() {
  const { data: config, isLoading } = useAgentConfig();
  const upsertConfig = useUpsertAgentConfig();
  const { toast } = useToast();
  const { data: replyData } = useReplyIntegration();
  const hasIntegration = replyData?.hasIntegration ?? false;
  const integration = replyData?.integration ?? null;

  const { data: campaigns } = useQuery<any[]>({
    queryKey: ['synced-campaigns', integration?.reply_team_id],
    enabled: !!integration?.reply_team_id,
    queryFn: async () => {
      const { data: intRow } = await (supabase as any)
        .from('outbound_integrations')
        .select('team_id')
        .eq('created_by', (await supabase.auth.getSession()).data.session?.user?.id)
        .eq('platform', 'reply.io')
        .limit(1)
        .maybeSingle();

      if (!intRow?.team_id) return [];

      const { data, error } = await (supabase as any)
        .from('synced_campaigns')
        .select('name, stats, team_id')
        .eq('team_id', intRow.team_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        name: c.name,
        total_people: c.stats?.peopleCount ?? 0,
        linkedin_replies: c.stats?.linkedinReplies ?? 0,
        email_replies: c.stats?.replies ?? 0,
      }));
    },
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [formData, setFormData] = useState({
    company_name: '',
    company_url: '',
    sender_name: '',
    sender_title: '',
    sender_linkedin: '',
    sender_bio: '',
    offer_description: '',
    target_icp: '',
    outcome_delivered: '',
    desired_action: 'Book a call',
    communication_style: 'conversational',
    avoid_phrases: '',
    sample_message: '',
    reply_api_key: '',
    mode: 'copilot',
    is_active: false,
  });

  useEffect(() => {
    if (config) {
      setFormData({
        company_name: config.company_name ?? '',
        company_url: config.company_url ?? '',
        sender_name: config.sender_name ?? '',
        sender_title: config.sender_title ?? '',
        sender_linkedin: config.sender_linkedin ?? '',
        sender_bio: config.sender_bio ?? '',
        offer_description: config.offer_description ?? '',
        target_icp: config.target_icp ?? '',
        outcome_delivered: config.outcome_delivered ?? '',
        desired_action: config.desired_action ?? 'Book a call',
        communication_style: config.communication_style ?? 'conversational',
        avoid_phrases: (config.avoid_phrases ?? []).join(', '),
        sample_message: config.sample_message ?? '',
        reply_api_key: config.reply_api_key ?? '',
        mode: config.mode ?? 'copilot',
        is_active: config.is_active ?? false,
      });
    }
  }, [config]);

  const update = (field: string, value: string | boolean) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('idle');
    try {
      const { data, error } = await supabase.functions.invoke('validate-api-key', {
        body: { apiKey: formData.reply_api_key, platform: 'reply_io' },
      });
      if (error || !data?.valid) {
        setConnectionStatus('error');
      } else {
        setConnectionStatus('success');
      }
    } catch {
      setConnectionStatus('error');
    }
    setTestingConnection(false);
  };

  const handleSave = async () => {
    const input: AgentConfigInput = {
      company_name: formData.company_name,
      company_url: formData.company_url || undefined,
      sender_name: formData.sender_name,
      sender_title: formData.sender_title || undefined,
      sender_linkedin: formData.sender_linkedin || undefined,
      sender_bio: formData.sender_bio || undefined,
      offer_description: formData.offer_description,
      target_icp: formData.target_icp || undefined,
      outcome_delivered: formData.outcome_delivered || undefined,
      desired_action: formData.desired_action || undefined,
      communication_style: formData.communication_style,
      avoid_phrases: formData.avoid_phrases
        ? formData.avoid_phrases.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      sample_message: formData.sample_message || undefined,
      reply_api_key: formData.reply_api_key || undefined,
      mode: formData.mode,
      is_active: formData.is_active,
      onboarding_complete: true,
    };
    await upsertConfig.mutateAsync(input);
    toast({ title: 'Settings saved', description: 'Your agent configuration has been updated.' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-8 pb-24">
      <h2 className="text-2xl font-semibold">Agent Settings</h2>

      {/* Section 1 — Agent Status */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label>Active / Paused</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formData.is_active ? 'Your agent is running.' : 'Your agent is paused.'}
              </p>
            </div>
            <Switch checked={formData.is_active} onCheckedChange={(v) => update('is_active', v)} />
          </div>
          <div>
            <Label>Agent Mode</Label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                type="button"
                onClick={() => update('mode', 'copilot')}
                className={cn(
                  'border rounded-lg p-4 text-left transition-colors',
                  formData.mode === 'copilot'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:border-muted-foreground/40'
                )}
              >
                <div className="font-medium text-sm">Co-pilot</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Your agent drafts responses. You approve before anything sends.
                </div>
              </button>
              <button
                type="button"
                onClick={() => update('mode', 'auto')}
                className={cn(
                  'border rounded-lg p-4 text-left transition-colors',
                  formData.mode === 'auto'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:border-muted-foreground/40'
                )}
              >
                <div className="font-medium text-sm">Auto</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Your agent handles email replies automatically. LinkedIn always requires your approval.
                </div>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2 — Sender Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Sender Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="s_sender_name">Full Name *</Label>
            <Input id="s_sender_name" value={formData.sender_name} onChange={(e) => update('sender_name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s_sender_title">Job Title</Label>
            <Input id="s_sender_title" value={formData.sender_title} onChange={(e) => update('sender_title', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s_sender_linkedin">LinkedIn URL</Label>
            <Input id="s_sender_linkedin" value={formData.sender_linkedin} onChange={(e) => update('sender_linkedin', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s_sender_bio">Bio</Label>
            <Textarea id="s_sender_bio" value={formData.sender_bio} onChange={(e) => update('sender_bio', e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Communication Style</Label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {COMMUNICATION_STYLES.map((style) => (
                <button
                  key={style.value}
                  type="button"
                  onClick={() => update('communication_style', style.value)}
                  className={cn(
                    'border rounded-lg p-4 text-left transition-colors',
                    formData.communication_style === style.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-muted-foreground/40'
                  )}
                >
                  <div className="font-medium text-sm">{style.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{style.description}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="s_avoid">Things to Avoid</Label>
            <Input id="s_avoid" value={formData.avoid_phrases} onChange={(e) => update('avoid_phrases', e.target.value)} placeholder="Comma-separated phrases to never use" />
          </div>
          <div>
            <Label htmlFor="s_sample">Sample Message</Label>
            <Textarea id="s_sample" value={formData.sample_message} onChange={(e) => update('sample_message', e.target.value)} rows={4} placeholder="Paste a message you've sent that got great replies." />
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Company Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Company Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="s_company_name">Company Name *</Label>
            <Input id="s_company_name" value={formData.company_name} onChange={(e) => update('company_name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s_company_url">Company URL</Label>
            <Input id="s_company_url" value={formData.company_url} onChange={(e) => update('company_url', e.target.value)} placeholder="https://yourcompany.com" />
          </div>
          <div>
            <Label htmlFor="s_offer">What you sell *</Label>
            <Textarea id="s_offer" value={formData.offer_description} onChange={(e) => update('offer_description', e.target.value)} rows={3} />
          </div>
          <div>
            <Label htmlFor="s_icp">Who it's for</Label>
            <Input id="s_icp" value={formData.target_icp} onChange={(e) => update('target_icp', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s_outcome">Outcome you deliver</Label>
            <Input id="s_outcome" value={formData.outcome_delivered} onChange={(e) => update('outcome_delivered', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s_action">Desired prospect action</Label>
            <Select value={formData.desired_action} onValueChange={(v) => update('desired_action', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DESIRED_ACTIONS.map((action) => (
                  <SelectItem key={action} value={action}>{action}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Section 4 — Reply.io Connection */}
      <Card>
        <CardHeader>
          <CardTitle>Reply.io Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasIntegration ? (
            <div className="space-y-3">
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Reply.io Connected via Data Playground
              </Badge>
              {integration && (
                <div className="text-sm text-muted-foreground space-y-1">
                  {integration.reply_team_id && <div>Team ID: {integration.reply_team_id}</div>}
                  {integration.last_synced_at && (
                    <div>Last synced: {new Date(integration.last_synced_at).toLocaleDateString()}</div>
                  )}
                </div>
              )}
              <a
                href="/playground"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Manage in Data Playground <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Reply.io Not Connected
              </Badge>
              <p className="text-sm text-muted-foreground">
                Connect Reply.io in your Data Playground to activate your agent.
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href="/playground">
                  Go to Data Playground <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monitored Campaigns */}
      <Card>
        <CardHeader>
          <CardTitle>Monitored Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns && campaigns.length > 0 ? (
            <div className="space-y-3">
              {campaigns.map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="font-medium text-sm">{c.name}</span>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{c.total_people ?? 0} people</span>
                    <span>{c.linkedin_replies ?? 0} LinkedIn</span>
                    <span>{c.email_replies ?? 0} email</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>Sync your campaigns in the Data Playground to see them here.</p>
              <a
                href="/playground"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Go to Data Playground <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky save button */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end z-10">
        <Button
          onClick={handleSave}
          disabled={upsertConfig.isPending || !formData.company_name || !formData.sender_name || !formData.offer_description}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {upsertConfig.isPending ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
