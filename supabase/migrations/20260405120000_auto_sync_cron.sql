-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Job 1: Auto-sync campaigns every hour
SELECT cron.schedule(
  'auto-sync-campaigns-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') ||
           '/functions/v1/auto-sync-integrations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-key', current_setting('app.agent_api_key')
    ),
    body := jsonb_build_object('scope', 'campaigns')
  );
  $$
);

-- Job 2: Auto-sync contacts every 6 hours
SELECT cron.schedule(
  'auto-sync-contacts-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') ||
           '/functions/v1/auto-sync-integrations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-key', current_setting('app.agent_api_key')
    ),
    body := jsonb_build_object('scope', 'full')
  );
  $$
);
