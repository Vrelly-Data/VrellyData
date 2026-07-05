// Onboarding — public, no-auth agent questionnaire.
//
// Route: /onboard/:token
//
// Loads context via get-onboarding-context (prefill + already_paid + a
// terminal status for invalid/consumed/expired links). On submit, calls
// provision-onboarding (Phase 3) which claims the token, creates the Stripe
// subscription, and provisions the account. The client is NEVER logged in —
// the token is the only auth. Success lands on the confirmation screen.
//
// No admin shell, no sidebar; the page never queries Supabase tables
// directly — all isolation is server-side, derived from the token.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import vrellyLogo from '@/assets/vrelly-logo.png';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type ContextStatus = 'valid' | 'consumed' | 'expired' | 'invalid';

interface OnboardingContext {
  status: ContextStatus;
  email?: string | null;
  displayName?: string | null;
  company?: string | null;
  alreadyPaid?: boolean;
}

// Mirrors the agent_configs questionnaire-candidate fields. avoid_phrases is
// entered as a comma-separated string and split into an array on submit.
interface FormState {
  company_name: string;
  company_url: string;
  sender_name: string;
  sender_title: string;
  sender_linkedin: string;
  sender_bio: string;
  offer_description: string;
  target_icp: string;
  outcome_delivered: string;
  desired_action: string;
  communication_style: string;
  sample_message: string;
  avoid_phrases: string;
  calendar_link: string;
  default_cc: string;
  agent_knowledge: string;
  pricing_summary: string;
  case_studies: string;
  disqualification_criteria: string;
  objection_handling_notes: string;
}

const EMPTY_FORM: FormState = {
  company_name: '',
  company_url: '',
  sender_name: '',
  sender_title: '',
  sender_linkedin: '',
  sender_bio: '',
  offer_description: '',
  target_icp: '',
  outcome_delivered: '',
  desired_action: '',
  communication_style: 'conversational',
  sample_message: '',
  avoid_phrases: '',
  calendar_link: '',
  default_cc: '',
  agent_knowledge: '',
  pricing_summary: '',
  case_studies: '',
  disqualification_criteria: '',
  objection_handling_notes: '',
};

const COMM_STYLES = ['conversational', 'direct', 'formal', 'consultative'];
const TOTAL_STEPS = 3;

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function Onboarding() {
  const { token } = useParams<{ token: string }>();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const contextQuery = useQuery({
    queryKey: ['onboarding-context', token],
    queryFn: async (): Promise<OnboardingContext> => {
      if (!token) throw new Error('Missing token');
      const { data, error } = await supabase.functions.invoke(
        'get-onboarding-context',
        { body: { token } },
      );
      if (error) throw new Error(error.message);
      return data as OnboardingContext;
    },
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  });

  // Prefill from the token row once, when the context lands valid.
  useEffect(() => {
    const ctx = contextQuery.data;
    if (ctx?.status !== 'valid') return;
    setForm((prev) => ({
      ...prev,
      company_name: prev.company_name || (ctx.company ?? ''),
      sender_name: prev.sender_name || (ctx.displayName ?? ''),
      default_cc: prev.default_cc || (ctx.email ?? ''),
    }));
  }, [contextQuery.data]);

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Required fields gate the relevant step's "Next"/"Submit".
  const step1Valid = form.company_name.trim() && form.sender_name.trim();
  const step2Valid = form.offer_description.trim();

  const handleSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const config = {
        company_name: form.company_name.trim(),
        company_url: form.company_url.trim() || null,
        sender_name: form.sender_name.trim(),
        sender_title: form.sender_title.trim() || null,
        sender_linkedin: form.sender_linkedin.trim() || null,
        sender_bio: form.sender_bio.trim() || null,
        offer_description: form.offer_description.trim(),
        target_icp: form.target_icp.trim() || null,
        outcome_delivered: form.outcome_delivered.trim() || null,
        desired_action: form.desired_action.trim() || null,
        communication_style: form.communication_style,
        sample_message: form.sample_message.trim() || null,
        avoid_phrases: form.avoid_phrases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        calendar_link: form.calendar_link.trim() || null,
        default_cc: form.default_cc.trim() || null,
        agent_knowledge: form.agent_knowledge.trim() || null,
        pricing_summary: form.pricing_summary.trim() || null,
        case_studies: form.case_studies.trim() || null,
        disqualification_criteria: form.disqualification_criteria.trim() || null,
        objection_handling_notes: form.objection_handling_notes.trim() || null,
      };
      const { data, error } = await supabase.functions.invoke(
        'provision-onboarding',
        { body: { token, config } },
      );
      if (error) {
        toast.error(error.message || 'Something went wrong. Please try again.');
        return;
      }
      if (data?.error) {
        toast.error(String(data.error));
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- LOADING ------------------------------------------------------------
  if (contextQuery.isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </Shell>
    );
  }

  // ---- TERMINAL / INVALID -------------------------------------------------
  const status = contextQuery.data?.status;
  if (contextQuery.error || !status || status !== 'valid') {
    return (
      <Shell>
        <TerminalMessage status={(status as ContextStatus) ?? 'invalid'} />
      </Shell>
    );
  }

  // ---- SUBMITTED (confirmation; Phase 4 refines) --------------------------
  if (submitted) {
    return (
      <Shell>
        <Card>
          <CardContent className="py-14 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <h2 className="text-xl font-semibold">
              Your agent is officially being created
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Thanks — we&apos;ve got everything we need. Your Vrelly agent is
              being set up now. We&apos;ll be in touch with your login details
              shortly.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // ---- QUESTIONNAIRE ------------------------------------------------------
  return (
    <Shell>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Set up your Vrelly agent</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about your business so your agent can represent you
          authentically. Step {step} of {TOTAL_STEPS}.
        </p>
        <div className="flex gap-1.5 pt-1">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {step === 1 && (
            <>
              <Field label="Company name" required>
                <Input
                  value={form.company_name}
                  onChange={(e) => set('company_name', e.target.value)}
                  placeholder="Acme Corp"
                />
              </Field>
              <Field label="Company website">
                <Input
                  value={form.company_url}
                  onChange={(e) => set('company_url', e.target.value)}
                  placeholder="https://acme.com"
                />
              </Field>
              <Field label="Sender name" required hint="The person your agent speaks as.">
                <Input
                  value={form.sender_name}
                  onChange={(e) => set('sender_name', e.target.value)}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field label="Sender title">
                <Input
                  value={form.sender_title}
                  onChange={(e) => set('sender_title', e.target.value)}
                  placeholder="Head of Sales"
                />
              </Field>
              <Field label="Sender LinkedIn URL">
                <Input
                  value={form.sender_linkedin}
                  onChange={(e) => set('sender_linkedin', e.target.value)}
                  placeholder="https://linkedin.com/in/janedoe"
                />
              </Field>
              <Field label="Short bio">
                <Textarea
                  value={form.sender_bio}
                  onChange={(e) => set('sender_bio', e.target.value)}
                  placeholder="A sentence or two about the sender."
                  rows={3}
                />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field
                label="What you offer"
                required
                hint="The pitch your agent leads with."
              >
                <Textarea
                  value={form.offer_description}
                  onChange={(e) => set('offer_description', e.target.value)}
                  placeholder="We help B2B SaaS teams book more qualified demos by…"
                  rows={4}
                />
              </Field>
              <Field label="Who you target (ICP)">
                <Textarea
                  value={form.target_icp}
                  onChange={(e) => set('target_icp', e.target.value)}
                  placeholder="VP Sales at 50–500-person SaaS companies…"
                  rows={2}
                />
              </Field>
              <Field label="Outcome you deliver">
                <Textarea
                  value={form.outcome_delivered}
                  onChange={(e) => set('outcome_delivered', e.target.value)}
                  placeholder="Typically a 30% lift in reply-to-meeting rate…"
                  rows={2}
                />
              </Field>
              <Field label="Desired action" hint="What a good reply should lead to.">
                <Input
                  value={form.desired_action}
                  onChange={(e) => set('desired_action', e.target.value)}
                  placeholder="Book a 20-minute discovery call"
                />
              </Field>
              <Field label="Communication style">
                <Select
                  value={form.communication_style}
                  onValueChange={(v) => set('communication_style', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMM_STYLES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs text-muted-foreground">
                All optional — you (or your Vrelly contact) can refine these
                anytime after launch.
              </p>
              <Field label="Sample message" hint="An example outbound message, for tone.">
                <Textarea
                  value={form.sample_message}
                  onChange={(e) => set('sample_message', e.target.value)}
                  rows={3}
                />
              </Field>
              <Field label="Phrases to avoid" hint="Comma-separated.">
                <Input
                  value={form.avoid_phrases}
                  onChange={(e) => set('avoid_phrases', e.target.value)}
                  placeholder="synergy, circle back, just checking in"
                />
              </Field>
              <Field label="Calendar link">
                <Input
                  value={form.calendar_link}
                  onChange={(e) => set('calendar_link', e.target.value)}
                  placeholder="https://calendly.com/jane/intro"
                />
              </Field>
              <Field label="Default CC" hint="Email address to CC on email replies.">
                <Input
                  value={form.default_cc}
                  onChange={(e) => set('default_cc', e.target.value)}
                  placeholder="team@acme.com"
                />
              </Field>
              <Field label="Anything else your agent should know">
                <Textarea
                  value={form.agent_knowledge}
                  onChange={(e) => set('agent_knowledge', e.target.value)}
                  placeholder="Pricing, positioning, common objections, proof points…"
                  rows={4}
                />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || submitting}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>

        {step < TOTAL_STEPS ? (
          <Button
            onClick={() => setStep((s) => s + 1)}
            disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
          >
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || !step1Valid || !step2Valid}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Finish setup
          </Button>
        )}
      </div>
    </Shell>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <img src={vrellyLogo} alt="Vrelly" className="h-10 opacity-80" />
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TerminalMessage({ status }: { status: ContextStatus }) {
  const copy: Record<ContextStatus, { title: string; body: string }> = {
    valid: { title: '', body: '' },
    consumed: {
      title: 'This onboarding is already complete',
      body: 'Your agent has already been set up from this link. If you think this is a mistake, contact the person who shared it with you.',
    },
    expired: {
      title: 'This onboarding link has expired',
      body: 'Onboarding links are time-limited. Please contact the person who shared it with you for a fresh link.',
    },
    invalid: {
      title: 'This onboarding link is no longer active',
      body: 'The link may have been revoked or never existed. Please contact the person who shared it with you for a new link.',
    },
  };
  const { title, body } = copy[status];
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center space-y-2">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{body}</p>
      </CardContent>
    </Card>
  );
}
