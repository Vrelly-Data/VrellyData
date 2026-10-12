import { useState } from 'react';
import { Check, Copy, Globe, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { PIXEL_PRIVACY_NOTE, pixelSnippet } from '@/lib/signals';
import { useRegisterSite, useSignalSites, useTeamNames, useToggleSite } from '@/hooks/useSignals';

/**
 * Website visitors setup. Clients see their own team's sites (RLS) and can
 * register their domain; admins see every site, can register one for any team
 * and pause a site. The snippet is never installed for anyone — it is shown
 * to copy.
 */
export function PixelSitesPanel({ mode }: { mode: 'admin' | 'client' }) {
  const { toast } = useToast();
  const sites = useSignalSites();
  const register = useRegisterSite();
  const toggle = useToggleSite();
  const teamIds = [...new Set((sites.data ?? []).map((s) => s.team_id))];
  const teamNames = useTeamNames(teamIds, mode === 'admin');
  const [domain, setDomain] = useState('');
  const [teamId, setTeamId] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (siteKey: string) => {
    try {
      await navigator.clipboard.writeText(pixelSnippet(siteKey));
      setCopied(siteKey);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: 'Copy failed — select the snippet and copy it manually', variant: 'destructive' });
    }
  };

  const add = () =>
    register.mutate({ domain, teamId: mode === 'admin' && teamId.trim() ? teamId.trim() : null }, {
      onSuccess: (s) => { toast({ title: `Site ready: ${s.domain}` }); setDomain(''); setTeamId(''); },
      onError: (e) => toast({ title: 'Could not add site', description: (e as Error).message, variant: 'destructive' }),
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> Website visitor pixel</CardTitle>
        <p className="text-xs text-muted-foreground">
          Paste the snippet before &lt;/head&gt; on every page of the site. Each visitor becomes one signal per day with the pages they viewed;
          only your team can see your site's visitors. Visitor identification (which company is visiting) is not enabled yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle className="text-sm">Privacy policy and cookie disclosure</AlertTitle>
          <AlertDescription className="text-xs">{PIXEL_PRIVACY_NOTE}</AlertDescription>
        </Alert>

        {(sites.data ?? []).length === 0 && !sites.isLoading && (
          <p className="text-sm text-muted-foreground">No site yet — add your domain below to get your snippet.</p>
        )}
        {(sites.data ?? []).map((s) => (
          <div key={s.site_key} className="rounded-md border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{s.domain}</span>
              {mode === 'admin' && <Badge variant="outline" className="text-[10px]">{teamNames.data?.[s.team_id] ?? s.team_id}</Badge>}
              <Badge variant={s.is_active ? 'secondary' : 'outline'} className="text-[10px]">{s.is_active ? 'active' : 'paused'}</Badge>
              <span className="text-xs text-muted-foreground font-mono">{s.site_key}</span>
              <div className="ml-auto flex items-center gap-2">
                {mode === 'admin' && (
                  <Switch checked={s.is_active} aria-label="Site active" onCheckedChange={(v) => toggle.mutate({ siteKey: s.site_key, isActive: v })} />
                )}
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => copy(s.site_key)}>
                  {copied === s.site_key ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy snippet
                </Button>
              </div>
            </div>
            <pre className="text-[11px] bg-muted rounded p-2 overflow-x-auto whitespace-pre">{pixelSnippet(s.site_key)}</pre>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-64 text-sm" placeholder="yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          {mode === 'admin' && (
            <Input className="h-8 w-80 text-xs font-mono" placeholder="team id (blank = your team)" value={teamId} onChange={(e) => setTeamId(e.target.value)} />
          )}
          <Button size="sm" className="h-8" disabled={!domain.trim() || register.isPending} onClick={add}>Add site</Button>
        </div>
      </CardContent>
    </Card>
  );
}
