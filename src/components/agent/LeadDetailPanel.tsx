import { useState } from 'react';
import { Send, UserPlus, Loader2 } from 'lucide-react';
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
  useSendHeyReachMessage,
  useAddToHeyReachCampaign,
  useHeyReachCampaigns,
} from '@/hooks/useHeyReach';

export interface AgentLead {
  id: string;
  full_name: string | null;
  email: string | null;
  last_reply_text: string | null;
  inbox_status: string;
  channel: string;
  linkedin_url?: string | null;
  heyreach_conversation_id?: string | null;
  heyreach_account_id?: number | null;
  draft_approved?: boolean;
  created_at: string;
  updated_at: string;
}

interface LeadDetailPanelProps {
  lead: AgentLead;
  onApproveAndSend?: (leadId: string) => void;
}

export function LeadDetailPanel({ lead, onApproveAndSend }: LeadDetailPanelProps) {
  const [draftText, setDraftText] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');

  const sendMessage = useSendHeyReachMessage();
  const addToCampaign = useAddToHeyReachCampaign();
  const { data: heyreachCampaigns = [], isLoading: campaignsLoading } = useHeyReachCampaigns();

  const isLinkedIn = lead.channel === 'linkedin';

  const handleSendMessage = () => {
    if (!draftText.trim()) return;
    sendMessage.mutate(
      { lead_id: lead.id, message: draftText.trim() },
      { onSuccess: () => setDraftText('') }
    );
  };

  const handleAddToCampaign = () => {
    if (!draftText.trim() || !selectedCampaignId) return;
    addToCampaign.mutate(
      { lead_id: lead.id, campaign_id: selectedCampaignId, message: draftText.trim() },
      {
        onSuccess: () => {
          setDraftText('');
          setSelectedCampaignId('');
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Lead info */}
      <div>
        <h3 className="text-lg font-semibold text-foreground">
          {lead.full_name || 'Unknown'}
        </h3>
        {lead.email && (
          <p className="text-sm text-muted-foreground">{lead.email}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
            {lead.channel}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
            {lead.inbox_status}
          </span>
        </div>
      </div>

      {/* Last reply */}
      {lead.last_reply_text && (
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Last Reply</p>
          <div className="p-3 rounded-lg bg-muted/50 text-sm text-foreground whitespace-pre-wrap">
            {lead.last_reply_text}
          </div>
        </div>
      )}

      {/* Draft message */}
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">Message</p>
        <Textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder={isLinkedIn ? 'Write a LinkedIn message...' : 'Write a reply...'}
          rows={4}
        />
      </div>

      {/* Actions */}
      {isLinkedIn ? (
        <div className="space-y-4">
          {/* Send Message */}
          <Button
            onClick={handleSendMessage}
            disabled={!draftText.trim() || sendMessage.isPending}
            className="w-full gap-2"
          >
            {sendMessage.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send Message
          </Button>

          {/* Add to Campaign */}
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-muted-foreground mb-2">Add to Campaign</p>
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger>
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
      ) : (
        <Button
          onClick={() => onApproveAndSend?.(lead.id)}
          disabled={!draftText.trim()}
          className="w-full"
        >
          Approve & Send
        </Button>
      )}
    </div>
  );
}
