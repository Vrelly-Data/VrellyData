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
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORMS = [
  { value: 'reply.io', label: 'Reply.io', icon: '📧' },
  { value: 'smartlead', label: 'Smartlead', icon: '🎯' },
  { value: 'instantly', label: 'Instantly.ai', icon: '⚡' },
  { value: 'lemlist', label: 'Lemlist', icon: '🍋' },
];

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

export function AddIntegrationDialog({ open, onOpenChange }: AddIntegrationDialogProps) {
  const [platform, setPlatform] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const { addIntegration } = useOutboundIntegrations();

  const handleValidate = async () => {
    if (!platform || !apiKey) return;
    
    setIsValidating(true);
    setValidationStatus('idle');
    
    const result = await validateApiKey(platform, apiKey);
    
    setIsValidating(false);
    setValidationStatus(result.valid ? 'valid' : 'invalid');
    
    if (!result.valid) {
      toast.error(result.error || 'Invalid API key');
    } else {
      toast.success('API key is valid!');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!platform || !name || !apiKey) return;

    // Validate before saving
    setIsValidating(true);
    const result = await validateApiKey(platform, apiKey);
    setIsValidating(false);
    
    if (!result.valid) {
      toast.error(result.error || 'Invalid API key');
      setValidationStatus('invalid');
      return;
    }

    await addIntegration.mutateAsync({ platform, name, apiKey });
    
    // Reset form
    setPlatform('');
    setName('');
    setApiKey('');
    setValidationStatus('idle');
    onOpenChange(false);
  };

  const selectedPlatform = PLATFORMS.find(p => p.value === platform);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <Select value={platform} onValueChange={setPlatform}>
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
                    disabled={isValidating}
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!platform || !name || !apiKey || addIntegration.isPending}
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
