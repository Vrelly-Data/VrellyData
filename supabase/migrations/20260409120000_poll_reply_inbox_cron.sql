SELECT cron.schedule(
  'poll-reply-inbox-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lgnvolndyftsbcjprmic.supabase.co/functions/v1/poll-reply-inbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-key', 'xokfyb-Jurpyd-8muwgu'
    ),
    body := '{}'::jsonb
  );
  $$
);
