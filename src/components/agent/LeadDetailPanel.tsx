import { useState, useEffect, useRef } from 'react';
import { Send, UserPlus, Loader2, X, Linkedin, Mail, Check, Sparkles, Plus, Trash2 } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useUpdateAgentLead, useApproveDraft, useLiveLead, type AgentLead } from '@/hooks/useAgentInbox';
import { useLearnings, useAddLearning, useDeleteLearning } from '@/hooks/useLearnings';
import {
  useSendHeyReachMessage,
  useAddToHeyReachCampaign,
  useHeyReachCampaigns,
} from '@/hooks/useHeyReach';
import {
  useAddToSmartleadCampaign,
  useSmartleadCampaigns,
} from '@/hooks/useSmartlead';
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

// Humanized labels for prospect_read (Phase 3.1a) pills.
const SENIORITY_LABELS: Record<string, string> = {
  exec: 'Executive',
  mid: 'Mid-level',
  ic: 'IC',
};
const BUYING_ROLE_LABELS: Record<string, string> = {
  decision_maker: 'Decision-maker',
  influencer: 'Influencer',
  end_user: 'End user',
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

// Smartlead email send. Mirrors useSendAgentReply's shape so the email-send
// dispatch site can pick a hook by `smartlead_lead_id` presence and treat
// both as drop-in replacements (apart from per-platform body keys).
function useSendSmartleadEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, message }: { leadId: string; message: string }) => {
      const { data, error } = await supabase.functions.invoke('send-smartlead-email', {
        body: { leadId, message },
      });
      if (error) throw new Error(error.message || 'Failed to send Smartlead email');
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
  const sendSmartleadEmail = useSendSmartleadEmail();
  const { toast } = useToast();
  const [draftText, setDraftText] = useState(lead.draft_response || '');
  const [notes, setNotes] = useState(lead.notes || '');
  const { data: leadLearnings = [] } = useLearnings({ leadId: lead.id });
  const addLearning = useAddLearning();
  const deleteLearning = useDeleteLearning();
  const [newLearning, setNewLearning] = useState('');

  const handleAddLearning = () => {
    const text = newLearning.trim();
    if (!text) return;
    addLearning.mutate(
      { text, leadId: lead.id, leadName: lead.full_name, leadCompany: lead.company },
      {
        onSuccess: () => {
          setNewLearning('');
          toast({ title: 'Lesson added' });
        },
        onError: (err: any) => {
          toast({ title: 'Could not add lesson', description: err?.message || 'Try again.', variant: 'destructive' });
        },
      },
    );
  };

  // HeyReach actions (for LinkedIn channel)
  const sendMessage = useSendHeyReachMessage();
  const addToCampaign = useAddToHeyReachCampaign();
  const { data: heyreachCampaigns = [], isLoading: campaignsLoading } = useHeyReachCampaigns();
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  // Smartlead Add to Campaign (for Email channel with smartlead_lead_id).
  // Filtering by integration platform (not synced_campaigns.source) mirrors
  // useHeyReachCampaigns and prevents cross-channel adds — a Smartlead
  // campaign cannot appear in the LinkedIn dropdown and vice versa.
  const addToSmartleadCampaign = useAddToSmartleadCampaign();
  const { data: smartleadCampaigns = [], isLoading: smartleadCampaignsLoading } =
    useSmartleadCampaigns();
  const [selectedSmartleadCampaignId, setSelectedSmartleadCampaignId] = useState('');

  // Sync draft text when live data brings in a new draft
  const [lastSyncedDraft, setLastSyncedDraft] = useState(lead.draft_response || '');
  if (lead.draft_response && lead.draft_response !== lastSyncedDraft) {
    setDraftText(lead.draft_response);
    setLastSyncedDraft(lead.draft_response);
  }
  const [showConfirm, setShowConfirm] = useState(false);

  const isLinkedIn = lead.channel === 'linkedin';
  // Email-send dispatch: smartlead_lead_id presence is the reliable signal
  // for "this lead came from Smartlead" — `channel === 'email'` alone isn't
  // enough because Reply.io's reply-webhook also writes channel='email'.
  const isSmartleadEmail = lead.channel === 'email' && !!lead.smartlead_lead_id;
  const isReplyIoEmail = lead.channel === 'email' && !lead.smartlead_lead_id;
  const hasEmailSendHandler = isSmartleadEmail || isReplyIoEmail;

  // A LinkedIn lead with no HeyReach conversation id is a cold inbound —
  // HeyReach's SendMessage requires a tracked conversation, so the direct
  // Send Message button has nothing to send to. Add to Campaign still
  // works (it creates the conversation by enrolling the lead).
  const isColdInboundLinkedIn = isLinkedIn && !(lead as any).heyreach_conversation_id;

  const handleStageChange = (newStage: string) => {
    if (newStage === lead.pipeline_stage) return;
    updateLead.mutate(
      {
        leadId: lead.id,
        // Tag change always moves the lead to Total Inbox (inbox_status='dismissed').
        updates: { pipeline_stage: newStage, inbox_status: 'dismissed' },
        logStageChange: {
          oldStage: lead.pipeline_stage,
          newStage,
          leadName: lead.full_name,
          leadCompany: lead.company,
        },
      },
      {
        onError: (err: any) => {
          toast({
            title: "Couldn't update tag",
            description: err?.message || 'The change was rejected by the database.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleApprove = () => {
    setShowConfirm(false);

    if (isSmartleadEmail) {
      sendSmartleadEmail.mutate(
        { leadId: lead.id, message: draftText },
        {
          onSuccess: () => {
            toast({ title: 'Reply sent via Smartlead ✓' });
          },
          onError: (err: any) => {
            toast({
              title: 'Error',
              description: err?.message || 'Failed to send Smartlead email',
              variant: 'destructive',
            });
          },
        }
      );
      return;
    }

    if (isReplyIoEmail) {
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
      return;
    }

    // Belt-and-braces: the Approve & Send button is disabled when no handler
    // is available, so this branch shouldn't be reachable. Surface as a toast
    // rather than silently failing if the disabled gate is ever bypassed.
    toast({
      title: 'Error',
      description: `No send handler configured for channel "${lead.channel ?? 'unknown'}"`,
      variant: 'destructive',
    });
  };

  const handleDismiss = () => {
    updateLead.mutate({
      leadId: lead.id,
      updates: { inbox_status: 'dismissed' },
    });
  };

  // Notes auto-save: debounced 1.2s after the last keystroke, plus an
  // immediate save on blur. Three states surface to the UI:
  //   idle    — no unsaved change
  //   saving  — write in flight
  //   saved   — last write succeeded (auto-clears after 2s)
  // Errors raise a destructive toast — silent failures here are how the
  // user lost notes pre-fix.
  type NotesSaveState = 'idle' | 'saving' | 'saved';
  const [notesSaveState, setNotesSaveState] = useState<NotesSaveState>('idle');
  const notesDebounceRef = useRef<number | null>(null);
  const notesSavedTimerRef = useRef<number | null>(null);
  const lastSavedNotesRef = useRef(lead.notes ?? '');

  const persistNotes = (value: string) => {
    if (value === lastSavedNotesRef.current) return;
    setNotesSaveState('saving');
    updateLead.mutate(
      { leadId: lead.id, updates: { notes: value } },
      {
        onSuccess: () => {
          lastSavedNotesRef.current = value;
          setNotesSaveState('saved');
          if (notesSavedTimerRef.current) window.clearTimeout(notesSavedTimerRef.current);
          notesSavedTimerRef.current = window.setTimeout(
            () => setNotesSaveState('idle'),
            2000,
          );
        },
        onError: (err: any) => {
          setNotesSaveState('idle');
          toast({
            title: "Couldn't save notes",
            description: err?.message || 'The change was rejected by the database.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);
    if (notesDebounceRef.current) window.clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = window.setTimeout(() => persistNotes(value), 1200);
  };

  const handleNotesBlur = () => {
    if (notesDebounceRef.current) {
      window.clearTimeout(notesDebounceRef.current);
      notesDebounceRef.current = null;
    }
    persistNotes(notes);
  };

  // Reset the saved-notes baseline when switching leads so the indicator
  // doesn't carry over from another row.
  useEffect(() => {
    lastSavedNotesRef.current = lead.notes ?? '';
    setNotesSaveState('idle');
    return () => {
      if (notesDebounceRef.current) window.clearTimeout(notesDebounceRef.current);
      if (notesSavedTimerRef.current) window.clearTimeout(notesSavedTimerRef.current);
    };
  }, [lead.id]);

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

  // Smartlead add to campaign — uses the Draft Response textarea content as
  // the personalized message (passed through to Smartlead's
  // {{first_touch_message}} custom field by the edge function).
  const handleAddToSmartleadCampaign = () => {
    const campaign = smartleadCampaigns.find((c) => c.id === selectedSmartleadCampaignId);
    if (!draftText.trim() || !campaign?.external_campaign_id) return;
    addToSmartleadCampaign.mutate(
      {
        lead_id: lead.id,
        campaign_id: campaign.external_campaign_id,
        message: draftText.trim(),
        campaign_name: campaign.name,
      },
      {
        onSuccess: () => {
          setSelectedSmartleadCampaignId('');
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

  // Agent's Read — derived from prospect_read (Phase 3.1a). Only surfaced
  // when at least one signal is meaningful (not null / not all 'unknown').
  const pr = lead.prospect_read ?? null;
  const prSeniority = pr?.seniority && pr.seniority !== 'unknown'
    ? (SENIORITY_LABELS[pr.seniority] ?? pr.seniority)
    : null;
  const prRole = pr?.buying_role && pr.buying_role !== 'unknown'
    ? (BUYING_ROLE_LABELS[pr.buying_role] ?? pr.buying_role)
    : null;
  const prPersona = pr?.matched_persona || null;
  const prAngle = pr?.suggested_angle || null;
  const showAgentRead = !!(prSeniority || prRole || prPersona || prAngle);

  return (
    <div className="flex flex-col h-full">
      {/* Header. The status dropdown renders unconditionally — it must be
          visible for every lead regardless of intent, lead_category,
          inbox_status, or channel. The pr-12 reserves space for the
          absolute close-X that <Sheet> renders at right-4 in Pipeline view
          (without it, the parent's auto-X overlays our right cluster and
          the dropdown trigger looks missing). */}
      <div className="pl-4 pr-12 py-4 border-b flex items-start justify-between gap-3">
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

        {/* Agent's Read — compact prospect_read summary, above the draft.
            Renders for both channels; hidden entirely when no signal. */}
        {showAgentRead && (
          <div className="border rounded-lg px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Agent's Read
            </div>
            {(prSeniority || prRole) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {prSeniority && (
                  <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                    {prSeniority}
                  </Badge>
                )}
                {prRole && (
                  <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                    {prRole}
                  </Badge>
                )}
              </div>
            )}
            {prPersona && (
              <div className="text-xs">
                <span className="text-muted-foreground">Persona: </span>
                <span className="font-medium">{prPersona}</span>
              </div>
            )}
            {prAngle && (
              <div className="text-sm">
                <span className="text-xs text-muted-foreground">Angle: </span>
                {prAngle}
              </div>
            )}
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
                disabled={
                  sendReply.isPending ||
                  sendSmartleadEmail.isPending ||
                  !hasEmailSendHandler
                }
              >
                {sendReply.isPending || sendSmartleadEmail.isPending ? (
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

        {/* LinkedIn actions (powered by HeyReach under the hood) */}
        {isLinkedIn && (
          <div className="space-y-4 border rounded-lg p-3">
            <h4 className="text-sm font-medium text-muted-foreground">LinkedIn Actions</h4>
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
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <Button
                      onClick={handleSendHeyReachMessage}
                      disabled={
                        !draftText.trim() ||
                        sendMessage.isPending ||
                        isColdInboundLinkedIn
                      }
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
                  </span>
                </TooltipTrigger>
                {isColdInboundLinkedIn && (
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    This prospect isn't in a HeyReach campaign yet — direct
                    sends require a tracked conversation. Reply on LinkedIn,
                    or use Add to Campaign below.
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>

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

        {/* Email actions (Smartlead under the hood). Reply.io email leads
            (no smartlead_lead_id) render nothing here; those are reserved
            for a future Reply.io campaign-add expansion. */}
        {isSmartleadEmail && (
          <div className="space-y-2 border rounded-lg p-3">
            <h4 className="text-sm font-medium text-muted-foreground">Email Actions</h4>
            <p className="text-xs font-medium text-muted-foreground">Add to Campaign</p>
            <Select
              value={selectedSmartleadCampaignId}
              onValueChange={setSelectedSmartleadCampaignId}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue
                  placeholder={smartleadCampaignsLoading ? 'Loading campaigns...' : 'Select a campaign'}
                />
              </SelectTrigger>
              <SelectContent>
                {smartleadCampaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleAddToSmartleadCampaign}
              disabled={
                !draftText.trim() ||
                !selectedSmartleadCampaignId ||
                addToSmartleadCampaign.isPending
              }
              variant="outline"
              className="w-full mt-2 gap-2"
              size="sm"
            >
              {addToSmartleadCampaign.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Add to Campaign
            </Button>
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
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-muted-foreground">Notes</h4>
            {notesSaveState === 'saving' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </span>
            )}
            {notesSaveState === 'saved' && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </div>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="Add notes about this lead..."
            rows={3}
            className="text-sm"
          />
        </div>

        {/* Teach the agent — lead-attributed learnings (immediate add/delete) */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Teach the agent</h4>
          <Textarea
            value={newLearning}
            onChange={(e) => setNewLearning(e.target.value)}
            placeholder="Teach the agent from this conversation — applies to all future drafts."
            rows={2}
            className="text-sm"
          />
          <Button
            onClick={handleAddLearning}
            disabled={!newLearning.trim() || addLearning.isPending}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            {addLearning.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add
          </Button>
          {leadLearnings.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {leadLearnings.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-2 border rounded-md px-2.5 py-1.5">
                  <p className="text-xs flex-1">{l.metadata?.learning_text ?? l.description}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteLearning.mutate({ id: l.id })}
                    disabled={deleteLearning.isPending}
                    aria-label="Delete lesson"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Response</AlertDialogTitle>
            <AlertDialogDescription>
              {isSmartleadEmail
                ? 'This will send via Smartlead email.'
                : lead.channel === 'linkedin'
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
