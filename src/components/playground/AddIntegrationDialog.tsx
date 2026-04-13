import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOutboundIntegrations } from '@/hooks/useOutboundIntegrations';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, Building2 } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORMS = [
  { value: 'reply.io', label: 'Reply.io', icon: '📧', comingSoon: false },
  { value: 'heyreach', label: 'HeyReach', icon: '🤝', comingSoon: false },
  { value: 'smartlead', label: 'Smartlead', icon: '🎯', comingSoon: true },
  { value: 'instantly', label: 'Instantly.ai', icon: '⚡', comingSoon: true },
  { value: 'lemlist', label: 'Lemlist', icon: '🍋', comingSoon: true },
];

interface ReplyTeam {
  id: number;
  name: string;
}

interface AddIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function validateApiKey(platform: string, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('validate-api-key', {
      body: { platform, apiKey }
    });

    if (error) {
      console.error('Validation function error:', error);
      return { valid: false, error: 'Could not validate API key. Please try again.' };
    }

    return data as { valid: boolean; error?: string };
  } catch (err) {
    console.error('Validation error:', err);
    return { valid: false, error: 'Could not validate API key. Please try again.' };
  }
}

async function fetchReplyTeams(apiKey: string): Promise<{ teams: ReplyTeam[]; isAgencyAccount: boolean; recommendedTeamId: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-reply-teams', {
      body: { apiKey }
    });

    if (error) {
      console.error('Fetch teams error:', error);
      return { teams: [], isAgencyAccount: false, recommendedTeamId: null };
    }

    return {
      teams: data.teams || [],
      isAgencyAccount: data.isAgencyAccount || false,
      recommendedTeamId: data.recommendedTeamId || null
    };
  } catch (err) {
    console.error('Fetch teams error:', err);
    return { teams: [], isAgencyAccount: false, recommendedTeamId: null };
  }
}

export function AddIntegrationDialog({ open, onOpenChange }: AddIntegrationDialogProps) {
  const [platform, setPlatform] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  
  // Agency account support
  const [teams, setTeams] = useState<ReplyTeam[]>([]);
  const [isAgencyAccount, setIsAgencyAccount] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [manualTeamId, setManualTeamId] = useState('');
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  
  const { addIntegration } = useOutboundIntegrations();

  const handleValidate = async () => {
    if (!platform || !apiKey) return;
    
    setIsValidating(true);
    setValidationStatus('idle');
    setTeams([]);
    setIsAgencyAccount(false);
    setSelectedTeamId('');
    
    const result = await validateApiKey(platform, apiKey);
    
    if (!result.valid) {
      setIsValidating(false);
      setValidationStatus('invalid');
      toast.error(result.error || 'Invalid API key');
      return;
    }

    setValidationStatus('valid');
    toast.success('API key is valid!');
    
    // For Reply.io, check if this is an agency account or get recommended team ID
    if (platform === 'reply.io') {
      setIsLoadingTeams(true);
      const teamsResult = await fetchReplyTeams(apiKey);
      setIsLoadingTeams(false);
      
      if (teamsResult.isAgencyAccount && teamsResult.teams.length > 0) {
        // Multiple teams - show dropdown
        setTeams(teamsResult.teams);
        setIsAgencyAccount(true);
        toast.info('Agency account detected! Please select a client team.');
      } else if (teamsResult.recommendedTeamId) {
        // Single team detected - auto-fill the manual field
        setManualTeamId(teamsResult.recommendedTeamId);
        toast.success(`Team ID ${teamsResult.recommendedTeamId} detected and auto-filled for reliable sync.`);
      }
    }
    
    setIsValidating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!platform || !name || !apiKey) return;
    
    // For agency accounts, require team selection
    if (isAgencyAccount && !selectedTeamId) {
      toast.error('Please select a client team for this agency account');
      return;
    }

    // Validate before saving if not already validated
    if (validationStatus !== 'valid') {
      setIsValidating(true);
      const result = await validateApiKey(platform, apiKey);
      setIsValidating(false);
      
      if (!result.valid) {
        toast.error(result.error || 'Invalid API key');
        setValidationStatus('invalid');
        return;
      }
    }

    // Use selectedTeamId for agency accounts, or manualTeamId as fallback
    const teamId = selectedTeamId || manualTeamId || undefined;
    
    await addIntegration.mutateAsync({ 
      platform, 
      name, 
      apiKey,
      replyTeamId: teamId
    });
    
    // Reset form
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setPlatform('');
    setName('');
    setApiKey('');
    setValidationStatus('idle');
    setTeams([]);
    setIsAgencyAccount(false);
    setSelectedTeamId('');
    setManualTeamId('');
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    onOpenChange(open);
  };

  const selectedPlatform = PLATFORMS.find(p => p.value === platform);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect Platform</DialogTitle>
          <DialogDescription>
            Add your outbound platform API credentials to sync campaign data.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="platform">Platform</Label>
              <Select value={platform} onValueChange={(value) => {
                setPlatform(value);
                setValidationStatus('idle');
                setTeams([]);
                setIsAgencyAccount(false);
                setSelectedTeamId('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a platform" />
                </SelectTrigger>
                <SelectContent>
                  <TooltipProvider delayDuration={0}>
                    {PLATFORMS.map((p) =>
                      p.comingSoon ? (
                        <Tooltip key={p.value}>
                          <TooltipTrigger asChild>
                            <div
                              className="relative flex w-full cursor-not-allowed select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none opacity-50"
                            >
                              <span className="flex items-center gap-2">
                                <span>{p.icon}</span>
                                <span>{p.label}</span>
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Coming Soon</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SelectItem key={p.value} value={p.value}>
                          <span className="flex items-center gap-2">
                            <span>{p.icon}</span>
                            <span>{p.label}</span>
                          </span>
                        </SelectItem>
                      )
                    )}
                  </TooltipProvider>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">Connection Name</Label>
              <Input
                id="name"
                placeholder={selectedPlatform ? `My ${selectedPlatform.label} Account` : 'e.g., My Reply.io Account'}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to identify this connection
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="Enter your API key"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setValidationStatus('idle');
                    setTeams([]);
                    setIsAgencyAccount(false);
                    setSelectedTeamId('');
                  }}
                  className={`pr-20 ${validationStatus === 'valid' ? 'border-emerald-500 dark:border-emerald-400' : validationStatus === 'invalid' ? 'border-destructive' : ''}`}
                />
                <div className="absolute right-0 top-0 h-full flex items-center gap-1 pr-2">
                  {validationStatus === 'valid' && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                  )}
                  {validationStatus === 'invalid' && (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-transparent"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Your API key will be encrypted and stored securely
                </p>
                {platform && apiKey && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={handleValidate}
                    disabled={isValidating || isLoadingTeams}
                  >
                    {isValidating || isLoadingTeams ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        {isLoadingTeams ? 'Loading teams...' : 'Validating...'}
                      </>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Team selection for agency accounts */}
            {isAgencyAccount && teams.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="team" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Client Team
                </Label>
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={String(team.id)}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Agency account detected. Select which client's campaigns to sync.
                </p>
              </div>
            )}

            {/* Workspace API key info - shown for Reply.io when validated but no agency teams detected */}
            {platform === 'reply.io' && validationStatus === 'valid' && !isAgencyAccount && (
              <div className="grid gap-2 p-3 bg-muted/50 rounded-md">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4" />
                  Workspace API Key Detected
                </div>
                <p className="text-xs text-muted-foreground">
                  This API key has access to one Reply.io workspace. Each workspace in Reply.io 
                  has its own API key. To sync campaigns from multiple workspaces, add each 
                  workspace as a separate integration.
                </p>
                {manualTeamId && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Workspace ID:</span>
                    <span className="font-mono bg-secondary px-1.5 py-0.5 rounded">{manualTeamId}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!platform || !name || !apiKey || addIntegration.isPending || (isAgencyAccount && !selectedTeamId)}
            >
              {addIntegration.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
