-- Ensure the Agent Audience dispatcher is scheduled for all environments.
--
-- This migration (re)creates an hourly pg_cron job that POSTs to the
-- dispatch-agent-audiences Edge Function with the correct x-agent-key.
--
-- Reliability goals:
-- - Works on any environment without editing hardcoded URLs in-source
-- - Prefer Vault for the header (no secrets embedded in cron.job)
-- - Idempotent: unschedules any previous copy first
-- - Falls back to copying a known-good job if Vault is unavailable
--
-- WHY NOT PER-AUDIENCE CRONS. Each audience has a cadence (daily/weekly/
-- monthly); a single hourly sweep is granular enough and avoids unbounded
-- growth in cron jobs as tenants create audiences.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  base_url text;
  have_vault boolean;
  copied_command text;
begin
  -- Learn the correct environment host from any existing working job.
  -- Avoids hardcoding production or development hosts in-source.
  with src as (
    select command
      from cron.job
     where jobname in ('poll-reply-inbox-15min',
                       'poll-smartlead-inbox-hourly',
                       'poll-phoneburner-calls-30min')
     order by case jobname
       when 'poll-reply-inbox-15min' then 1
       when 'poll-smartlead-inbox-hourly' then 2
       else 3
     end
     limit 1
  )
  select substring(command from $re$url\\s*:=\\s*'(https?://[^']+)/functions/v1/$re$)
    into base_url
    from src;

  select exists (
    select 1 from pg_catalog.pg_namespace n
    join pg_catalog.pg_class c on c.relnamespace = n.oid
    where n.nspname = 'vault'
      and exists (select 1 from vault.decrypted_secrets where name = 'agent_api_key')
  ) into have_vault;

  -- Remove any existing schedule (idempotent re-run).
  if exists (select 1 from cron.job where jobname = 'dispatch-agent-audiences-hourly') then
    perform cron.unschedule('dispatch-agent-audiences-hourly');
  end if;

  if have_vault and base_url is not null then
    -- Preferred path: schedule using Vault to resolve x-agent-key at runtime.
    perform cron.schedule(
      'dispatch-agent-audiences-hourly',
      '0 * * * *',
      format($cron$
        select net.http_post(
          url := %L || '/functions/v1/dispatch-agent-audiences',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-agent-key', (select decrypted_secret
                              from vault.decrypted_secrets
                             where name = 'agent_api_key'
                             limit 1)
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 120000
        );
      $cron$, base_url)
    );
    return;
  end if;

  -- Fallback: copy a known-good job's command, swapping the function name.
  -- This preserves whatever literal x-agent-key that job uses today.
  select replace(command, 'poll-reply-inbox', 'dispatch-agent-audiences')
    into copied_command
    from cron.job
   where jobname = 'poll-reply-inbox-15min';

  if copied_command is not null then
    perform cron.schedule('dispatch-agent-audiences-hourly', '0 * * * *', copied_command);
    return;
  end if;

  -- Last resort: fail loudly so the operator can wire it by hand with the
  -- environment's correct host and header.
  raise exception
    'Cannot schedule dispatch-agent-audiences: no Vault secret and no template cron job found. Schedule manually with the same URL and x-agent-key as your working pollers.';
end $$;

