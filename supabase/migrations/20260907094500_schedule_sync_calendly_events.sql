-- Schedule sync-calendly-events on a frequent interval (10 minutes).
--
-- Mirrors the vault-based cron pattern used by poll-phoneburner-calls:
--   - Uses Vault to resolve the x-agent-key header at runtime
--   - Explicit POST body with a conservative lookback window
--   - Explicit timeout
--
-- Target (production):
--   https://lgnvolndyftsbcjprmic.supabase.co/functions/v1/sync-calendly-events
--
-- Verification (on prod):
--   DO NOT rely on cron.job_run_details alone — it only records that net.http_post
--   QUEUED. Inspect the actual HTTP responses via net._http_response shortly
--   after a run:
--
--     select status_code, created, left(content, 300)
--       from net._http_response
--      where url like '%/functions/v1/sync-calendly-events'
--   order by created desc
--      limit 5;
--
-- A 200 with a JSON body like:
--   {"success":true,"mode":"multi","integrationsProcessed":N,"eventsUpserted":X,"inferenceWritten":Y,...}
-- confirms the job is running correctly. A 401 means the copied key is wrong for
-- this project; re‑register the job with the correct header.

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
      'vault.decrypted_secrets entry "agent_api_key" is missing; cannot schedule sync-calendly-events.';
  end if;
end $$;

-- Unschedule prior version if present (idempotent)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-calendly-events-10min') then
    perform cron.unschedule('sync-calendly-events-10min');
  end if;
end $$;

-- Schedule: every 10 minutes (within the 5–15 minute guidance).
select cron.schedule(
  'sync-calendly-events-10min',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lgnvolndyftsbcjprmic.supabase.co/functions/v1/sync-calendly-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-key', (select decrypted_secret
                        from vault.decrypted_secrets
                       where name = 'agent_api_key'
                       limit 1)
    ),
    body := jsonb_build_object('lookbackDays', 7),
    timeout_milliseconds := 180000
  );
  $cron$
);

