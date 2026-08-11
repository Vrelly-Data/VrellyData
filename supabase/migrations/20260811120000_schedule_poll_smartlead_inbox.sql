-- Schedule poll-smartlead-inbox.
--
-- WHY THIS EXISTS. Smartlead only ever fires EMAIL_REPLY — the only event type
-- setup-smartlead-webhook registers, and (verified against webhook_events) the
-- only one ever received in production. An outbound sent directly in
-- Smartlead's UI, whether by a human or by Smartlead's own "Reply Agent" AI,
-- produces no event we subscribe to. smartlead-webhook picks such messages up
-- only as a side effect — it refetches full history on the next INBOUND — so a
-- reply sent after the last inbound stays invisible indefinitely. On SourceCo
-- that left 61 leads showing a prospect reply and no answer, while zero replies
-- had ever been sent through Vrelly.
--
-- WHY HOURLY, NOT */15 LIKE THE OTHER TWO POLLERS. poll-reply-inbox and
-- poll-heyreach-inbox each start from an activity-ordered LIST endpoint, so one
-- cheap call reveals what changed. Smartlead exposes no such list —
-- message-history is per-lead only — so cost is one HTTP call per lead with no
-- way to ask "what changed?". At */15 with a 7-day window that is ~4,700 calls
-- a day to re-read conversations that mostly have not moved. The harm being
-- fixed (a stale draft offered on an already-answered thread) tolerates an hour
-- of lag. Tighten later if it proves painful; do not start there.
--
-- WHY THE COMMAND IS COPIED FROM AN EXISTING JOB RATHER THAN WRITTEN OUT.
-- Both live pollers post to a literal URL with a hardcoded x-agent-key, and
-- both carry the SAME key. Note that 20260506210000_schedule_poll_heyreach_inbox
-- describes a current_setting('app.*') GUC pattern instead — that file was never
-- applied: neither app.supabase_url nor app.agent_api_key exists on prod or dev
-- (checked pg_db_role_setting for role- and database-scoped settings), so a job
-- built that way would raise on every run. Copying the command from a job that
-- is demonstrably succeeding (96/96 runs in the last 24h) avoids both writing a
-- live credential into version control and guessing at a key that may rotate.
--
-- Idempotent: unschedules any prior copy first, and fails loudly rather than
-- silently scheduling a broken job if the template is missing.

DO $sched$
DECLARE
  tmpl text;
BEGIN
  SELECT replace(command, 'poll-heyreach-inbox', 'poll-smartlead-inbox')
    INTO tmpl
    FROM cron.job
   WHERE jobname = 'poll-heyreach-inbox-every-15min';

  IF tmpl IS NULL THEN
    RAISE EXCEPTION
      'Cannot schedule poll-smartlead-inbox: template job poll-heyreach-inbox-every-15min not found. Schedule it manually with the same URL + x-agent-key header the other pollers use.';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-smartlead-inbox-hourly') THEN
    PERFORM cron.unschedule('poll-smartlead-inbox-hourly');
  END IF;

  PERFORM cron.schedule('poll-smartlead-inbox-hourly', '0 * * * *', tmpl);
END
$sched$;
