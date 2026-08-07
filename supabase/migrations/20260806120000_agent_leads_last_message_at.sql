-- agent_leads.last_message_at — the newest message in EITHER direction.
--
-- WHY
-- ---
-- Total Inbox ordered by updated_at (get-agent-inbox, since 0313fef). That was
-- chosen because a Send Reply bumps updated_at via the updated_at triggers while
-- leaving last_reply_at alone — but updated_at is a ROW-TOUCH timestamp, not a
-- message timestamp. poll-reply-inbox runs on cron '*/15' and writes
-- `updated_at: nowIso` explicitly in its payload (index.ts:461), so every sweep
-- re-stamps every thread it walks whether or not anything changed. Ordering
-- therefore reflects poll batches, not conversations: measured on Avania
-- Clinical, only 18/50 rows sat in the position a true last-message sort would
-- give them, with updated_at running a median 23.9h (max 75.4h) ahead of the
-- real message time.
--
-- NOTE ON agent_leads_skip_noop (verified against dev AND prod, 2026-08-06):
-- the repo's migrations create this trigger (20260412000001) and amend it four
-- times (20260413, 20260427120000, 20260429120000, 20260508120000), but it is
-- NOT ATTACHED on either database — the FUNCTION exists, the TRIGGER does not.
-- So no no-op suppression is running in either environment today, and the
-- re-stamping above is unconditional rather than merely unguarded. Reconciling
-- that drift is out of scope here; this migration only has to be correct in
-- both the drifted and the as-documented world, which is why the new trigger is
-- still named to sort last (§3).
--
-- Neither existing column can express "most recent message either direction":
--   last_reply_at — inbound only; no send path writes it.
--   updated_at    — every write, from any source, message or not.
-- reply_thread is the only place both directions land. All seven writers append
-- there with an ISO timestamp: send-agent-reply (both branches),
-- send-heyreach-message, send-smartlead-email, add-to-{heyreach,smartlead}-campaign,
-- plus the ingest paths. Deriving the column in a trigger therefore needs ZERO
-- edge-function changes to capture sends.
--
-- DATA SHAPE (verified against prod 2026-08-06, 13,661 thread elements / 2,729 leads)
-- ------------------------------------------------------------------------------
--   13,366  strict ISO-8601 with Z or ±hh:mm
--      295  valid but NO timezone, e.g. '2026-06-14T13:18:21.00' (55 leads, all
--           source=reply_io — poll-reply-inbox:440 stores Reply.io's m.date
--           verbatim and Reply.io sometimes omits the offset)
--        0  empty string / non-string / unparseable  <- nothing malformed today
--        7  role:'system' entries ("Added to campaign: …")
--
-- HARDENING (three deliberate choices below)
-- ------------------------------------------
-- 1. REGEX GUARD. Nothing malformed exists today, but this is a BEFORE trigger:
--    one bad value would abort the whole write for that row, not merely skew the
--    sort. poll-reply-inbox and reply-webhook both pass a third-party timestamp
--    straight through, so a future upstream change would silently stall ingest
--    for the affected lead on every subsequent poll. The guard is fully anchored
--    — a partial-prefix match would let trailing garbage through the filter and
--    then throw on the cast, which is the exact failure it exists to prevent.
--    Version-agnostic by choice: both environments are PG 17.6 so
--    pg_input_is_valid() would work today, but a regex keeps this migration
--    replayable against any future restore or branch on an older major.
-- 2. UTC PIN. `text::timestamptz` on an offset-less value resolves against the
--    session TimeZone. Both databases are set to UTC today, which is almost
--    certainly Reply.io's intent — but that is a session GUC, not a guarantee,
--    and a sort key must not silently depend on it. Offset-bearing values cast
--    directly; offset-less ones go through ::timestamp AT TIME ZONE 'UTC' so
--    the reading is pinned regardless. Verified on dev under a deliberately
--    non-UTC session: '2026-06-14T13:18:21.00' → 13:18:21 UTC pinned, vs
--    20:18:21 UTC for the bare cast — a 7-hour error this prevents.
-- 3. SYSTEM ENTRIES EXCLUDED. "Added to campaign: …" is a workflow breadcrumb,
--    not a message from either party, so it should not float a lead to the top
--    of the inbox. Currently a no-op in practice — both add-to-*-campaign
--    writers append the system entry alongside a role:'sender' entry carrying
--    the identical sentAtIso, and all 7 in prod are so paired — but it stops a
--    future unpaired system write from lying about conversation recency.
--
-- Run in dev, verify, then prod. NOTIFY at the end refreshes PostgREST's schema
-- cache so .order('last_message_at') resolves.

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

COMMENT ON COLUMN public.agent_leads.last_message_at IS
  'Newest message timestamp in either direction: MAX over reply_thread[] '
  '(excluding role=''system''), floored by last_reply_at then created_at. '
  'Maintained by zz_agent_leads_set_last_message_at — never write it directly.';

-- ---------------------------------------------------------------------------
-- 2. Derivation
--
-- STABLE, not IMMUTABLE: timestamptz_in is itself STABLE. The offset-less branch
-- is genuinely immutable (literal zone), but the offset-bearing branch is not,
-- and mislabelling would be a lie the planner is entitled to act on. We index
-- the STORED column, not this expression, so STABLE costs nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_leads_last_message_at(
  thread              jsonb,
  fallback_reply_at   timestamptz,
  fallback_created_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT GREATEST(
    (
      SELECT MAX(
               CASE
                 -- Has an explicit offset (Z or ±hh:mm) → unambiguous, cast direct.
                 WHEN m->>'timestamp' ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
                   THEN (m->>'timestamp')::timestamptz
                 -- No offset → read as UTC, never as session-local.
                 ELSE ((m->>'timestamp')::timestamp AT TIME ZONE 'UTC')
               END
             )
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(thread) = 'array' THEN thread ELSE '[]'::jsonb END
           ) AS m
      -- Fully anchored: date + time, optional fractional seconds, optional
      -- offset, and NOTHING else. Anything failing this is skipped, not cast.
      -- Also covers the safe-skip cases (missing key / JSON null / non-object
      -- element), where ->> yields NULL and the match is NULL → not true.
      WHERE m->>'timestamp' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})?$'
        AND COALESCE(m->>'role', '') <> 'system'
    ),
    fallback_reply_at,
    fallback_created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger
--
-- NAME MATTERS. Triggers of the same timing fire in ALPHABETICAL order.
-- agent_leads currently carries (both dev and prod, verified 2026-08-06):
--     agent_leads_updated_at          → update_updated_at()
--     update_agent_leads_updated_at   → update_updated_at_column()
-- and, per the repo's migrations though NOT actually attached today,
--     agent_leads_skip_noop_trigger   (cancels replays: NEW IS NOT DISTINCT FROM OLD)
-- A name sorting before skip_noop would write last_message_at onto NEW ahead of
-- that equality check, making NEW distinct from OLD on every replay and killing
-- the guard. The 'zz_' prefix keeps this firing LAST, so if and when the guard
-- is restored, genuine no-ops still cancel and nothing is recomputed for a row
-- that did not change. Costs nothing while the guard is absent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_leads_set_last_message_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.last_message_at := public.agent_leads_last_message_at(
    NEW.reply_thread, NEW.last_reply_at, NEW.created_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_agent_leads_set_last_message_at ON public.agent_leads;
CREATE TRIGGER zz_agent_leads_set_last_message_at
  BEFORE INSERT OR UPDATE ON public.agent_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_leads_set_last_message_at();

-- ---------------------------------------------------------------------------
-- 4. Backfill
--
-- Every updated_at trigger is DISABLED across the backfill. Without that, this
-- single UPDATE would re-stamp updated_at on every row in the table —
-- destroying the existing values and scrambling the Pipeline board and the
-- pending_approval secondary sort, both of which still order by updated_at.
--
-- Discovered dynamically rather than named, because agent_leads carries TWO
-- equivalent updated_at triggers on BOTH dev and prod (verified 2026-08-06):
--     agent_leads_updated_at        → public.update_updated_at()
--     update_agent_leads_updated_at → public.update_updated_at_column()
-- Both are BEFORE UPDATE FOR EACH ROW and both bodies reduce to
-- `NEW.updated_at = now(); RETURN NEW;` — identical but for whitespace.
--
-- PROVENANCE: not intentional. 20260402120000_create_agent_tables.sql created
-- agent_leads and its trigger. Ten days later 20260412000001_create_agent_leads.sql
-- was written as if from scratch — CREATE TABLE IF NOT EXISTS with a strictly
-- smaller column list — so the table creation no-op'd against the existing
-- table, but the trigger was added unconditionally under a new name. Its
-- `DROP TRIGGER IF EXISTS` guarded only its OWN name, never the incumbent, so
-- both survived. Harmless in effect (the second stamp overwrites the first with
-- the same now()), but it doubles the footgun: anyone suppressing "the
-- updated_at trigger" by name silently suppresses only half of it — which is
-- exactly the bug the first draft of this migration shipped with.
--
-- Naming just one would therefore leave the other stamping, which is the side
-- effect this block exists to prevent. The loop re-enables precisely what it
-- disabled, and the whole thing is one atomic block: if the UPDATE raises, the
-- disable rolls back with it and no trigger is left switched off.
--
-- DO NOT "clean this up" by dropping public.update_updated_at() — that FUNCTION
-- is shared by three triggers (agent_leads, agent_configs, user_credits). Only
-- the redundant TRIGGER on agent_leads is droppable, and that is deliberately
-- left to its own migration rather than smuggled into a sort fix. Even after
-- such a cleanup this loop stays correct, which is the point of discovering the
-- set dynamically instead of hard-coding it.
--
-- The disable takes a table lock for its duration; at current volume (dev 388
-- rows, prod 2,729) that is milliseconds, and concurrent writers simply wait
-- for the commit.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tg.tgname
    FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.agent_leads'::regclass
      AND NOT tg.tgisinternal
      AND p.proname IN ('update_updated_at', 'update_updated_at_column')
  LOOP
    EXECUTE format('ALTER TABLE public.agent_leads DISABLE TRIGGER %I', t.tgname);
  END LOOP;

  UPDATE public.agent_leads
  SET last_message_at = public.agent_leads_last_message_at(
        reply_thread, last_reply_at, created_at
      )
  WHERE last_message_at IS DISTINCT FROM public.agent_leads_last_message_at(
        reply_thread, last_reply_at, created_at
      );

  FOR t IN
    SELECT tg.tgname
    FROM pg_trigger tg
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = 'public.agent_leads'::regclass
      AND NOT tg.tgisinternal
      AND p.proname IN ('update_updated_at', 'update_updated_at_column')
  LOOP
    EXECUTE format('ALTER TABLE public.agent_leads ENABLE TRIGGER %I', t.tgname);
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 5. Index — matches get-agent-inbox's Total Inbox access path
--     .eq('user_id').in('inbox_status', […]).order('last_message_at', desc)
-- NULLS LAST mirrors the query's nullsFirst:false.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS agent_leads_user_status_last_message_idx
  ON public.agent_leads (user_id, inbox_status, last_message_at DESC NULLS LAST);

NOTIFY pgrst, 'reload schema';
