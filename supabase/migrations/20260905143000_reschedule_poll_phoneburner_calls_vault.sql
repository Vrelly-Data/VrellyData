-- Reschedule poll-phoneburner-calls to use Vault-based auth and explicit POST body.
--
-- Changes applied by this migration:
-- - Unschedules any existing 'poll-phoneburner-calls-30min' job
-- - Reschedules it to:
--     URL: https://lgnvolndyftsbcjprmic.supabase.co/functions/v1/poll-phoneburner-calls
--     Method: POST
--     Body: {"lookbackDays": 2}
--     Headers:
--       - Content-Type: application/json
--       - x-agent-key: loaded from vault.decrypted_secrets where name = 'agent_api_key'
--     Timeout: 180000 ms
--     Schedule: */30 * * * *
--
-- Notes:
-- - No secrets are hardcoded; the header is resolved at runtime from Vault.
-- - This is additive and does not alter any agent_leads columns or send paths.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  -- Ensure the required Vault secret exists to avoid silently scheduling a broken job.
  if not exists (
    select 1
      from vault.decrypted_secrets
     where name = 'agent_api_key'
  ) then
    raise exception
      'vault.decrypted_secrets entry "agent_api_key" is missing; cannot schedule poll-phoneburner-calls.';
  end if;
end $$;

-- Unschedule any prior version (idempotent)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'poll-phoneburner-calls-30min') then
    perform cron.unschedule('poll-phoneburner-calls-30min');
  end if;
end $$;

-- Schedule the vault-based job
select cron.schedule(
  'poll-phoneburner-calls-30min',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgnvolndyftsbcjprmic.supabase.co/functions/v1/poll-phoneburner-calls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-key', (select decrypted_secret
                        from vault.decrypted_secrets
                       where name = 'agent_api_key'
                       limit 1)
    ),
    body := jsonb_build_object('lookbackDays', 2),
    timeout_milliseconds := 180000
  );
  $cron$
);

