-- Schedule sync-calendly-events every 10 minutes, authenticated via Vault.
--
-- Behavior:
-- - Calls the Edge Function without a JWT, using x-agent-key from Vault
-- - Triggers the multi-integration path (no integrationId in body)
-- - MATCH-ONLY semantics are enforced by the function; strictly additive
--
-- Why Vault: mirrors poll-phoneburner-calls reschedule (PR #35) to avoid
-- hardcoding secrets. Header is resolved at runtime from vault.decrypted_secrets.
--
-- Idempotent:
-- - Validates the Vault secret exists (fails loudly if missing)
-- - Derives the correct per-environment base URL from an existing working cron
--   job (prefers poll-reply-inbox-15min), so this migration is safe for prod
--   and dev without editing URLs in-source.
-- - Unschedules any prior copy named sync-calendly-events-10min before creating.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  base_url text;
begin
  -- Guard: ensure the Vault secret is present
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'agent_api_key'
  ) then
    raise exception
      'vault.decrypted_secrets entry "agent_api_key" is missing; cannot schedule sync-calendly-events.';
  end if;

  -- Prefer to learn the environment host from a known-good job (no hardcoding).
  with src as (
    select command
      from cron.job
     where jobname in ('poll-reply-inbox-15min', 'poll-smartlead-inbox-hourly', 'poll-phoneburner-calls-30min')
     order by case jobname
       when 'poll-reply-inbox-15min' then 1
       when 'poll-smartlead-inbox-hourly' then 2
       else 3
     end
     limit 1
  )
  select substring(command from $$url\\s*:=\\s*'(https?://[^']+)/functions/v1/$$)
    into base_url
    from src;

  if base_url is null then
    raise exception
      'Cannot schedule sync-calendly-events: no template cron job found to derive base URL. Schedule manually with the correct environment host and Vault-based x-agent-key.';
  end if;

  -- Unschedule any previous job (idempotent)
  if exists (select 1 from cron.job where jobname = 'sync-calendly-events-10min') then
    perform cron.unschedule('sync-calendly-events-10min');
  end if;

  -- Schedule with Vault header and a conservative timeout
  perform cron.schedule(
    'sync-calendly-events-10min',
    '*/10 * * * *',
    format($cron$
      select net.http_post(
        url := %L || '/functions/v1/sync-calendly-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-agent-key', (select decrypted_secret
                            from vault.decrypted_secrets
                           where name = 'agent_api_key'
                           limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 180000
      );
    $cron$, base_url)
  );
end $$;

