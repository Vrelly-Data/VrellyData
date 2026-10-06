-- Admin → Inference Insights
-- 1) inference_deductions: deductions written by admins, or auto-suggested from reply
--    data and accepted/rejected. Admin-only (platform/super admins), every operation.
-- 2) Realtime for the Live Feed: add public.inference_events to supabase_realtime.
--    Realtime evaluates the subscriber's RLS, so only rows the viewer can already
--    SELECT are delivered.

create table if not exists public.inference_deductions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  segment_filter jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'suggested' check (status in ('suggested', 'accepted', 'rejected')),
  -- Stable key of an auto-suggested segment, so an accepted or rejected suggestion is
  -- not suggested again. NULL for hand-written deductions.
  suggestion_key text unique,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inference_deductions_status_created_idx
  on public.inference_deductions (status, created_at desc);

alter table public.inference_deductions enable row level security;

drop policy if exists "Platform admins can read deductions" on public.inference_deductions;
create policy "Platform admins can read deductions" on public.inference_deductions
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));

drop policy if exists "Platform admins can create deductions" on public.inference_deductions;
create policy "Platform admins can create deductions" on public.inference_deductions
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));

drop policy if exists "Platform admins can update deductions" on public.inference_deductions;
create policy "Platform admins can update deductions" on public.inference_deductions
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));

drop policy if exists "Platform admins can delete deductions" on public.inference_deductions;
create policy "Platform admins can delete deductions" on public.inference_deductions
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));

drop trigger if exists update_inference_deductions_updated_at on public.inference_deductions;
create trigger update_inference_deductions_updated_at
  before update on public.inference_deductions
  for each row execute function public.update_updated_at_column();

comment on table public.inference_deductions is
  'Admin → Inference: deductions about which segments/copy/timing convert, with the segment filter and evidence they were based on. Admin-only.';

-- Realtime for the Live Feed. Guarded: environments without inference_events (dev) skip it,
-- and re-running is a no-op.
do $$
begin
  if to_regclass('public.inference_events') is not null
     and exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inference_events'
     ) then
    alter publication supabase_realtime add table public.inference_events;
  end if;
end
$$;
