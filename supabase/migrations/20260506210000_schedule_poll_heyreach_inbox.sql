-- Schedule poll-heyreach-inbox to run every 15 minutes as a backstop
-- for HeyReach webhook deliveries that may be silently dropped.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Unschedule existing job if present (idempotent re-runs)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'poll-heyreach-inbox-every-15min') then
    perform cron.unschedule('poll-heyreach-inbox-every-15min');
  end if;
end $$;

-- Schedule polling every 15 minutes
select cron.schedule(
  'poll-heyreach-inbox-every-15min',
  '*/15 * * * *',
  $cron$
  -- Use the same GUC convention as auto-sync-campaigns / auto-sync-contacts
  -- (current_setting('app.agent_api_key')). The earlier vault-based source
  -- silently produced a NULL header when no matching vault secret existed,
  -- which the edge function rejected as 401 with no log output — leaving
  -- HeyReach replies stranded in the Unibox.
  select net.http_post(
    url := current_setting('app.supabase_url') ||
           '/functions/v1/poll-heyreach-inbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-key', current_setting('app.agent_api_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
