import { useState } from 'react';
import { useSyncedSequences, useSyncSequences } from '@/hooks/useSyncedSequences';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { supabase } from '@/integrations/supabase/client';
import { useCredit } from '@/lib/credits';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Mail, Linkedin, MessageSquare, Phone, RefreshCw, Copy, FileText, Sparkles, ChevronDown, ChevronRight, Plus, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { RevampResultDialog } from './RevampResultDialog';
import { CreateCopyDialog } from './CreateCopyDialog';
import { ViewCopyDialog } from './ViewCopyDialog';
import { useAICopyGroups, useDeleteCopyGroup, type CopyGroup } from '@/hooks/useCopyTemplates';
import { formatDistanceToNow } from 'date-fns';

const stepTypeIcons: Record<string, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  linkedin_message: <Linkedin className="h-4 w-4" />,
  linkedin_connect: <Linkedin className="h-4 w-4" />,
  linkedin_inmail: <Linkedin className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  sms: <MessageSquare className="h-4 w-4" />,
};

const stepTypeLabels: Record<string, string> = {
  email: 'Email',
  linkedin_message: 'LinkedIn Message',
  linkedin_connect: 'LinkedIn Connect',
  linkedin_inmail: 'LinkedIn InMail',
  call: 'Call',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

interface RevampResult {
  subject: string | null;
  body: string | null;
  why_this_works?: string[];
  key_insight?: string;
  source_insights?: { title: string; category: string }[];
}

function DocCard({ group, onOpen }: { group: CopyGroup; onOpen: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const deleteMutation = useDeleteCopyGroup();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteMutation.mutateAsync(group.groupId);
      toast.success('Copy deleted');
    } catch {
      toast.error('Failed to delete copy');
    } finally {
      setDeleting(false);
    }
  };

  const channelLabel = group.channels.length > 0
    ? group.channels.slice(0, 2).join(', ') + (group.channels.length > 2 ? ` +${group.channels.length - 2}` : '')
    : 'Email';

  return (
    <div
      className="group relative rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-200"
      onClick={onOpen}
    >
      <div className="h-8 bg-gradient-to-r from-primary/20 to-primary/10 flex items-center px-3 gap-2">
        <FileText className="h-3.5 w-3.5 text-primary/70" />
        <Sparkles className="h-3 w-3 text-primary/50" />
      </div>
      <div className="p-3 space-y-1.5">
        <p className="font-semibold text-sm leading-snug line-clamp-2">{group.name}</p>
        <p className="text-xs text-muted-foreground">
          {group.stepCount} step{group.stepCount !== 1 ? 's' : ''} · {channelLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(group.createdAt), { addSuffix: true })}
        </p>
      </div>
      <div className="px-3 pb-3 flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs gap-1"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function CopyTab() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [revampingStepId, setRevampingStepId] = useState<string | null>(null);
  const [revampResult, setRevampResult] = useState<RevampResult | null>(null);
  const [revampOriginal, setRevampOriginal] = useState<{ subject: string | null; body: string | null } | null>(null);
  const [revampStepInfo, setRevampStepInfo] = useState<{ stepNumber: number; stepType: string } | null>(null);
  const [revampDialogOpen, setRevampDialogOpen] = useState(false);
  const [revampAllProgress, setRevampAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [createCopyOpen, setCreateCopyOpen] = useState(false);
  const [viewGroup, setViewGroup] = useState<CopyGroup | null>(null);

  const { data: copyGroups = [] } = useAICopyGroups();
  
  const { data: sequences, isLoading: sequencesLoading } = useSyncedSequences(
    selectedCampaignId || undefined
  );
  const { data: campaigns, isLoading: campaignsLoading } = useSyncedCampaigns(true);
  const { integrations } = useOutboundIntegrations();
  const { mutate: syncSequences, isPending: isSyncing } = useSyncSequences();

  const activeIntegration = integrations?.find(i => i.platform === 'reply.io' && i.is_active);
  const selectedCampaign = campaigns?.find(c => c.id === selectedCampaignId);

  const sequencesWithDays = (() => {
    if (!sequences) return [];
    let cumulativeDay = 1;
    return sequences.map((step) => {
      if (step.delay_days) {
        cumulativeDay += step.delay_days;
      }
      return { ...step, cumulativeDay };
    });
  })();

  const handleSyncCampaign = () => {
    if (!activeIntegration) {
      toast.error('No active Reply.io integration found');
      return;
    }
    if (!selectedCampaignId) {
      toast.error('Please select a campaign first');
      return;
    }
    syncSequences({ campaignId: selectedCampaignId, integrationId: activeIntegration.id });
  };

  const handleCopyToClipboard = (text: string, type: 'subject' | 'body') => {
    navigator.clipboard.writeText(text);
    toast.success(`${type === 'subject' ? 'Subject' : 'Body'} copied to clipboard`);
  };

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const callRevamp = async (subject: string | null, body: string | null, stepType: string | null) => {
    const { data, error } = await supabase.functions.invoke('revamp-copy', {
      body: {
        subject: subject || '',
        body: body || '',
        stepType: stepType || 'email',
        campaignName: selectedCampaign?.name || '',
      },
    });
    if (error) throw error;
    return data as RevampResult;
  };

  const handleRevamp = async (stepId: string) => {
    const step = sequences?.find(s => s.id === stepId);
    if (!step) return;

    setRevampingStepId(stepId);
    try {
      // Deduct 1 AI generation credit per revamp
      await useCredit('ai_generation', 1);

      const result = await callRevamp(step.subject, step.body_text || step.body_html, step.step_type);
      setRevampResult(result);
      setRevampOriginal({ subject: step.subject, body: step.body_text || step.body_html });
      setRevampStepInfo({ stepNumber: step.step_number, stepType: step.step_type || 'email' });
      setRevampDialogOpen(true);
    } catch (err: any) {
      if (err.message === 'UPGRADE_REQUIRED') {
        toast.error('You need an active subscription to revamp copy.');
      } else if (err.message === 'OUT_OF_CREDITS') {
        toast.error('You have run out of AI generation credits for this period.');
      } else {
        toast.error(`Revamp failed: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setRevampingStepId(null);
    }
  };

  const handleRevampAll = async () => {
    if (!sequencesWithDays.length) return;

    const total = sequencesWithDays.length;

    // Check credits for all steps upfront
    try {
      await useCredit('ai_generation', total);
    } catch (err: any) {
      if (err.message === 'UPGRADE_REQUIRED') {
        toast.error('You need an active subscription to revamp copy.');
      } else if (err.message === 'OUT_OF_CREDITS') {
        toast.error(`Not enough AI credits to revamp all ${total} steps.`);
      } else {
        toast.error(`Credit check failed: ${err.message}`);
      }
      return;
    }

    setRevampAllProgress({ current: 0, total });

    const results: { stepNumber: number; stepType: string; original: { subject: string | null; body: string | null }; revamped: RevampResult }[] = [];

    for (let i = 0; i < total; i++) {
      const step = sequencesWithDays[i];
      setRevampAllProgress({ current: i + 1, total });
      try {
        const result = await callRevamp(step.subject, step.body_text || step.body_html, step.step_type);
        results.push({
          stepNumber: step.step_number,
          stepType: step.step_type || 'email',
          original: { subject: step.subject, body: step.body_text || step.body_html },
          revamped: result,
        });
      } catch {
        toast.error(`Failed to revamp step ${step.step_number}`);
      }
    }

    setRevampAllProgress(null);

    if (results.length > 0) {
      // Show the first result in the dialog; user can close and see others were processed
      const first = results[0];
      setRevampResult(first.revamped);
      setRevampOriginal(first.original);
      setRevampStepInfo({ stepNumber: first.stepNumber, stepType: first.stepType });
      setRevampDialogOpen(true);
      toast.success(`Revamped ${results.length} of ${total} steps`);
    }
  };

  // Loading state
  if (campaignsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setCreateCopyOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create New Copy
        </Button>
      </div>

      {/* No campaigns available */}
      {!campaigns?.length && (
        <div className="flex flex-col items-center justify-center h-64 text-center border-2 border-dashed rounded-lg">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Campaigns Synced</h2>
          <p className="text-muted-foreground max-w-md mb-4">
            First sync your campaigns from the Playground tab to see email copy here.
          </p>
        </div>
      )}

      {!!campaigns?.length && (
        <>
      
      {/* Campaign Selector */}
      <div className="flex items-center gap-4">
        <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select a campaign to view copy..." />
          </SelectTrigger>
          <SelectContent>
            {campaigns.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* No campaign selected state */}
      {!selectedCampaignId && (
        <div className="flex flex-col items-center justify-center h-64 text-center border-2 border-dashed rounded-lg">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Select a Campaign</h2>
          <p className="text-muted-foreground max-w-md">
            Choose a campaign from the dropdown above to view and manage its email copy.
          </p>
        </div>
      )}

      {/* Campaign selected */}
      {selectedCampaignId && selectedCampaign && (
        <div className="space-y-4">
          {/* Campaign Header */}
          <Card>
            <CardHeader className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg">{selectedCampaign.name}</CardTitle>
                  {selectedCampaign.status && (
                    <Badge variant={selectedCampaign.status === 'active' ? 'default' : 'secondary'}>
                      {selectedCampaign.status}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleSyncCampaign} disabled={isSyncing}>
                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Sync Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRevampAll}
                    disabled={!!revampAllProgress || !sequencesWithDays.length}
                  >
                    {revampAllProgress ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Revamping {revampAllProgress.current}/{revampAllProgress.total}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Revamp All
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {sequences && sequences.length > 0 && (
                <CardDescription className="mt-2">
                  {sequences.length} sequence step{sequences.length !== 1 ? 's' : ''} available
                </CardDescription>
              )}
            </CardHeader>
          </Card>

          {/* Loading sequences */}
          {sequencesLoading && (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* No sequences */}
          {!sequencesLoading && (!sequences || sequences.length === 0) && (
            <div className="flex flex-col items-center justify-center h-48 text-center border-2 border-dashed rounded-lg">
              <Mail className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-lg font-medium mb-2">No Email Copy Found</h3>
              <p className="text-muted-foreground max-w-sm mb-4">
                This campaign hasn't been synced yet or has no sequence steps.
              </p>
              <Button onClick={handleSyncCampaign} disabled={isSyncing}>
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync Copy Now
              </Button>
            </div>
          )}

          {/* Sequence Steps */}
          {!sequencesLoading && sequencesWithDays.length > 0 && (
            <div className="space-y-3">
              {sequencesWithDays.map((step) => {
                const isExpanded = expandedSteps.has(step.id);
                const isRevamping = revampingStepId === step.id;

                return (
                  <Card key={step.id} className="overflow-hidden">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleStep(step.id)}>
                      <CollapsibleTrigger asChild>
                        <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                <Badge variant="outline" className="flex items-center gap-1.5">
                                  {stepTypeIcons[step.step_type || 'email'] || <Mail className="h-4 w-4" />}
                                  Step {step.step_number}
                                </Badge>
                              </div>
                              <span className="text-sm text-muted-foreground">
                                {stepTypeLabels[step.step_type || 'email'] || step.step_type}
                              </span>
                              <Badge variant="secondary" className="text-xs">Day {step.cumulativeDay}</Badge>
                            </div>
                          </div>
                          {step.subject && (
                            <div className="mt-2 text-sm font-medium truncate max-w-xl">
                              Subject: {step.subject}
                            </div>
                          )}
                        </CardHeader>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <CardContent className="pt-0 pb-4 space-y-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {step.subject && (
                              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleCopyToClipboard(step.subject!, 'subject'); }}>
                                <Copy className="h-4 w-4 mr-2" /> Copy Subject
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleCopyToClipboard(step.body_text || step.body_html || '', 'body'); }}>
                              <Copy className="h-4 w-4 mr-2" /> Copy Body
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isRevamping || !!revampAllProgress}
                              onClick={(e) => { e.stopPropagation(); handleRevamp(step.id); }}
                            >
                              {isRevamping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                              {isRevamping ? 'Revamping...' : 'Revamp'}
                            </Button>
                          </div>

                          {step.body_html && (
                            <div
                              className="prose prose-sm max-w-none p-4 bg-muted/30 rounded-md overflow-auto max-h-96 border"
                              dangerouslySetInnerHTML={{ __html: step.body_html }}
                            />
                          )}
                          {!step.body_html && step.body_text && (
                            <div className="p-4 bg-muted/30 rounded-md overflow-auto max-h-96 border whitespace-pre-wrap text-sm">
                              {step.body_text}
                            </div>
                          )}
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Saved Copies section */}
      {copyGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-sm font-medium text-muted-foreground">Saved Copies</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {copyGroups.map((group) => (
              <DocCard
                key={group.groupId}
                group={group}
                onOpen={() => setViewGroup(group)}
              />
            ))}
          </div>
        </div>
      )}

      <RevampResultDialog
        open={revampDialogOpen}
        onClose={() => setRevampDialogOpen(false)}
        original={revampOriginal || { subject: null, body: null }}
        revamped={revampResult}
        stepNumber={revampStepInfo?.stepNumber || 0}
        stepType={revampStepInfo?.stepType || 'email'}
        campaignName={selectedCampaign?.name}
      />

      <CreateCopyDialog open={createCopyOpen} onOpenChange={setCreateCopyOpen} />
      <ViewCopyDialog group={viewGroup} open={!!viewGroup} onOpenChange={(o) => { if (!o) setViewGroup(null); }} />
    </div>
  );
}
