import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentConfig } from '@/hooks/useAgent';
import { useLearnings, useAddLearning, useDeleteLearning } from '@/hooks/useLearnings';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Save, HelpCircle, Plus, Trash2 } from 'lucide-react';

// Inline help affordance next to a card title. Mirrors the Tooltip pattern
// used in LeadDetailPanel.
function FieldHelp({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground transition-colors">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Soft URL check — blank is acceptable; only flag clearly-non-URL input.
function calendarLinkLooksValid(v: string): boolean {
  if (!v.trim()) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function SalesPlaybook() {
  const { data: config, isLoading } = useAgentConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    calendar_link: '',
    pricing_summary: '',
    case_studies: '',
    disqualification_criteria: '',
    objection_handling_notes: '',
  });

  const { data: globalLearnings = [] } = useLearnings({ global: true });
  const addLearning = useAddLearning();
  const deleteLearning = useDeleteLearning();
  const [newLearning, setNewLearning] = useState('');

  useEffect(() => {
    if (config) {
      setFormData({
        calendar_link: config.calendar_link ?? '',
        pricing_summary: config.pricing_summary ?? '',
        case_studies: config.case_studies ?? '',
        disqualification_criteria: config.disqualification_criteria ?? '',
        objection_handling_notes: config.objection_handling_notes ?? '',
      });
    }
  }, [config]);

  const update = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    // Direct UPDATE (not upsert) keyed on user_id. agent_configs has NOT NULL
    // columns (company_name, sender_name, offer_description); a partial upsert
    // fails PostgREST's up-front INSERT-path validation before reaching the
    // ON CONFLICT branch. UPDATE only touches provided columns, sidestepping
    // that. Safe because SalesPlaybook is only reachable post-onboarding, so
    // the agent_configs row is guaranteed to exist.
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase as any)
        .from('agent_configs')
        .update({
          calendar_link: formData.calendar_link || null,
          pricing_summary: formData.pricing_summary || null,
          case_studies: formData.case_studies || null,
          disqualification_criteria: formData.disqualification_criteria || null,
          objection_handling_notes: formData.objection_handling_notes || null,
        })
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['agent-config'] });
      toast({ title: 'Playbook saved', description: 'Your sales playbook has been updated.' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save your playbook.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddLearning = () => {
    const text = newLearning.trim();
    if (!text) return;
    addLearning.mutate(
      { text, leadId: null },
      {
        onSuccess: () => {
          setNewLearning('');
          toast({ title: 'Lesson added', description: 'The agent will apply this when drafting replies.' });
        },
        onError: (err: any) => {
          toast({ title: 'Could not add lesson', description: err?.message || 'Try again.', variant: 'destructive' });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const calendarValid = calendarLinkLooksValid(formData.calendar_link);

  return (
    <div className="p-6 max-w-2xl space-y-8 pb-24">
      <div>
        <h2 className="text-2xl font-semibold">Sales Playbook</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Context your agent uses to write better replies — pricing, proof, fit, and objection handling.
        </p>
      </div>

      {/* 1 — Calendar Booking Link */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>Calendar Booking Link</CardTitle>
            <FieldHelp text="The booking URL the agent uses when offering to schedule a call. Leave blank if you don't use scheduled calendar bookings." />
          </div>
        </CardHeader>
        <CardContent>
          <Input
            type="url"
            value={formData.calendar_link}
            onChange={(e) => update('calendar_link', e.target.value)}
            placeholder="https://calendly.com/your-name/30min"
          />
          {formData.calendar_link.trim() && !calendarValid && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1.5">
              This doesn't look like a URL — double-check it starts with https://
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2 — Pricing */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>How to Talk About Pricing</CardTitle>
            <FieldHelp text="What the agent should say when prospects ask 'how much does this cost?' Most sellers prefer to push toward a call rather than quote in writing. Include specific language you want the agent to use." />
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            value={formData.pricing_summary}
            onChange={(e) => update('pricing_summary', e.target.value)}
            placeholder="Pricing depends on your use case and volume. Most setups fall in the $X–X range. Don't quote firm numbers — book a call so I can walk through the right config."
          />
        </CardContent>
      </Card>

      {/* 3 — Case Studies */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>Case Studies &amp; Wins</CardTitle>
            <FieldHelp text="Real results the agent can reference for credibility. Use specific metrics and outcomes when possible. The agent will cite these naturally when a prospect needs proof." />
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={formData.case_studies}
            onChange={(e) => update('case_studies', e.target.value)}
            placeholder={`Reference these wins when credibility matters:
- Client A: 100+ meetings/month from outbound
- Client B: $100K+ contracts in under 1 month
- Client C: 10 meetings in week 1`}
          />
        </CardContent>
      </Card>

      {/* 4 — Disqualification */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>When to Politely Disqualify</CardTitle>
            <FieldHelp text="When the agent should politely back off rather than push the sale. Helps the agent avoid wasting time on prospects who aren't a fit, and prevents pushy responses that hurt the brand." />
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={formData.disqualification_criteria}
            onChange={(e) => update('disqualification_criteria', e.target.value)}
            placeholder={`Politely decline if:
- Prospect is under 3 people / under $30K MRR — refer to free resources
- Looking for a $50/mo tool — not the right fit
- Outside B2B SaaS / professional services / agencies — politely decline`}
          />
        </CardContent>
      </Card>

      {/* 5 — Objection Handling */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>Common Objections &amp; Your Responses</CardTitle>
            <FieldHelp text="Specific objections you hear and the responses that work for you. The agent will follow your patterns when handling pushback. More examples = better drafts." />
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={8}
            value={formData.objection_handling_notes}
            onChange={(e) => update('objection_handling_notes', e.target.value)}
            placeholder={`Common objections and how to handle them:
- 'I already use Apollo/ZoomInfo' → 'Most customers do — we plug into the stack, the wedge is the AI agent layer.'
- 'Sounds expensive' → 'Compared to a $5K/mo SDR? It's 1/10th.'
- 'I need to think about it' → 'Sure — what specifically? I can often answer the blocker on the call.'`}
          />
        </CardContent>
      </Card>

      {/* Teach the Agent — global learnings. Self-contained: adds/deletes
          immediately, NOT part of the Save Playbook batch. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>Teach the Agent</CardTitle>
            <FieldHelp text="Lessons here are saved immediately on Add (not with Save Playbook) and apply to every lead the agent drafts for." />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Add lessons the agent should apply when drafting replies. These apply to all leads.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={newLearning}
            onChange={(e) => setNewLearning(e.target.value)}
            placeholder="e.g. When prospects hesitate on price, mention the 14-day pilot before quoting anything."
          />
          <Button
            onClick={handleAddLearning}
            disabled={!newLearning.trim() || addLearning.isPending}
            size="sm"
            className="gap-2"
          >
            {addLearning.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Lesson
          </Button>
          {globalLearnings.length > 0 && (
            <div className="space-y-2 pt-1">
              {globalLearnings.map((l) => (
                <div key={l.id} className="flex items-start justify-between gap-2 border rounded-md px-3 py-2">
                  <p className="text-sm flex-1">{l.metadata?.learning_text ?? l.description}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteLearning.mutate({ id: l.id })}
                    disabled={deleteLearning.isPending}
                    aria-label="Delete lesson"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky save button */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end z-10">
        <Button onClick={handleSave} disabled={isSaving} className="gap-2">
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Playbook'}
        </Button>
      </div>
    </div>
  );
}
