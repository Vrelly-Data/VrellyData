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
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, Building2 } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORMS = [
  { value: 'reply.io', label: 'Reply.io', icon: '📧' },
  { value: 'smartlead', label: 'Smartlead', icon: '🎯' },
  { value: 'instantly', label: 'Instantly.ai', icon: '⚡' },
  { value: 'lemlist', label: 'Lemlist', icon: '🍋' },
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

async function fetchReplyTeams(apiKey: string): Promise<{ teams: ReplyTeam[]; isAgencyAccount: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-reply-teams', {
      body: { apiKey }
    });

    if (error) {
      console.error('Fetch teams error:', error);
      return { teams: [], isAgencyAccount: false };
    }

    return {
      teams: data.teams || [],
      isAgencyAccount: data.isAgencyAccount || false
    };
  } catch (err) {
    console.error('Fetch teams error:', err);
    return { teams: [], isAgencyAccount: false };
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
    
    // For Reply.io, check if this is an agency account
    if (platform === 'reply.io') {
      setIsLoadingTeams(true);
      const teamsResult = await fetchReplyTeams(apiKey);
      setIsLoadingTeams(false);
      
      if (teamsResult.isAgencyAccount && teamsResult.teams.length > 0) {
        setTeams(teamsResult.teams);
        setIsAgencyAccount(true);
        toast.info('Agency account detected! Please select a client team.');
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

    await addIntegration.mutateAsync({ 
      platform, 
      name, 
      apiKey,
      replyTeamId: selectedTeamId || undefined
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
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="flex items-center gap-2">
                        <span>{p.icon}</span>
                        <span>{p.label}</span>
                      </span>
                    </SelectItem>
                  ))}
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
