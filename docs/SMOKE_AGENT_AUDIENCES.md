### Agent Audience scheduler — smoke checks

Run these in any environment to verify scheduled dispatch works and names render correctly.

- Dispatcher dry-run (no spend, no enrolment). Requires the environment’s `x-agent-key`:

```bash
SUPABASE_URL=https://<your>.supabase.co \
AGENT_KEY=<agent_api_key> \
node scripts/test-dispatch-agent-audiences.mjs
```

Expected: HTTP 200 with a JSON body like:

```json
{ "success": true, "armed": 1, "dispatched": 0, "auto_paused": 0, "dry_run": true, "would_dispatch": [ ... ] }
```

- Cron job present and green (database console):

```sql
select jobname, schedule, command
  from cron.job
 where jobname = 'dispatch-agent-audiences-hourly';
```

- Real HTTP status for recent runs (cron only records queueing, not HTTP):

```sql
select status_code, created, left(content, 300) as body
  from net._http_response
 where created > now() - interval '2 hours'
   and content like '%armed%'
 order by created desc;
```

- UI: Agent → Audience table shows destination campaign names for rows with a default destination, without opening the edit form. Toggle an audience Active only after at least one successful manual run; scheduling will then pick it up on the next hourly sweep according to cadence (daily/weekly/monthly).

