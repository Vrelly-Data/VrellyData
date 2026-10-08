-- Capture Scope on every platform (Reply.io, Smartlead, HeyReach).
--
-- 1) outbound_integrations.auto_capture_new_campaigns — integration-level
--    default for campaigns discovered by a sync. TRUE everywhere except
--    SourceCo's Smartlead and HeyReach integrations, which deliberately
--    capture a hand-picked subset.
-- 2) synced_campaigns_capture_default — BEFORE INSERT trigger that sets
--    capture_enabled from that setting. INSERT only: syncs no longer send
--    capture_enabled at all, so an UPDATE (every later sync) never touches it.
--    One rule for every sync path and any future platform.
-- 3) capture_scope_skips — one row per (integration, campaign, contact) whose
--    reply was dropped because the campaign was not capture-enabled, so a
--    drop is never silent. Written only by edge functions (service role) via
--    record_capture_scope_skips(); readable by the owning team and platform
--    admins.
-- 4) synced_campaigns.capture_skip_probe_at — rotation cursor for the bounded
--    Smartlead / HeyReach probe of capture-off campaigns (those pollers ask
--    the vendor for capture-enabled campaigns only, so without the probe they
--    never see a dropped reply).

-- ── 1) integration-level default ────────────────────────────────────────────
alter table public.outbound_integrations
  add column if not exists auto_capture_new_campaigns boolean not null default true;

comment on column public.outbound_integrations.auto_capture_new_campaigns is
  'Capture Scope: capture_enabled given to a campaign when a sync first inserts it. Never applied to existing campaigns.';

-- SourceCo captures a deliberate subset on Smartlead and HeyReach. Matched by
-- id (prod); a no-op wherever these integrations do not exist.
update public.outbound_integrations
set auto_capture_new_campaigns = false
where id in (
  'd829cac9-7a50-410f-a28e-1edfaa6edb23', -- SourceCo, smartlead
  'f860cf2e-2cec-4cfc-a953-90c85fdb328a'  -- SourceCo<>Vrelly, heyreach
);

-- ── 2) new-campaign default, INSERT only ────────────────────────────────────
-- Interim Reply.io-only default, if one was ever created by hand.
drop trigger if exists synced_campaigns_reply_io_capture_default on public.synced_campaigns;
drop function if exists public.synced_campaigns_reply_io_capture_default();

create or replace function public.synced_campaigns_capture_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean;
begin
  select oi.auto_capture_new_campaigns into v_auto
  from public.outbound_integrations oi
  where oi.id = new.integration_id;
  -- No integration row: keep whatever the insert carried (column default).
  if found then
    new.capture_enabled := v_auto;
  end if;
  return new;
end;
$$;

drop trigger if exists synced_campaigns_capture_default on public.synced_campaigns;
create trigger synced_campaigns_capture_default
  before insert on public.synced_campaigns
  for each row execute function public.synced_campaigns_capture_default();

comment on function public.synced_campaigns_capture_default() is
  'Capture Scope: a newly inserted synced_campaigns row takes capture_enabled from outbound_integrations.auto_capture_new_campaigns. Upserts that hit an existing row do not change capture_enabled (syncs never send the column).';

-- ── 3) skipped replies ──────────────────────────────────────────────────────
create table if not exists public.capture_scope_skips (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.outbound_integrations(id) on delete cascade,
  team_id uuid not null,
  platform text not null,
  campaign_external_id text not null,
  campaign_name text,
  -- Stable contact identity: lowercased email, else LinkedIn URL, else the
  -- provider's thread/conversation id.
  contact_key text not null,
  contact_email text,
  contact_linkedin_url text,
  contact_name text,
  -- Latest reply time seen for this contact on this campaign.
  occurred_at timestamptz not null,
  -- Why capture skipped it: capture_disabled | no_synced_row.
  reason text not null default 'capture_disabled',
  -- Which path observed it (poll-reply-inbox, reply-webhook, smartlead-probe…).
  source text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when a recapture was requested for this campaign after the skip; a
  -- later skip (newer reply) clears it again.
  recaptured_at timestamptz,
  unique (integration_id, campaign_external_id, contact_key)
);

create index if not exists capture_scope_skips_campaign_idx
  on public.capture_scope_skips (integration_id, campaign_external_id, occurred_at desc);
create index if not exists capture_scope_skips_recent_idx
  on public.capture_scope_skips (occurred_at desc);

alter table public.capture_scope_skips enable row level security;

drop policy if exists "Team members can read their capture skips" on public.capture_scope_skips;
create policy "Team members can read their capture skips" on public.capture_scope_skips
  for select to authenticated
  using (team_id = public.get_user_team_id(auth.uid()));

drop policy if exists "Platform admins can read all capture skips" on public.capture_scope_skips;
create policy "Platform admins can read all capture skips" on public.capture_scope_skips
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));

comment on table public.capture_scope_skips is
  'Capture Scope: replies dropped because their campaign was not capture-enabled. One row per integration + campaign + contact. Written by edge functions only.';

-- Batch upsert used by every poller / webhook. Keeps the NEWEST occurred_at,
-- refreshes name/source/last_seen_at, and clears recaptured_at when a newer
-- reply was skipped after a recapture. Service role only.
create or replace function public.record_capture_scope_skips(p_rows jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with incoming as (
    select distinct on (integration_id, campaign_external_id, contact_key) *
    from jsonb_to_recordset(p_rows) as r(
      integration_id uuid, team_id uuid, platform text, campaign_external_id text,
      campaign_name text, contact_key text, contact_email text, contact_linkedin_url text,
      contact_name text, occurred_at timestamptz, reason text, source text
    )
    where integration_id is not null and team_id is not null
      and nullif(trim(campaign_external_id), '') is not null
      and nullif(trim(contact_key), '') is not null
    order by integration_id, campaign_external_id, contact_key, occurred_at desc nulls last
  ), upserted as (
    insert into public.capture_scope_skips as s (
      integration_id, team_id, platform, campaign_external_id, campaign_name, contact_key,
      contact_email, contact_linkedin_url, contact_name, occurred_at, reason, source
    )
    select integration_id, team_id, platform, trim(campaign_external_id), campaign_name, trim(contact_key),
      contact_email, contact_linkedin_url, contact_name, coalesce(occurred_at, now()),
      coalesce(reason, 'capture_disabled'), coalesce(source, 'unknown')
    from incoming
    on conflict (integration_id, campaign_external_id, contact_key) do update set
      campaign_name = coalesce(excluded.campaign_name, s.campaign_name),
      contact_email = coalesce(excluded.contact_email, s.contact_email),
      contact_linkedin_url = coalesce(excluded.contact_linkedin_url, s.contact_linkedin_url),
      contact_name = coalesce(excluded.contact_name, s.contact_name),
      reason = excluded.reason,
      source = excluded.source,
      last_seen_at = now(),
      recaptured_at = case when excluded.occurred_at > s.occurred_at then null else s.recaptured_at end,
      occurred_at = greatest(s.occurred_at, excluded.occurred_at)
    returning 1
  )
  select count(*)::int from upserted;
$$;

revoke all on function public.record_capture_scope_skips(jsonb) from public, anon, authenticated;
grant execute on function public.record_capture_scope_skips(jsonb) to service_role;

-- ── 4) probe rotation cursor ────────────────────────────────────────────────
alter table public.synced_campaigns
  add column if not exists capture_skip_probe_at timestamptz;

comment on column public.synced_campaigns.capture_skip_probe_at is
  'Capture Scope: last time a poller probed this capture-off campaign for skipped replies (rotation cursor).';

-- ── 5) admin alert ──────────────────────────────────────────────────────────
-- Admin → Inference → Live Feed shows an alert row when any team had replies
-- skipped by Capture Scope recently. Team and integration names are not
-- readable across teams under RLS, so this admin-gated function returns only
-- the per-team aggregate. Non-admins get an empty list.
create or replace function public.admin_capture_scope_skip_alerts(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.skipped desc), '[]'::jsonb)
  from (
    select
      s.team_id,
      t.name as team_name,
      s.integration_id,
      oi.name as integration_name,
      s.platform,
      count(*)::int as skipped,
      count(distinct s.campaign_external_id)::int as campaigns,
      max(s.occurred_at) as last_reply_at,
      max(s.first_seen_at) as last_detected_at
    from public.capture_scope_skips s
    left join public.teams t on t.id = s.team_id
    left join public.outbound_integrations oi on oi.id = s.integration_id
    where s.first_seen_at >= now() - make_interval(hours => greatest(1, least(p_hours, 336)))
      and s.recaptured_at is null
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)
      )
    group by s.team_id, t.name, s.integration_id, oi.name, s.platform
  ) x;
$$;

revoke all on function public.admin_capture_scope_skip_alerts(integer) from public, anon;
grant execute on function public.admin_capture_scope_skip_alerts(integer) to authenticated, service_role;
