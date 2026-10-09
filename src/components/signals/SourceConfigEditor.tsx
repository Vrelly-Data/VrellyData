import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { SignalSource } from '@/lib/signals';
import { useUpdateSource } from '@/hooks/useSignals';

type Config = Record<string, unknown>;
type Board = { ats: 'greenhouse' | 'lever' | 'ashby'; token: string; company_name?: string; company_domain?: string };
type Org = { login: string; company_name?: string; company_domain?: string };

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Drops half-filled watchlist rows (no board token / org login) before saving. */
function withoutBlankRows(config: Config): Config {
  const out = { ...config };
  if (Array.isArray(config.boards)) out.boards = asArray<Board>(config.boards).filter((b) => b?.token);
  if (Array.isArray(config.orgs)) out.orgs = asArray<Org | string>(config.orgs).filter((o) => (typeof o === 'string' ? o : o?.login));
  return out;
}

/**
 * Admin editor for one source: on/off, cadence, and its config. Job boards
 * (SaaS hiring) and orgs/queries (GitHub) get structured watchlist editors;
 * every source also has the raw JSON. Config never holds secrets.
 */
export function SourceConfigEditor({ source }: { source: SignalSource }) {
  const { toast } = useToast();
  const update = useUpdateSource();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<Config>(source.config ?? {});
  const [json, setJson] = useState(JSON.stringify(source.config ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setConfig(source.config ?? {});
    setJson(JSON.stringify(source.config ?? {}, null, 2));
  }, [source.config]);

  const patch = (p: Config) => {
    const next = { ...config, ...p };
    setConfig(next);
    setJson(JSON.stringify(next, null, 2));
  };
  const dirty = JSON.stringify(config) !== JSON.stringify(source.config ?? {});

  const save = (p: Partial<SignalSource>, label: string) =>
    update.mutate({ key: source.key, patch: p }, {
      onSuccess: () => toast({ title: `${source.name}: ${label}` }),
      onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
    });

  const boards = asArray<Board>(config.boards);
  const orgs = asArray<Org | string>(config.orgs).map((o) => (typeof o === 'string' ? { login: o } : o));

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex flex-wrap items-center gap-3">
            <Settings2 className="h-4 w-4" />
            {source.name}
            <span className="text-xs font-normal text-muted-foreground">{source.key} · {source.function_name}</span>
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-normal">
                Active
                <Switch checked={source.is_active} onCheckedChange={(v) => save({ is_active: v }, v ? 'resumed' : 'paused')} />
              </label>
              {source.kind !== 'pixel' && (
                <Select value={source.cadence} onValueChange={(v) => save({ cadence: v as SignalSource['cadence'] }, `cadence ${v}`)}>
                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1 text-xs">
                  {source.key === 'saas_hiring' ? 'Watchlist' : source.key === 'github_activity' ? 'Orgs & queries' : 'Config'}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </CardTitle>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {source.key === 'saas_hiring' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Job boards ({boards.length})</Label>
                  {boards.length === 0 && <p className="text-xs text-muted-foreground">No companies yet. Add a Greenhouse, Lever or Ashby board.</p>}
                  {boards.map((b, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <Select value={b.ats} onValueChange={(v) => patch({ boards: boards.map((x, j) => (j === i ? { ...x, ats: v as Board['ats'] } : x)) })}>
                        <SelectTrigger className="col-span-3 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="greenhouse">Greenhouse</SelectItem>
                          <SelectItem value="lever">Lever</SelectItem>
                          <SelectItem value="ashby">Ashby</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input className="col-span-3 h-8 text-xs" placeholder="board token, e.g. airbnb" value={b.token}
                        onChange={(e) => patch({ boards: boards.map((x, j) => (j === i ? { ...x, token: e.target.value.trim() } : x)) })} />
                      <Input className="col-span-3 h-8 text-xs" placeholder="Company name" value={b.company_name ?? ''}
                        onChange={(e) => patch({ boards: boards.map((x, j) => (j === i ? { ...x, company_name: e.target.value } : x)) })} />
                      <Input className="col-span-2 h-8 text-xs" placeholder="domain.com" value={b.company_domain ?? ''}
                        onChange={(e) => patch({ boards: boards.map((x, j) => (j === i ? { ...x, company_domain: e.target.value.trim() } : x)) })} />
                      <Button size="icon" variant="ghost" className="col-span-1 h-8" aria-label="Remove board" onClick={() => patch({ boards: boards.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => patch({ boards: [...boards, { ats: 'greenhouse', token: '' }] })}>
                    <Plus className="h-3 w-3" /> Add company
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">Role keywords that raise the score (comma-separated)</Label>
                    <Input className="h-8 text-xs" value={asArray<string>(config.role_keywords).join(', ')}
                      onChange={(e) => patch({ role_keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Only postings newer than (days)</Label>
                    <Input type="number" min={1} className="h-8 text-xs" value={Number(config.max_age_days ?? 30)}
                      onChange={(e) => patch({ max_age_days: Number(e.target.value) || 30 })} />
                  </div>
                </div>
              </>
            )}

            {source.key === 'github_activity' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Org watchlist ({orgs.length}) — new repos and releases</Label>
                  {orgs.map((o, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <Input className="col-span-4 h-8 text-xs" placeholder="org login, e.g. supabase" value={o.login}
                        onChange={(e) => patch({ orgs: orgs.map((x, j) => (j === i ? { ...x, login: e.target.value.trim() } : x)) })} />
                      <Input className="col-span-4 h-8 text-xs" placeholder="Company name (optional)" value={o.company_name ?? ''}
                        onChange={(e) => patch({ orgs: orgs.map((x, j) => (j === i ? { ...x, company_name: e.target.value } : x)) })} />
                      <Input className="col-span-3 h-8 text-xs" placeholder="domain.com (optional)" value={o.company_domain ?? ''}
                        onChange={(e) => patch({ orgs: orgs.map((x, j) => (j === i ? { ...x, company_domain: e.target.value.trim() } : x)) })} />
                      <Button size="icon" variant="ghost" className="col-span-1 h-8" aria-label="Remove org" onClick={() => patch({ orgs: orgs.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => patch({ orgs: [...orgs, { login: '' }] })}>
                    <Plus className="h-3 w-3" /> Add org
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Repo search queries, one per line (created:&gt;= is added automatically)</Label>
                  <Textarea rows={3} className="text-xs font-mono" value={asArray<string>(config.search_queries).join('\n')}
                    onChange={(e) => patch({ search_queries: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Config (JSON) — filters and watchlists only, never secrets</Label>
              <Textarea rows={6} className="text-xs font-mono" value={json}
                onChange={(e) => {
                  setJson(e.target.value);
                  try {
                    const v = JSON.parse(e.target.value);
                    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('must be an object');
                    setConfig(v);
                    setJsonError(null);
                  } catch (err) {
                    setJsonError((err as Error).message);
                  }
                }} />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
            </div>

            <div className="flex gap-2">
              <Button size="sm" disabled={!dirty || !!jsonError || update.isPending}
                onClick={() => save({ config: withoutBlankRows(config) }, 'config saved')}>
                Save config
              </Button>
              <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setConfig(source.config ?? {}); setJson(JSON.stringify(source.config ?? {}, null, 2)); setJsonError(null); }}>
                Discard
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
