create table if not exists public.platform_stats_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  platform text not null check (platform in ('smartlead','reply.io','heyreach','other')),
  account_label text not null,
  scope text not null default 'account' check (scope in ('account','team','user','campaign')),
  external_team_id text,
  external_user_id text,
  period text not null default 'all_time',
  period_start date,
  period_end date,
  contacts_reached integer,
  email_contacts integer,
  li_contacts integer,
  emails_sent integer,
  emails_delivered integer,
  li_messages_sent integer,
  li_connections_sent integer,
  li_connections_accepted integer,
  replies integer,
  email_replies integer,
  li_replies integer,
  interested integer,
  not_interested integer,
  ooo integer,
  extra jsonb not null default '{}'::jsonb,
  source text not null default 'api',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists platform_stats_snapshots_lookup_idx
  on public.platform_stats_snapshots (platform, account_label, period, snapshot_at desc);
alter table public.platform_stats_snapshots enable row level security;
create policy "Platform admins can read platform stats" on public.platform_stats_snapshots
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));
create policy "Service role full access" on public.platform_stats_snapshots
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
comment on table public.platform_stats_snapshots is 'Point-in-time platform API totals per outbound account (moat / inference baseline). Admin-only read.';
