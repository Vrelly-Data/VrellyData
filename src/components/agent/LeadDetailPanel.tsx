import { useState, useEffect, useRef } from 'react';
import { Send, UserPlus, Loader2, X, Linkedin, Mail, Check, Sparkles, Plus, Trash2 } from 'lucide-react';
import { LinkedInProfileLink } from '@/components/LinkedInProfileLink';
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
import { useAgentConfig } from '@/hooks/useAgent';
import { useAgentDocuments } from '@/hooks/useAgentDocuments';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadTagsSection } from './LeadTagsSection';

export type { AgentLead };

// Lead disposition tags. Selecting any of these also flips inbox_status to
// 'dismissed', moving the lead from Pending Approval to Total Inbox.
// Order mirrors the pipeline columns: negative dispositions → active → won.
// The ONE deal-stage taxonomy — 8 stages, funnel order. Tags == stages: this
// dropdown and the PipelineBoard columns are the same 8 in the same order.
// Kept in sync with DEAL_STAGES in PipelineBoard.
export const PIPELINE_STAGES = [
  { value: 'replied', label: 'Replied' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'sent_proposal', label: 'Sent Proposal' },
  { value: 'call_scheduled', label: 'Call Scheduled' },
  { value: 'no_show', label: 'No Show' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
] as const;

export type PipelineStageValue = typeof PIPELINE_STAGES[number]['value'];

// Stage → display label. The 8 canonical stages, plus a graceful fallback for
// the system compliance flag opted_out (displayed as Closed Lost — an
// opted-out lead's pipeline_stage is closed_lost; opted_out is not a stage).
const ALL_STAGE_LABELS: Record<string, string> = {
  replied: 'Replied',
  in_progress: 'In Progress',
  sent_proposal: 'Sent Proposal',
  call_scheduled: 'Call Scheduled',
  no_show: 'No Show',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  // Legacy/compat: any lingering meeting_booked → Call Scheduled; opted_out is
  // the compliance flag (deal stage closed_lost).
  meeting_booked: 'Call Scheduled',
  opted_out: 'Closed Lost',
};

// Tags == stages now: the operator's chosen tag IS the pipeline_stage (all 8
// are valid values), so this is the identity mapping. Kept as a function so
// callers don't need to change.
export const pipelineStageForTag = (tag: string): string => tag;

export function getPipelineStageLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALL_STAGE_LABELS[value] ?? null;
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
    mutationFn: async ({ leadId, draftResponse, intent, campaignId, cc }: { leadId: string; draftResponse: string; intent: string; campaignId?: string; cc?: string }) => {
      const { data, error } = await supabase.functions.invoke('send-agent-reply', {
        // campaignId is forwarded only when set (operator picked a campaign);
        // absent → send-agent-reply keeps its intent-routing behavior.
        // cc is forwarded only when set (direct email Send Reply); the
        // backend applies it to the email channel only and ignores it otherwise.
        body: { leadId, draftResponse, intent, ...(campaignId ? { campaignId } : {}), ...(cc ? { cc } : {}) },
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

// Reply.io campaigns (sequences) for the operator-picked "Add to Campaign"
// dropdown in the Reply.io Actions block. Mirrors useHeyReachCampaigns'
// integration→synced_campaigns filter pattern, scoped to platform 'reply.io'.
// Defined in-file alongside the other Reply.io send hooks.
interface ReplyCampaign {
  id: string;
  name: string;
  status: string | null;
  external_campaign_id: string;
}

function useReplyCampaigns() {
  return useQuery({
    queryKey: ['reply-campaigns'],
    queryFn: async (): Promise<ReplyCampaign[]> => {
      const { data: integrations, error: intError } = await supabase
        .from('outbound_integrations')
        .select('id')
        .eq('platform', 'reply.io');

      if (intError) throw intError;
      if (!integrations?.length) return [];

      const integrationIds = integrations.map((i) => i.id);

      const { data, error } = await supabase
        .from('synced_campaigns')
        .select('id, name, status, external_campaign_id')
        .in('integration_id', integrationIds)
        .order('name', { ascending: true });

      if (error) throw error;
      return (data || []) as ReplyCampaign[];
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
  const { data: agentConfig } = useAgentConfig();
  const { data: agentDocuments = [] } = useAgentDocuments();
  const [draftText, setDraftText] = useState(lead.draft_response || '');
  // Ref to the (single) mounted draft textarea. Read at send time so we always
  // send exactly what's in the box — authoritative even if draftText state and
  // the DOM ever diverge. Only one draft textarea renders at a time, so the
  // shared ref points at whichever is active.
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const getLiveDraft = () => (draftRef.current?.value ?? draftText);
  const [ccEmail, setCcEmail] = useState('');
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

  // Reply.io campaigns + operator-picked selection — parallel to heyreach above.
  const { data: replyCampaigns = [], isLoading: replyCampaignsLoading } = useReplyCampaigns();
  const [selectedReplyCampaignId, setSelectedReplyCampaignId] = useState('');

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

  // Pre-fill the per-send CC from the client's configured default whenever the
  // lead changes (or the config finishes loading). Only the email channel uses
  // it (the field is hidden for LinkedIn); operator edits persist until the
  // lead or the configured default changes.
  useEffect(() => {
    setCcEmail(agentConfig?.default_cc ?? '');
  }, [lead.id, agentConfig?.default_cc]);

  // Channel/source discriminators (positive identifier — replaces the
  // earlier inference from smartlead_lead_id / heyreach_conversation_id
  // presence). agent_leads.source is set at every creation site (see
  // commit 747c5d3 + the 20260620120000 migration backfill).
  //
  // Degradation when lead.source is null/undefined (shouldn't happen
  // post-migration; defensive for the brief migration-apply→deploy gap
  // OR future writes via paths not covered by the 6 updated functions):
  // ALL four discriminators evaluate false → hasSendHandler is false →
  // Approve&Send button disabled, handleApprove falls into the
  // "No send handler configured" toast. Safe-fail: operator sees a
  // clear error, never a wrong-channel send.
  const isLinkedIn = lead.channel === 'linkedin';
  const isHeyReachLinkedIn = isLinkedIn && lead.source === 'heyreach';
  const isReplyIoLinkedIn = isLinkedIn && lead.source === 'reply_io';
  const isSmartleadEmail = lead.channel === 'email' && lead.source === 'smartlead';
  const isReplyIoEmail = lead.channel === 'email' && lead.source === 'reply_io';
  const hasSendHandler = isSmartleadEmail || isReplyIoEmail || isReplyIoLinkedIn;

  // A HeyReach LinkedIn lead with no conversation id is a cold inbound —
  // HeyReach's SendMessage requires a tracked conversation, so the direct
  // Send Message button has nothing to send to. Add to Campaign still
  // works (it creates the conversation by enrolling the lead). Scoped to
  // HeyReach only — Reply.io LinkedIn never falls into this block.
  const isColdInboundLinkedIn = isHeyReachLinkedIn && !(lead as any).heyreach_conversation_id;

  const handleStageChange = (newTag: string) => {
    const currentTag = lead.disposition_tag ?? lead.pipeline_stage;
    if (newTag === currentTag) return;
    updateLead.mutate(
      {
        leadId: lead.id,
        // The chosen tag (label source + opted_out flag) goes in disposition_tag;
        // pipeline_stage gets the CHECK-valid mapped value (not_relevant->bad_lead,
        // opted_out->dead). Any tag apply moves the lead to Total Inbox.
        updates: {
          disposition_tag: newTag,
          pipeline_stage: pipelineStageForTag(newTag),
          inbox_status: 'dismissed',
        },
        logStageChange: {
          oldStage: currentTag,
          newStage: newTag,
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

    // Read the live textarea value and block an empty send here with a clear
    // message instead of letting the backend 400 on a blank draftResponse.
    const draft = getLiveDraft().trim();
    if (!draft) {
      toast({
        title: 'Draft is empty',
        description: 'Write a reply before sending.',
        variant: 'destructive',
      });
      return;
    }

    if (isSmartleadEmail) {
      sendSmartleadEmail.mutate(
        { leadId: lead.id, message: draft },
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

    if (isReplyIoEmail || isReplyIoLinkedIn) {
      sendReply.mutate(
        {
          leadId: lead.id,
          draftResponse: draft,
          intent: lead.intent,
          // CC only applies to the email channel (Reply.io ignores cc for
          // LinkedIn). Forwarded only when this is an email lead with a CC set.
          ...(isReplyIoEmail && ccEmail.trim() ? { cc: ccEmail.trim() } : {}),
        },
        {
          onSuccess: (result: any) => {
            // Opted-out is a handled business state (backend returns 200 with
            // code 'contact_opted_out', not an error) — show a friendly,
            // non-destructive toast instead of a success/error one.
            if (result?.code === 'contact_opted_out') {
              toast({
                title: 'Contact opted out',
                description: result.message
                  || "This contact has opted out and can't be messaged — reply not sent.",
              });
              return;
            }
            toast({
              title: isReplyIoLinkedIn
                ? 'Reply sent via Reply.io LinkedIn ✓'
                : 'Reply sent via Reply.io ✓',
            });
          },
          onError: (err: any) => {
            const msg = err?.message || 'Failed to send reply';
            // Channel-mismatch is the new safety-check error from
            // send-agent-reply (commit ee07c2a). Surface it with a
            // distinct toast so the operator knows to fix Settings,
            // not retry.
            if (msg.includes('Channel mismatch')) {
              toast({
                title: 'Channel mismatch',
                description: msg,
                variant: 'destructive',
              });
            } else if (msg.includes('No campaign mapped')) {
              toast({
                title: 'Campaign not configured',
                description: `Set up Campaign Rules for the ${
                  isReplyIoLinkedIn ? 'LinkedIn' : 'email'
                } channel in Agent Settings.`,
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

  // Reply.io add to campaign — operator picks the sequence explicitly. Routes
  // through sendReply with an explicit campaignId (the sequence's
  // external_campaign_id), which overrides intent routing in send-agent-reply.
  // Mirrors handleAddToCampaign structurally but NEVER touches the HeyReach
  // send hooks (no cross-platform contamination for Reply.io leads).
  const handleAddToReplyCampaign = () => {
    const campaign = replyCampaigns.find((c) => c.id === selectedReplyCampaignId);
    const draft = getLiveDraft().trim();
    if (!draft) {
      toast({
        title: 'Draft is empty',
        description: 'Write a reply before adding to a campaign.',
        variant: 'destructive',
      });
      return;
    }
    if (!campaign?.external_campaign_id) return;
    sendReply.mutate(
      {
        leadId: lead.id,
        draftResponse: draft,
        intent: lead.intent,
        campaignId: campaign.external_campaign_id, // operator-picked — overrides intent routing
      },
      {
        onSuccess: () => {
          setSelectedReplyCampaignId('');
          toast({
            title: isReplyIoLinkedIn
              ? 'Added to Reply.io LinkedIn sequence ✓'
              : 'Added to Reply.io sequence ✓',
          });
        },
        onError: (err: any) => {
          const msg = err?.message || 'Failed to add to campaign';
          if (msg.includes('Channel mismatch')) {
            toast({ title: 'Channel mismatch', description: msg, variant: 'destructive' });
          } else {
            toast({ title: 'Error', description: msg, variant: 'destructive' });
          }
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
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-lg truncate">{lead.full_name}</h3>
            {/* Profile link sits with the name so it is present regardless of
                which channel the reply arrived on. Absent when we have no URL. */}
            <LinkedInProfileLink url={lead.linkedin_url} size="md" />
          </div>
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
          <Select value={(lead.disposition_tag ?? lead.pipeline_stage) || ''} onValueChange={handleStageChange}>
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

        {/* Draft response + Approve&Send. Renders for ANY lead that has a
            working send handler — Smartlead email, Reply.io email, and
            Reply.io LinkedIn. Only HeyReach LinkedIn leads (which use the
            separate HeyReach Actions block below) are excluded. */}
        {showDraft && !isHeyReachLinkedIn && !isReplyIoEmail && !isReplyIoLinkedIn && lead.inbox_status === 'draft_ready' && (
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
              ref={draftRef}
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
                  !hasSendHandler
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

        {/* LinkedIn Actions block — HeyReach-only by construction. Reply.io
            LinkedIn leads (source='reply_io') flow through the Draft block
            above; this block must NEVER catch a Reply.io lead because the
            HeyReach Send Message / Add to Campaign actions would talk to
            the wrong platform (cross-contamination). */}
        {isHeyReachLinkedIn && (
          <div className="space-y-4 border rounded-lg p-3">
            <h4 className="text-sm font-medium text-muted-foreground">LinkedIn Actions</h4>
            <Textarea
              ref={draftRef}
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

        {/* Reply.io Actions — structural mirror of the HeyReach LinkedIn
            Actions block above, but routed through sendReply (the Reply.io
            send path) and NEVER the HeyReach hooks. Applies to BOTH Reply.io
            channels (email + LinkedIn) since Reply.io now handles both; the
            sequence's first step picks the actual outbound channel. This is
            the SINGLE actions block for a Reply.io lead (the Draft + Approve
            & Send block above is gated off for Reply.io). */}
        {(isReplyIoEmail || isReplyIoLinkedIn) && (
          <div className="space-y-4 border rounded-lg p-3">
            <h4 className="text-sm font-medium text-muted-foreground">Reply.io Actions</h4>
            <Textarea
              ref={draftRef}
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
              placeholder={isReplyIoLinkedIn ? 'Write a LinkedIn message...' : 'Write an email reply...'}
              rows={3}
              className="text-sm"
            />
            {/* CC — email channel only (Reply.io ignores cc for LinkedIn).
                Pre-filled from the client's configured Default CC and editable
                per send. Applies to the direct Send Reply path only. */}
            {isReplyIoEmail && (
              <div className="space-y-1">
                <Label htmlFor="reply_cc" className="text-xs text-muted-foreground">CC</Label>
                <Input
                  id="reply_cc"
                  type="email"
                  value={ccEmail}
                  onChange={(e) => setCcEmail(e.target.value)}
                  placeholder="cc@example.com (optional)"
                  className="h-8 text-sm"
                />
              </div>
            )}
            {/* Attach document — inserts a client document's hosted link into the
                reply text (part of draftResponse). No send-path change: the link
                is just text in the message. Only shown when the client has
                documents. */}
            {agentDocuments.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Attach document</Label>
                <Select
                  value=""
                  onValueChange={(id) => {
                    const doc = agentDocuments.find((d) => d.id === id);
                    if (!doc?.public_url) return;
                    setDraftText((prev) => {
                      const base = prev.replace(/\s+$/, '');
                      const link = `[${doc.title}](${doc.public_url})`;
                      return base ? `${base}\n\n${link}` : link;
                    });
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Insert a document link…" />
                  </SelectTrigger>
                  <SelectContent>
                    {agentDocuments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Direct send — reuses the existing Approve & Send confirm flow
                (setShowConfirm → handleApprove → sendReply with intent
                routing, no campaignId). */}
            <Button
              onClick={() => setShowConfirm(true)}
              disabled={!draftText.trim() || sendReply.isPending}
              className="w-full gap-2"
              size="sm"
            >
              {sendReply.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Reply
            </Button>

            <div className="border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Add to Campaign</p>
              <Select value={selectedReplyCampaignId} onValueChange={setSelectedReplyCampaignId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={replyCampaignsLoading ? 'Loading campaigns...' : 'Select a campaign'} />
                </SelectTrigger>
                <SelectContent>
                  {replyCampaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAddToReplyCampaign}
                disabled={!draftText.trim() || !selectedReplyCampaignId || sendReply.isPending}
                variant="outline"
                className="w-full mt-2 gap-2"
                size="sm"
              >
                {sendReply.isPending ? (
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

        {/* Tags (Feature 1) — colored chips + add/create-inline. */}
        <LeadTagsSection leadId={lead.id} />

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
                : isReplyIoLinkedIn
                  ? 'This will send via your Reply.io LinkedIn sequence configured for this intent (linkedin column in Campaign Rules).'
                  : 'This will send via your Reply.io email sequence configured for this intent (email column in Campaign Rules).'}
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
  if (channel === 'multichannel') {
    // Reply.io sequences with both linkedIn and email steps. Single badge
    // with both icons + the combined label, neutral border so it doesn't
    // visually claim to be "primarily" either channel.
    return (
      <Badge variant="outline" className="text-xs border-purple-300 text-purple-700 dark:text-purple-400">
        <Linkedin className="h-3 w-3 mr-1" />
        <Mail className="h-3 w-3 mr-1" /> LinkedIn + Email
      </Badge>
    );
  }
  return null;
}

export { formatRelativeTime };
