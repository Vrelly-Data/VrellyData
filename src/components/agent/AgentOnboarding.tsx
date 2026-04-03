import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUpsertAgentConfig, type AgentConfigInput } from '@/hooks/useAgent';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CheckCircle2, ArrowLeft, ArrowRight, Rocket, Eye, EyeOff, Loader2, Wifi, WifiOff } from 'lucide-react';

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

interface FormData {
  // Sender profile
  sender_name: string;
  sender_title: string;
  sender_linkedin: string;
  sender_bio: string;
  // Company profile
  company_name: string;
  company_url: string;
  offer_description: string;
  target_icp: string;
  outcome_delivered: string;
  desired_action: string;
  // Communication
  communication_style: string;
  avoid_phrases: string;
  sample_message: string;
  // Connection
  reply_api_key: string;
  mode: string;
}

export function AgentOnboarding() {
  const navigate = useNavigate();
  const upsertConfig = useUpsertAgentConfig();
  const [currentStep, setCurrentStep] = useState(1);
  const [hasExistingReplyKey, setHasExistingReplyKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [formData, setFormData] = useState<FormData>({
    sender_name: '',
    sender_title: '',
    sender_linkedin: '',
    sender_bio: '',
    company_name: '',
    company_url: '',
    offer_description: '',
    target_icp: '',
    outcome_delivered: '',
    desired_action: 'Book a call',
    communication_style: 'conversational',
    avoid_phrases: '',
    sample_message: '',
    reply_api_key: '',
    mode: 'copilot',
  });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('outbound_integrations')
        .select('id, platform')
        .eq('platform', 'reply_io')
        .eq('is_active', true)
        .limit(1);
      if (data && data.length > 0) {
        setHasExistingReplyKey(true);
      }
    })();
  }, []);

  const update = (field: keyof FormData, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const canProceed = () => {
    switch (currentStep) {
      case 1: return formData.sender_name.trim() !== '';
      case 2: return formData.company_name.trim() !== '' && formData.offer_description.trim() !== '';
      case 3: return true;
      case 4: return true;
      default: return false;
    }
  };

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

  const handleLaunch = async () => {
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
      is_active: true,
      onboarding_complete: true,
      onboarding_step: 4,
    };

    await upsertConfig.mutateAsync(input);
    navigate('/agent');
  };

  const stepLabels = ['Sender Profile', 'Company Profile', 'Communication Style', 'Connect & Launch'];

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      {/* Progress */}
      <div className="flex items-center justify-between mb-8">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                'h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors',
                step < currentStep
                  ? 'bg-primary text-primary-foreground border-primary'
                  : step === currentStep
                    ? 'border-primary text-primary'
                    : 'border-muted text-muted-foreground'
              )}
            >
              {step < currentStep ? <CheckCircle2 className="h-5 w-5" /> : step}
            </div>
            {step < 4 && <div className={cn('h-0.5 w-12 sm:w-20', step < currentStep ? 'bg-primary' : 'bg-muted')} />}
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Step {currentStep} of 4 — {stepLabels[currentStep - 1]}
      </p>

      {/* Step 1 — Sender Profile */}
      {currentStep === 1 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Set up your sender profile</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sender_name">Full Name *</Label>
              <Input id="sender_name" value={formData.sender_name} onChange={(e) => update('sender_name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sender_title">Job Title</Label>
              <Input id="sender_title" value={formData.sender_title} onChange={(e) => update('sender_title', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sender_linkedin">LinkedIn URL</Label>
              <Input id="sender_linkedin" value={formData.sender_linkedin} onChange={(e) => update('sender_linkedin', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sender_bio">Bio</Label>
              <Textarea
                id="sender_bio"
                value={formData.sender_bio}
                onChange={(e) => update('sender_bio', e.target.value)}
                placeholder="VP of Sales at Acme with 10 years in medtech. I help regulatory teams cut submission timelines by 40%."
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">2-3 sentences. Your agent uses this to write in your voice.</p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Company Profile */}
      {currentStep === 2 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Tell us about your company</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="company_name">Company Name *</Label>
              <Input id="company_name" value={formData.company_name} onChange={(e) => update('company_name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="company_url">Company URL</Label>
              <Input id="company_url" value={formData.company_url} onChange={(e) => update('company_url', e.target.value)} placeholder="https://yourcompany.com" />
            </div>
            <div>
              <Label htmlFor="offer_description">What do you sell? *</Label>
              <Textarea
                id="offer_description"
                value={formData.offer_description}
                onChange={(e) => update('offer_description', e.target.value)}
                placeholder="We help B2B SaaS companies reduce churn by identifying at-risk accounts before they cancel."
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="target_icp">Who is it for?</Label>
              <Input
                id="target_icp"
                value={formData.target_icp}
                onChange={(e) => update('target_icp', e.target.value)}
                placeholder="VP of Customer Success at SaaS companies with 50-500 employees"
              />
            </div>
            <div>
              <Label htmlFor="outcome_delivered">Outcome you deliver</Label>
              <Input
                id="outcome_delivered"
                value={formData.outcome_delivered}
                onChange={(e) => update('outcome_delivered', e.target.value)}
                placeholder="30% reduction in churn within 90 days"
              />
            </div>
            <div>
              <Label htmlFor="desired_action">Desired prospect action</Label>
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
          </div>
        </div>
      )}

      {/* Step 3 — Communication Style */}
      {currentStep === 3 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">How should your agent communicate?</h2>
          <div className="space-y-4">
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
              <Label htmlFor="avoid_phrases">Things to avoid</Label>
              <Input
                id="avoid_phrases"
                value={formData.avoid_phrases}
                onChange={(e) => update('avoid_phrases', e.target.value)}
                placeholder="Don't mention competitors, avoid aggressive language, never use 'just checking in'"
              />
            </div>
            <div>
              <Label htmlFor="sample_message">Sample message (optional)</Label>
              <Textarea
                id="sample_message"
                value={formData.sample_message}
                onChange={(e) => update('sample_message', e.target.value)}
                rows={4}
                placeholder="Paste a message you've sent that got great replies."
              />
              <p className="text-xs text-muted-foreground mt-1">
                This is the highest-impact thing you can give your agent — it learns your voice from this.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 4 — Connect & Launch */}
      {currentStep === 4 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Connect your tools and go live</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reply_api_key">Reply.io API Key</Label>
              {hasExistingReplyKey ? (
                <div className="flex items-center gap-2 mt-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Using your existing Reply.io connection
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="relative flex-1">
                      <Input
                        id="reply_api_key"
                        value={formData.reply_api_key}
                        onChange={(e) => update('reply_api_key', e.target.value)}
                        type={showApiKey ? 'text' : 'password'}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestConnection}
                      disabled={testingConnection || !formData.reply_api_key}
                    >
                      {testingConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                    </Button>
                  </div>
                  {connectionStatus === 'success' && (
                    <div className="flex items-center gap-1.5 mt-2 text-sm text-green-600">
                      <Wifi className="h-4 w-4" /> Connected
                    </div>
                  )}
                  {connectionStatus === 'error' && (
                    <div className="flex items-center gap-1.5 mt-2 text-sm text-red-600">
                      <WifiOff className="h-4 w-4" /> Connection failed — check your API key
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Find this in Reply.io &rarr; Settings &rarr; API</p>
                </>
              )}
            </div>

            <div>
              <Label>Agent Mode</Label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => update('mode', 'copilot')}
                  className={cn(
                    'border rounded-lg p-5 text-left transition-colors',
                    formData.mode === 'copilot'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-muted-foreground/40'
                  )}
                >
                  <div className="font-medium">Co-pilot</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Your agent drafts, you approve before anything sends. Recommended for LinkedIn.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => update('mode', 'auto')}
                  className={cn(
                    'border rounded-lg p-5 text-left transition-colors',
                    formData.mode === 'auto'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-muted-foreground/40'
                  )}
                >
                  <div className="font-medium">Auto</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Your agent handles everything automatically. Best for email.
                  </div>
                </button>
              </div>
            </div>

            <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
              <CardContent className="pt-4 text-sm text-blue-800 dark:text-blue-200">
                Your agent will run every Monday at 6am. You'll receive a summary email after each run.
                You can pause or adjust anytime from Agent Settings.
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between mt-8">
        <Button
          variant="outline"
          onClick={() => setCurrentStep((s) => s - 1)}
          disabled={currentStep === 1}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {currentStep < 4 ? (
          <Button onClick={() => setCurrentStep((s) => s + 1)} disabled={!canProceed()}>
            Next
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleLaunch}
            disabled={upsertConfig.isPending}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Rocket className="h-4 w-4 mr-2" />
            {upsertConfig.isPending ? 'Launching...' : 'Launch Agent'}
          </Button>
        )}
      </div>
    </div>
  );
}
