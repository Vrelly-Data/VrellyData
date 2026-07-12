import { useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Pencil, RefreshCw, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Organization,
  effectiveMonthlyCents,
  effectiveSource,
  useOrganizations,
  useUpdateOrganization,
  useSyncOrgBilling,
} from '@/hooks/useOrganizations';
import { EditOrgDialog } from './EditOrgDialog';

const money = (cents: number | null) =>
  cents == null
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export function OrganizationsTab() {
  const { data: orgs, isLoading, error } = useOrganizations();
  const updateOrg = useUpdateOrganization();
  const syncBilling = useSyncOrgBilling();
  const [editing, setEditing] = useState<Organization | null>(null);

  const rollup = useMemo(() => {
    const list = orgs ?? [];
    const active = list.filter((o) => o.is_active);
    const mrr = active.reduce((sum, o) => sum + (effectiveMonthlyCents(o) ?? 0), 0);
    return { mrr, active: active.length, inactive: list.length - active.length };
  }, [orgs]);

  const toggleActive = async (o: Organization) => {
    try {
      await updateOrg.mutateAsync({ id: o.id, is_active: !o.is_active });
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  };

  const handleSync = async () => {
    try {
      const r = await syncBilling.mutateAsync();
      toast.success(`Synced ${r.synced} org(s)${r.errors ? `, ${r.errors} error(s)` : ''}`);
    } catch (e) {
      toast.error(`Sync failed: ${(e as Error).message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive py-6">
        Failed to load organizations: {(error as Error).message}
      </p>
    );
  }

  const list = orgs ?? [];

  return (
    <div className="space-y-4">
      {/* Roll-up */}
      <div className="grid grid-cols-3 gap-3">
        <Rollup label="Total MRR (active)" value={money(rollup.mrr)} strong />
        <Rollup label="Active" value={String(rollup.active)} />
        <Rollup label="Inactive" value={String(rollup.inactive)} />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {list.length} organization{list.length !== 1 ? 's' : ''}
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncBilling.isPending}>
          {syncBilling.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Sync billing
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead>Last Stripe sync</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No organizations yet.
                </TableCell>
              </TableRow>
            ) : (
              list.map((o) => {
                const src = effectiveSource(o);
                return (
                  <TableRow key={o.id} className={o.is_active ? '' : 'opacity-60'}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {o.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{o.contact_name || '—'}</div>
                      {o.contact_email && (
                        <div className="text-xs text-muted-foreground">{o.contact_email}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={o.is_active}
                          onCheckedChange={() => toggleActive(o)}
                          disabled={updateOrg.isPending}
                        />
                        <span className="text-xs text-muted-foreground">
                          {o.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span>{money(effectiveMonthlyCents(o))}</span>
                        {src !== 'none' && (
                          <Badge variant={src === 'manual' ? 'default' : 'secondary'} className="text-[10px]">
                            {src}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {o.stripe_synced_at
                        ? new Date(o.stripe_synced_at).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(o)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <EditOrgDialog org={editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}

function Rollup({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={strong ? 'text-2xl font-bold mt-1' : 'text-2xl font-semibold mt-1'}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
