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
import {
  Loader2, Pencil, RefreshCw, Building2, Eye, EyeOff, Plus, Trash2, Download,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Organization,
  effectiveMonthlyCents,
  effectiveSource,
  useOrganizations,
  useUpdateOrganization,
  useDeleteOrganization,
  useSyncOrgBilling,
} from '@/hooks/useOrganizations';
import { EditOrgDialog } from './EditOrgDialog';
import { organizationsToCsv, downloadCsv } from '@/lib/organizationsCsv';

const money = (cents: number | null) =>
  cents == null
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export function OrganizationsTab() {
  const { data: orgs, isLoading, error } = useOrganizations();
  const updateOrg = useUpdateOrganization();
  const deleteOrg = useDeleteOrganization();
  const syncBilling = useSyncOrgBilling();
  const [editing, setEditing] = useState<Organization | null>(null);
  // Separate from `editing` because the dialog uses org===null to mean CREATE —
  // so `editing` alone cannot distinguish "closed" from "creating".
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Organization | null>(null);
  // Privacy toggle: blur all monetary values (persisted so it survives reloads).
  const [amountsHidden, setAmountsHidden] = useState(() => {
    try {
      return localStorage.getItem('vrelly_admin_amounts_hidden') === 'true';
    } catch {
      return false;
    }
  });
  const toggleAmounts = () =>
    setAmountsHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('vrelly_admin_amounts_hidden', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const blurCls = amountsHidden ? 'blur-sm select-none' : '';

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

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (o: Organization) => {
    setEditing(o);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteOrg.mutateAsync(deleting.id);
      toast.success(`Deleted ${deleting.name}`);
      setDeleting(null);
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  // Exports REAL amounts even while the blur toggle is on: the toggle is
  // shoulder-surfing protection for the screen, not a permissions boundary, and
  // a CSV of blurred numbers would be useless. Superadmin-only either way.
  const handleExport = () => {
    const rows = orgs ?? [];
    if (rows.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    downloadCsv(organizationsToCsv(rows));
    toast.success(`Exported ${rows.length} organization${rows.length !== 1 ? 's' : ''}`);
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
      {/* Roll-up — only the MRR money figure blurs; counts never do. */}
      <div className="grid grid-cols-3 gap-3">
        <Rollup label="Total MRR (active)" value={money(rollup.mrr)} strong blurValue={blurCls} />
        <Rollup label="Active" value={String(rollup.active)} />
        <Rollup label="Inactive" value={String(rollup.inactive)} />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {list.length} organization{list.length !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleAmounts}
            title={amountsHidden ? 'Show amounts' : 'Hide amounts'}
          >
            {amountsHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={list.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={handleSync} disabled={syncBilling.isPending}>
            {syncBilling.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync billing
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add organization
          </Button>
        </div>
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
                  No organizations yet.{' '}
                  <button className="underline hover:text-foreground" onClick={openCreate}>
                    Add the first one
                  </button>
                  .
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
                        <span className={blurCls}>{money(effectiveMonthlyCents(o))}</span>
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
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(o)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(o)}
                          title="Delete"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <EditOrgDialog
        org={editing}
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
      />

      {/* Hard delete with no cascade and no soft-delete column — unrecoverable,
          so it is confirmed by name rather than fired straight from the icon. */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deleting?.name}</strong> and its billing
              links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteOrg.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleteOrg.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteOrg.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Rollup({
  label,
  value,
  strong,
  blurValue,
}: {
  label: string;
  value: string;
  strong?: boolean;
  blurValue?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`${strong ? 'text-2xl font-bold' : 'text-2xl font-semibold'} mt-1 ${blurValue ?? ''}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
