import { useState } from 'react';
import { useSyncedSequences, useSyncSequences } from '@/hooks/useSyncedSequences';
import { useSyncedCampaigns } from '@/hooks/useSyncedCampaigns';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Mail, Linkedin, MessageSquare, Phone, RefreshCw, Copy, FileText } from 'lucide-react';
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
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  
  const { data: sequences, isLoading: sequencesLoading } = useSyncedSequences(
    selectedCampaignId === 'all' ? undefined : selectedCampaignId
  );
  const { data: campaigns } = useSyncedCampaigns(true);
  const { integrations } = useOutboundIntegrations();
  const { mutate: syncSequences, isPending: isSyncing } = useSyncSequences();

  const activeIntegration = integrations?.find(i => i.platform === 'reply.io' && i.is_active);

  const handleSyncCampaign = (campaignId: string) => {
    if (!activeIntegration) {
      toast.error('No active Reply.io integration found');
      return;
    }
    syncSequences({ campaignId, integrationId: activeIntegration.id });
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (sequencesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sequences?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Email Copy Synced</h2>
        <p className="text-muted-foreground max-w-md mb-4">
          Sync your campaigns to fetch email templates and sequence steps.
        </p>
        {campaigns?.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Select a campaign to sync its copy:</p>
            <Select onValueChange={handleSyncCampaign} disabled={isSyncing}>
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

  // Group sequences by campaign
  const groupedByCampaign = sequences.reduce((acc, seq) => {
    const key = seq.campaign_id;
    if (!acc[key]) {
      acc[key] = { name: seq.campaign_name, steps: [] };
    }
    acc[key].steps.push(seq);
    return acc;
  }, {} as Record<string, { name: string; steps: typeof sequences }>);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
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
        
        {selectedCampaignId !== 'all' && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => handleSyncCampaign(selectedCampaignId)}
            disabled={isSyncing}
          >
            {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh Copy
          </Button>
        )}
      </div>

      {/* Sequences by campaign */}
      {Object.entries(groupedByCampaign).map(([campaignId, { name, steps }]) => (
        <div key={campaignId} className="space-y-3">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            {name}
            <Badge variant="secondary">{steps.length} steps</Badge>
          </h3>
          
          <div className="grid gap-3">
            {steps.map((step) => (
              <Card 
                key={step.id} 
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
              >
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="flex items-center gap-1">
                        {stepTypeIcons[step.step_type || 'email'] || <Mail className="h-4 w-4" />}
                        Step {step.step_number}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {stepTypeLabels[step.step_type || 'email'] || step.step_type}
                      </span>
                      {step.delay_days && step.delay_days > 0 && (
                        <span className="text-xs text-muted-foreground">
                          +{step.delay_days}d delay
                        </span>
                      )}
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyToClipboard(step.body_text || step.body_html || '');
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  {step.subject && (
                    <CardTitle className="text-sm font-medium mt-2">
                      Subject: {step.subject}
                    </CardTitle>
                  )}
                </CardHeader>
                
                {expandedStep === step.id && step.body_html && (
                  <CardContent className="pt-0">
                    <div 
                      className="prose prose-sm max-w-none p-4 bg-muted/30 rounded-md overflow-auto max-h-96"
                      dangerouslySetInnerHTML={{ __html: step.body_html }}
                    />
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
