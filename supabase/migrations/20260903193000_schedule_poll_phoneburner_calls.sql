-- Schedule poll-phoneburner-calls on a conservative interval.
--
-- Mirrors the approach used by schedule_poll_smartlead_inbox.sql: copy the
-- existing poll-reply-inbox job's HTTP command (preserves the working URL +
-- x-agent-key header) and swap the function path. Avoids committing live
-- credentials and avoids guessing at per-env keys.
--
-- Interval: every 30 minutes. PhoneBurner sessions are durable and inbox spam
-- risk is low (additive-only), but there's no webhook in MVP so poll must run.

do $sched$
declare
  tmpl text;
begin
  select replace(command, 'poll-reply-inbox', 'poll-phoneburner-calls')
    into tmpl
    from cron.job
   where jobname = 'poll-reply-inbox-15min';

  if tmpl is null then
    raise exception
      'Cannot schedule poll-phoneburner-calls: template job poll-reply-inbox-15min not found. Schedule manually with the same URL + x-agent-key header the other pollers use.';
  end if;

  if exists (select 1 from cron.job where jobname = 'poll-phoneburner-calls-30min') then
    perform cron.unschedule('poll-phoneburner-calls-30min');
  end if;

  perform cron.schedule('poll-phoneburner-calls-30min', '*/30 * * * *', tmpl);
end
$sched$;

