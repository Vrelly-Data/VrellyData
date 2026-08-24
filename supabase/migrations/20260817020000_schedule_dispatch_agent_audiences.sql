-- Schedule dispatch-agent-audiences, hourly.
--
-- WHAT THIS ACTUALLY ARMS, stated plainly: nothing, yet. The job calls
-- dispatch-agent-audiences, which selects
--     is_active = true AND cadence <> 'manual'
-- and does nothing else. is_active defaults FALSE, no code path in this repo
-- writes it, and agent_audiences_guard_activation rejects the false->true
-- transition unless a run has already completed with status='success'. With
-- zero armed audiences the function selects zero rows and returns. Creating
-- this job therefore changes no behaviour until a human deliberately arms an
-- audience.
--
-- WHY HOURLY. Nothing here is latency-sensitive: cadences are daily and weekly,
-- so an hourly sweep is granular enough, and it keeps at most one dispatch pass
-- in flight. Per-audience cron jobs were considered and rejected — unmanageable,
-- and each new audience would need a migration.
--
-- WHY THE COMMAND IS COPIED FROM A RUNNING JOB rather than written out. The
-- live pollers post to a literal URL with a hardcoded x-agent-key. Copying from
-- a running job avoids writing a live credential into version control and
-- avoids guessing at a key that may rotate.
--
-- COPY FROM poll-reply-inbox-15min SPECIFICALLY — the keys are NOT all the
-- same. poll-heyreach-inbox carried a STALE key and had been 401ing on every
-- run, invisibly: cron.job_run_details records only that net.http_post QUEUED,
-- never the HTTP status, so it reported "succeeded" indefinitely. An earlier
-- migration derived from that job and inherited the dead key, producing a
-- poller that logged green cron runs while doing nothing. poll-reply-inbox is
-- the one demonstrably returning 200 with real payloads.
--
-- VERIFY WITH net._http_response, NOT cron.job_run_details:
--
--   select status_code, created, left(content, 300)
--     from net._http_response
--    where created > now() - interval '2 hours'
--      and content like '%armed%'
--    order by created desc;
--
-- A healthy first run returns HTTP 200 with
--   {"success":true,"armed":0,"dispatched":0,"auto_paused":0,"results":[]}
-- A 401 means the copied key is wrong for this project. Anything else, do not
-- assume the job is fine because cron.job_run_details says "succeeded".
--
-- TO DISABLE WITHOUT A MIGRATION:
--   update cron.job set active = false where jobname = 'dispatch-agent-audiences-hourly';

DO $sched$
DECLARE
  tmpl text;
BEGIN
  SELECT replace(command, 'poll-reply-inbox', 'dispatch-agent-audiences')
    INTO tmpl
    FROM cron.job
   WHERE jobname = 'poll-reply-inbox-15min';

  IF tmpl IS NULL THEN
    RAISE EXCEPTION
      'Cannot schedule dispatch-agent-audiences: template job poll-reply-inbox-15min not found. Schedule it manually with the same URL + x-agent-key header the other pollers use.';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-agent-audiences-hourly') THEN
    PERFORM cron.unschedule('dispatch-agent-audiences-hourly');
  END IF;

  PERFORM cron.schedule('dispatch-agent-audiences-hourly', '0 * * * *', tmpl);
END
$sched$;
