import { useState, useEffect, useRef } from 'react';
import { Send, UserPlus, Loader2, X, Linkedin, Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { useUpdateAgentLead, useApproveDraft, useLiveLead, type AgentLead } from '@/hooks/useAgentInbox';
import {
  useSendHeyReachMessage,
  useAddToHeyReachCampaign,
  useHeyReachCampaigns,
} from '@/hooks/useHeyReach';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export type { AgentLead };

// Lead disposition tags. Selecting any of these also flips inbox_status to
// 'dismissed', moving the lead from Pending Approval to Total Inbox.
// Order mirrors the pipeline columns: negative dispositions → active → won.
export const PIPELINE_STAGES = [
  { value: 'bad_lead', label: 'Bad Lead' },
  { value: 'ooo', label: 'OOO' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'meeting_booked', label: 'Meeting Booked' },
  { value: 'closed', label: 'Closed' },
] as const;

export type PipelineStageValue = typeof PIPELINE_STAGES[number]['value'];

export function getPipelineStageLabel(value: string | null | undefined): string | null {
  const match = PIPELINE_STAGES.find((s) => s.value === value);
  return match?.label ?? null;
}

const INTENT_COLORS: Record<string, string> = {
  interested: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  needs_more_info: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  not_interested: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  out_of_office: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  bounce: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  referral: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface LeadDetailPanelProps {
  lead: AgentLead;
  onClose: () => void;
  showDraft?: boolean;
  classifying?: boolean;
}

function useSendAgentReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, draftResponse, intent }: { leadId: string; draftResponse: string; intent: string }) => {
      const { data, error } = await supabase.functions.invoke('send-agent-reply', {
        body: { leadId, draftResponse, intent },
      });
      if (error) throw new Error(error.message || 'Failed to send reply');
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['agent-activity'] });
    },
  });
}

export function LeadDetailPanel({ lead: initialLead, onClose, showDraft = true, classifying = false }: LeadDetailPanelProps) {
  const { data: liveLead } = useLiveLead(initialLead.id);
  const lead = liveLead ?? initialLead;

  const updateLead = useUpdateAgentLead();
  const approveDraft = useApproveDraft();
  const sendReply = useSendAgentReply();
  const { toast } = useToast();
  const [draftText, setDraftText] = useState(lead.draft_response || '');
  const [notes, setNotes] = useState(lead.notes || '');

  // HeyReach actions (for LinkedIn channel)
  const sendMessage = useSendHeyReachMessage();
  const addToCampaign = useAddToHeyReachCampaign();
  const { data: heyreachCampaigns = [], isLoading: campaignsLoading } = useHeyReachCampaigns();
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  // Sync draft text when live data brings in a new draft
  const [lastSyncedDraft, setLastSyncedDraft] = useState(lead.draft_response || '');
  if (lead.draft_response && lead.draft_response !== lastSyncedDraft) {
    setDraftText(lead.draft_response);
    setLastSyncedDraft(lead.draft_response);
  }
  const [showConfirm, setShowConfirm] = useState(false);

  const isLinkedIn = lead.channel === 'linkedin';

  const handleStageChange = (newStage: string) => {
    if (newStage === lead.pipeline_stage) return;
    updateLead.mutate({
      leadId: lead.id,
      // Tag change always moves the lead to Total Inbox (inbox_status='dismissed').
      updates: { pipeline_stage: newStage, inbox_status: 'dismissed' },
      logStageChange: {
        oldStage: lead.pipeline_stage,
        newStage,
        leadName: lead.full_name,
        leadCompany: lead.company,
      },
    });
  };

  const handleApprove = () => {
    setShowConfirm(false);
    sendReply.mutate(
      {
        leadId: lead.id,
        draftResponse: draftText,
        intent: lead.intent,
      },
      {
        onSuccess: () => {
          toast({ title: 'Reply sent via Reply.io ✓' });
        },
        onError: (err: any) => {
          const msg = err?.message || 'Failed to send reply';
          if (msg.includes('No campaign mapped')) {
            toast({
              title: 'Campaign not configured',
              description: 'Set up Campaign Rules in Agent Settings to enable sending.',
              variant: 'destructive',
            });
          } else {
            toast({ title: 'Error', description: msg, variant: 'destructive' });
          }
        },
      }
    );
  };

  const handleDismiss = () => {
    updateLead.mutate({
      leadId: lead.id,
      updates: { inbox_status: 'dismissed' },
    });
  };

  const handleNotesSave = () => {
    // Skip if the textarea lost focus without the user having edited it.
    // Prevents a noisy update round-trip on every click-away.
    if (notes === (lead.notes ?? '')) return;
    updateLead.mutate({
      leadId: lead.id,
      updates: { notes },
    });
  };

  // HeyReach direct message — uses the AI draft as the message
  const handleSendHeyReachMessage = () => {
    if (!draftText.trim()) return;
    sendMessage.mutate({ lead_id: lead.id, message: draftText.trim() });
  };

  // HeyReach add to campaign — passes the AI draft as the `message` custom field.
  // Select value is the Supabase UUID (stable PK); we resolve to the HeyReach-native
  // external_campaign_id at send time since that's what the edge function forwards
  // as `campaignId` to HeyReach's AddLeadsToCampaignV2.
  const handleAddToCampaign = () => {
    const campaign = heyreachCampaigns.find((c) => c.id === selectedCampaignId);
    if (!draftText.trim() || !campaign?.external_campaign_id) return;
    addToCampaign.mutate(
      {
        lead_id: lead.id,
        campaign_id: campaign.external_campaign_id,
        message: draftText.trim(),
        campaign_name: campaign.name,
      },
      {
        onSuccess: () => {
          setSelectedCampaignId('');
        },
      }
    );
  };

  const thread = lead.reply_thread?.length > 0
    ? lead.reply_thread
    : lead.last_reply_text
      ? [{ role: 'prospect', content: lead.last_reply_text, timestamp: lead.last_reply_at, channel: lead.channel }]
      : [];

  // Auto-scroll the conversation container to the bottom whenever the
  // thread grows or a new lead is opened.
  const threadScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, lead.id]);

  const confidenceColor =
    lead.intent_confidence > 0.7 ? 'text-green-600' :
    lead.intent_confidence > 0.4 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-lg truncate">{lead.full_name}</h3>
          {lead.company && (
            <p className="text-sm text-muted-foreground">{lead.company}</p>
          )}
          {lead.job_title && (
            <p className="text-xs text-muted-foreground">{lead.job_title}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="outline" className={cn(
              'text-xs',
              lead.channel === 'linkedin'
                ? 'border-blue-300 text-blue-700 dark:text-blue-400'
                : 'border-green-300 text-green-700 dark:text-green-400'
            )}>
              {lead.channel === 'linkedin' ? (
                <><Linkedin className="h-3 w-3 mr-1" /> LinkedIn</>
              ) : (
                <><Mail className="h-3 w-3 mr-1" /> Email</>
              )}
            </Badge>
            {lead.intent && (
              <Badge className={cn('text-xs', INTENT_COLORS[lead.intent] || INTENT_COLORS.unknown)}>
                {lead.intent.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={lead.pipeline_stage || ''} onValueChange={handleStageChange}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Set tag" />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Conversation thread */}
        {thread.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Conversation</h4>
            <div
              ref={threadScrollRef}
              className="border rounded-lg p-3 bg-muted/20 space-y-3 min-h-[300px] max-h-[50vh] overflow-y-auto"
            >
              {thread.map((msg, i) => {
                if (msg.role === 'system') {
                  return (
                    <div
                      key={i}
                      className="text-xs text-muted-foreground italic text-center py-1"
                    >
                      {msg.content}
                      {msg.timestamp && (
                        <span className="ml-2 text-[10px]">
                          · {formatRelativeTime(msg.timestamp)}
                        </span>
                      )}
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                      msg.role === 'prospect'
                        ? 'bg-muted mr-auto'
                        : 'bg-blue-100 dark:bg-blue-900/30 ml-auto'
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.timestamp && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatRelativeTime(msg.timestamp)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Classifying spinner */}
        {classifying && !lead.draft_response && (
          <div className="flex items-center gap-3 border rounded-lg p-4">
            <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
            <div>
              <p className="text-sm font-medium">Classifying reply...</p>
              <p className="text-xs text-muted-foreground">Analyzing intent and drafting a response</p>
            </div>
          </div>
        )}

        {/* Draft response (email leads only — LinkedIn uses the HeyReach Actions block below) */}
        {showDraft && !isLinkedIn && lead.inbox_status === 'draft_ready' && (
          <div className="space-y-2 border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Draft Response</h4>
              {lead.intent_confidence > 0 && (
                <span className={cn('text-xs font-medium', confidenceColor)}>
                  {Math.round(lead.intent_confidence * 100)}% confident
                </span>
              )}
            </div>
            <Textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onBlur={() => {
                if (draftText !== lead.draft_response) {
                  updateLead.mutate({
                    leadId: lead.id,
                    updates: { draft_response: draftText },
                  });
                }
              }}
              rows={4}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => setShowConfirm(true)}
                disabled={sendReply.isPending}
              >
                {sendReply.isPending ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Sending...</>
                ) : (
                  'Approve & Send'
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                disabled={updateLead.isPending}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* HeyReach LinkedIn actions */}
        {isLinkedIn && (
          <div className="space-y-4 border rounded-lg p-3">
            <h4 className="text-sm font-medium text-muted-foreground">HeyReach Actions</h4>
            <Textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onBlur={() => {
                if (draftText !== lead.draft_response) {
                  updateLead.mutate({
                    leadId: lead.id,
                    updates: { draft_response: draftText },
                  });
                }
              }}
              placeholder="Write a LinkedIn message..."
              rows={3}
              className="text-sm"
            />
            <Button
              onClick={handleSendHeyReachMessage}
              disabled={!draftText.trim() || sendMessage.isPending}
              className="w-full gap-2"
              size="sm"
            >
              {sendMessage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Message
            </Button>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Add to Campaign</p>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={campaignsLoading ? 'Loading campaigns...' : 'Select a campaign'} />
                </SelectTrigger>
                <SelectContent>
                  {heyreachCampaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAddToCampaign}
                disabled={!draftText.trim() || !selectedCampaignId || addToCampaign.isPending}
                variant="outline"
                className="w-full mt-2 gap-2"
                size="sm"
              >
                {addToCampaign.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Add to Campaign
              </Button>
            </div>
          </div>
        )}

        {/* Campaign History — only when the lead is actively in a campaign */}
        {lead.pipeline_stage === 'in_progress' && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Campaign History</h4>
            <div className="border rounded-lg px-3 py-2.5 text-sm">
              {lead.last_campaign_name ? (
                <>
                  <span className="text-muted-foreground">Currently in: </span>
                  <span className="font-medium">{lead.last_campaign_name}</span>
                </>
              ) : (
                <span className="text-muted-foreground italic">
                  In progress — campaign name not recorded.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Notes</h4>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesSave}
            placeholder="Add notes about this lead..."
            rows={3}
            className="text-sm"
          />
        </div>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Response</AlertDialogTitle>
            <AlertDialogDescription>
              {lead.channel === 'linkedin'
                ? 'This will send the message via your Reply.io LinkedIn campaign. Make sure you have a campaign mapped for this intent in Settings.'
                : 'This will send via your Reply.io email campaign.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Reusable intent badge component
export function IntentBadge({ intent }: { intent: string }) {
  if (!intent) return null;
  return (
    <Badge className={cn('text-xs', INTENT_COLORS[intent] || INTENT_COLORS.unknown)}>
      {intent.replace(/_/g, ' ')}
    </Badge>
  );
}

// Reusable channel badge
export function ChannelBadge({ channel }: { channel: string }) {
  if (channel === 'linkedin') {
    return (
      <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:text-blue-400">
        <Linkedin className="h-3 w-3 mr-1" /> LinkedIn
      </Badge>
    );
  }
  if (channel === 'email') {
    return (
      <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:text-green-400">
        <Mail className="h-3 w-3 mr-1" /> Email
      </Badge>
    );
  }
  return null;
}

export { formatRelativeTime };
