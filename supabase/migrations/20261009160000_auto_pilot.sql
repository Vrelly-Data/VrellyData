-- Auto Pilot (agent_configs.mode = 'auto'): daily cap + visible outcomes.
--
-- 1. agent_configs.auto_send_daily_cap (default 25). Auto Pilot counts its own
--    sends today (agent_activity 'message_sent' with metadata.sent_by = 'auto',
--    written by the senders themselves, UTC day) and holds every further reply
--    as draft_ready once the cap is reached. 0 = Auto Pilot sends nothing.
--    idx_agent_activity_user (user_id, created_at desc) serves the count.
--
-- 2. agent_activity gains two activity types so Auto Pilot's outcomes are on
--    the record instead of in function logs only:
--      auto_send_failed — the sender refused or errored; metadata.error holds
--                         its message; the lead stays draft_ready.
--      auto_send_held   — Auto Pilot deliberately did not send (cap reached,
--                         reply older than 24h, already answered, opted out,
--                         unknown source, ...); metadata.reason says which.
--    Before this, a failed auto-send was fire-and-forget and left no trace.

alter table public.agent_configs
  add column if not exists auto_send_daily_cap integer not null default 25;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_configs'::regclass
                   and conname = 'agent_configs_auto_send_daily_cap_check') then
    alter table public.agent_configs
      add constraint agent_configs_auto_send_daily_cap_check check (auto_send_daily_cap >= 0);
  end if;
end $$;

comment on column public.agent_configs.auto_send_daily_cap is
  'Most replies Auto Pilot (mode = ''auto'') may send per UTC day; further replies are held as draft_ready. 0 = send nothing.';

-- Widen the CHECK: same list as before plus the two new types.
alter table public.agent_activity drop constraint if exists agent_activity_activity_type_check;
alter table public.agent_activity
  add constraint agent_activity_activity_type_check check (activity_type = any (array[
    'contact_added', 'reply_received', 'draft_created', 'message_approved', 'message_sent',
    'lead_stage_changed', 'campaign_routed', 'agent_run_completed', 'agent_paused',
    'agent_resumed', 'draft_edited', 'learning_added',
    'auto_send_failed', 'auto_send_held'
  ]));
