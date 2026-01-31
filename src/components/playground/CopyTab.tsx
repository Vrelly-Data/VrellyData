import { useState } from 'react';
import { useSyncedSequences, useSyncSequences } from '@/hooks/useSyncedSequences';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Mail, Linkedin, MessageSquare, Phone, RefreshCw, Copy, FileText, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

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

export function CopyTab() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  
  const { data: sequences, isLoading: sequencesLoading } = useSyncedSequences(
    selectedCampaignId || undefined
  );
  const { data: campaigns, isLoading: campaignsLoading } = useSyncedCampaigns(true);
  const { integrations } = useOutboundIntegrations();
  const { mutate: syncSequences, isPending: isSyncing } = useSyncSequences();

  const activeIntegration = integrations?.find(i => i.platform === 'reply.io' && i.is_active);
  const selectedCampaign = campaigns?.find(c => c.id === selectedCampaignId);

  // Calculate cumulative day for each step
  // delay_days represents wait time BEFORE this step executes
  const sequencesWithDays = (() => {
    if (!sequences) return [];
    let cumulativeDay = 1;
    return sequences.map((step) => {
      // Add delay from THIS step (wait before this step runs)
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

  const handleRevamp = (stepId: string) => {
    toast.info('Revamp feature coming soon!');
  };

  // Loading state
  if (campaignsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No campaigns available
  if (!campaigns?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Campaigns Synced</h2>
        <p className="text-muted-foreground max-w-md">
          First sync your campaigns from the Playground tab to see email copy here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Campaign Selector - Always Visible */}
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

      {/* Campaign selected - show header and sequences */}
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
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleSyncCampaign}
                    disabled={isSyncing}
                  >
                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Sync Copy
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => toast.info('Revamp All feature coming soon!')}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Revamp All
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

          {/* No sequences for this campaign */}
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
                
                return (
                  <Card key={step.id} className="overflow-hidden">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleStep(step.id)}>
                      <CollapsibleTrigger asChild>
                        <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                                <Badge variant="outline" className="flex items-center gap-1.5">
                                  {stepTypeIcons[step.step_type || 'email'] || <Mail className="h-4 w-4" />}
                                  Step {step.step_number}
                                </Badge>
                              </div>
                              <span className="text-sm text-muted-foreground">
                                {stepTypeLabels[step.step_type || 'email'] || step.step_type}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                Day {step.cumulativeDay}
                              </Badge>
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
                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {step.subject && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyToClipboard(step.subject!, 'subject');
                                }}
                              >
                                <Copy className="h-4 w-4 mr-2" />
                                Copy Subject
                              </Button>
                            )}
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyToClipboard(step.body_text || step.body_html || '', 'body');
                              }}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy Body
                            </Button>
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevamp(step.id);
                              }}
                            >
                              <Sparkles className="h-4 w-4 mr-2" />
                              Revamp
                            </Button>
                          </div>

                          {/* Email Body Preview */}
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
    </div>
  );
}
