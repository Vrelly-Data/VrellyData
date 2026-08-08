import type { Organization } from '@/hooks/useOrganizations';

// CSV export for Admin -> Organizations.
//
// Quoting is RFC 4180, not a naive join: `notes` is free text and routinely
// contains commas, quotes and newlines, any of which silently corrupts the
// column alignment of an unquoted file — and a corrupted export looks like a
// successful one. A field is quoted whenever it contains a comma, a quote, CR
// or LF, and embedded quotes are doubled.
function escapeCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Amounts are emitted as decimal dollars rather than the raw cents the column
// stores, since the export is read by humans and spreadsheets. Blank (not 0)
// when unset — 0 is a real amount here (the 100%-off-coupon case) and must not
// be conflated with "unknown".
const dollars = (cents: number | null): string =>
  cents == null ? '' : (cents / 100).toFixed(2);

// Every column on the table, in schema order, including the CRM fields added by
// 20260807120000. `effective_monthly` is derived, not stored: it mirrors the
// Monthly column in the UI (manual override wins over Stripe).
const COLUMNS: ReadonlyArray<readonly [header: string, get: (o: Organization) => unknown]> = [
  ['id', (o) => o.id],
  ['name', (o) => o.name],
  ['contact_name', (o) => o.contact_name],
  ['contact_email', (o) => o.contact_email],
  ['contact_phone', (o) => o.contact_phone],
  ['first_name', (o) => o.first_name],
  ['last_name', (o) => o.last_name],
  ['linkedin_url', (o) => o.linkedin_url],
  ['domain', (o) => o.domain],
  ['notes', (o) => o.notes],
  ['is_active', (o) => (o.is_active ? 'true' : 'false')],
  ['billing_date', (o) => o.billing_date],
  ['manual_monthly', (o) => dollars(o.manual_monthly_cents)],
  ['stripe_monthly', (o) => dollars(o.stripe_monthly_cents)],
  ['effective_monthly', (o) => dollars(o.manual_monthly_cents ?? o.stripe_monthly_cents)],
  ['monthly_source', (o) =>
    o.manual_monthly_cents != null ? 'manual' : o.stripe_monthly_cents != null ? 'stripe' : 'none'],
  ['stripe_customer_id', (o) => o.stripe_customer_id],
  ['stripe_subscription_id', (o) => o.stripe_subscription_id],
  ['stripe_synced_at', (o) => o.stripe_synced_at],
  ['user_id', (o) => o.user_id],
  ['created_at', (o) => o.created_at],
  ['updated_at', (o) => o.updated_at],
];

export function organizationsToCsv(orgs: readonly Organization[]): string {
  const header = COLUMNS.map(([h]) => escapeCell(h)).join(',');
  const rows = orgs.map((o) => COLUMNS.map(([, get]) => escapeCell(get(o))).join(','));
  // CRLF per RFC 4180; Excel is the likeliest consumer.
  return [header, ...rows].join('\r\n');
}

export function csvFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `organizations-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

export function downloadCsv(csv: string, filename = csvFilename(new Date())): void {
  // BOM so Excel reads it as UTF-8 rather than mangling accented names.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
