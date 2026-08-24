-- Agent Audience — Stage 1: schema only.
--
-- Named, saved audience definitions per client, backed by Apollo (api_search to
-- browse, bulk_match to enrich), pushed manually into a synced Smartlead or
-- Reply.io campaign. Automation columns exist from day one but NOTHING here
-- schedules anything: no cron job is created by this migration, and an audience
-- cannot become active until a manual run has demonstrably succeeded.
--
-- THREE TABLES, and the third does double duty.
--
-- Apollo's own tracking (revealed_for_current_team / contact_id, both returned
-- by ENRICHMENT, neither by SEARCH) answers "have I already paid to reveal this
-- person?". It cannot answer "have I already enrolled this person in a
-- campaign?" — it knows nothing about Smartlead/Reply.io, and if an enrich
-- succeeds but the push fails it still marks the person revealed. Duplicate
-- ENROLMENT is the irreversible, prospect-facing harm, so that check stays
-- local. agent_audience_pushes is therefore both the audit trail AND the dedup
-- key; there is deliberately no separate members/ledger table layered on top of
-- what Apollo already does.
--
-- Dedup is scoped to user_id, NOT audience_id. If "CEOs in healthcare" and
-- "CFOs in fintech" both match the same person, they must not both enrol them.
--
-- NOT COVERED HERE, and deliberately so: the opted-out guard. Neither Apollo nor
-- this push log knows about agent_leads, where 7 leads currently carry
-- disposition_tag='opted_out'. Re-mailing them is a compliance problem, not an
-- annoyance, so the push path (Stage 3) must check agent_leads by normalized
-- email/linkedin key before enrolling. No schema here can enforce that.

-- ============================================================================
-- 1. agent_audiences — the saved definition
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_audiences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_config_id       UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,

  -- Apollo request parameters as sent (person_titles[], person_seniorities[],
  -- organization_num_employees_ranges[], q_keywords, ...). Versioned because
  -- Apollo renames filters and a stored search must stay interpretable.
  filters               JSONB NOT NULL DEFAULT '{}'::jsonb,
  filters_version       SMALLINT NOT NULL DEFAULT 1,

  -- v1 is email-keyed platforms only. HeyReach is excluded because it keys on
  -- linkedin_url (forcing enrichment for every row) and because
  -- synced_campaigns currently holds ZERO heyreach rows despite
  -- sync-heyreach-campaigns writing there. Widening this CHECK is a one-line
  -- migration once that is confirmed working.
  platform              TEXT NOT NULL CHECK (platform IN ('smartlead', 'reply.io')),
  -- SET NULL rather than RESTRICT so campaign cleanup is never blocked; the
  -- activation trigger below auto-deactivates an audience that loses its link.
  synced_campaign_id    UUID REFERENCES public.synced_campaigns(id) ON DELETE SET NULL,

  -- Automation. is_active defaults FALSE: creating an audience must never start
  -- spending money. See the activation trigger for what it takes to flip it.
  is_active             BOOLEAN NOT NULL DEFAULT false,
  cadence               TEXT NOT NULL DEFAULT 'manual'
                          CHECK (cadence IN ('manual', 'daily', 'weekly')),

  -- Per-run cap is REQUIRED — there is no "unlimited" in v1. The upper bound is
  -- a backstop against a fat-fingered 5000, not a product limit.
  max_per_run           INTEGER NOT NULL CHECK (max_per_run > 0 AND max_per_run <= 100),
  -- Optional lifetime ceiling. NULL means no lifetime cap (max_per_run still applies).
  max_total             INTEGER CHECK (max_total IS NULL OR max_total > 0),
  total_pushed          INTEGER NOT NULL DEFAULT 0 CHECK (total_pushed >= 0),

  last_run_at           TIMESTAMPTZ,
  last_run_status       TEXT CHECK (last_run_status IS NULL
                          OR last_run_status IN ('running', 'success', 'partial', 'failed')),
  last_run_error        TEXT,
  -- Auto-pause fuel: the runner sets is_active=false at a threshold. Silent
  -- repeated failure is how the HeyReach 401 stayed invisible for weeks.
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_audiences_user
  ON public.agent_audiences(user_id);
-- The cron's due-scan: only ever looks at active, non-manual audiences.
CREATE INDEX IF NOT EXISTS idx_agent_audiences_due
  ON public.agent_audiences(cadence, last_run_at)
  WHERE is_active AND cadence <> 'manual';

-- ============================================================================
-- 2. agent_audience_runs — one row per run, manual or cron
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_audience_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id        UUID NOT NULL REFERENCES public.agent_audiences(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger            TEXT NOT NULL CHECK (trigger IN ('manual', 'cron')),

  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'success', 'partial', 'failed')),

  -- Counters. credits_spent is what Apollo actually charged (bulk_match bills
  -- per record where credit-consuming data was FOUND, so it is knowable only
  -- after the fact and is not equal to `enriched`).
  searched           INTEGER NOT NULL DEFAULT 0 CHECK (searched >= 0),
  enriched           INTEGER NOT NULL DEFAULT 0 CHECK (enriched >= 0),
  credits_spent      INTEGER NOT NULL DEFAULT 0 CHECK (credits_spent >= 0),
  pushed             INTEGER NOT NULL DEFAULT 0 CHECK (pushed >= 0),
  skipped_duplicate  INTEGER NOT NULL DEFAULT 0 CHECK (skipped_duplicate >= 0),
  failed             INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),

  error_detail       JSONB
);

-- Run history for an audience, newest first; also the lookup the activation
-- trigger uses.
CREATE INDEX IF NOT EXISTS idx_agent_audience_runs_audience
  ON public.agent_audience_runs(audience_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audience_runs_user
  ON public.agent_audience_runs(user_id, started_at DESC);

-- ============================================================================
-- 3. agent_audience_pushes — audit trail AND dedup key
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_audience_pushes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id         UUID NOT NULL REFERENCES public.agent_audiences(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id              UUID REFERENCES public.agent_audience_runs(id) ON DELETE SET NULL,

  apollo_person_id    TEXT NOT NULL,
  -- Normalized keys. These MUST be written using the same helpers the ingest
  -- paths use (_shared/lead-dedup.ts: normalizeEmailKey / normalizeLinkedInUrl,
  -- both lowercase+trim, genmail placeholders excluded) or the dedup silently
  -- misses. No DB constraint can enforce that; it is a code contract.
  email_key           TEXT,
  linkedin_key        TEXT,

  synced_campaign_id  UUID REFERENCES public.synced_campaigns(id) ON DELETE SET NULL,
  pushed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Platform's own identifier for the created contact/lead, for tracing.
  external_ref        TEXT
);

-- The dedup constraints. Client-wide (user_id), not per-audience.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_audience_pushes_person
  ON public.agent_audience_pushes(user_id, apollo_person_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_audience_pushes_email
  ON public.agent_audience_pushes(user_id, email_key)
  WHERE email_key IS NOT NULL;
-- Not unique in v1: both v1 platforms key on email, and HeyReach is excluded.
-- Promote to UNIQUE when linkedin-keyed pushes land.
CREATE INDEX IF NOT EXISTS idx_agent_audience_pushes_linkedin
  ON public.agent_audience_pushes(user_id, linkedin_key)
  WHERE linkedin_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_audience_pushes_audience
  ON public.agent_audience_pushes(audience_id, pushed_at DESC);

-- ============================================================================
-- 4. Activation guard — the highest-value safety control in the design
-- ============================================================================
-- Enforced in the DATABASE, not app logic, because app logic is one forgotten
-- code path away from a schedule that spends real Apollo credits and enrols real
-- prospects on filters nobody ever saw results from.
--
-- A CHECK constraint cannot express this: it needs a subquery against
-- agent_audience_runs. Hence a trigger.
--
-- An EXPLICIT activation attempt (INSERT with is_active, or false -> true) is
-- treated differently from an already-active row losing its campaign:
--   * explicit attempt  -> RAISE, naming the reason;
--   * campaign goes away -> silently deactivate. It must NOT raise, or the FK's
--     ON DELETE SET NULL could never clean up a campaign.
--   * already-active rows are otherwise NOT re-checked, so ordinary updates
--     (counters, last_run_at) are unaffected.
--
-- ORDER MATTERS, and the first version got it wrong. It set
-- NEW.is_active := false whenever synced_campaign_id was NULL and only THEN
-- tested `IF NEW.is_active`, so with no campaign linked the guard was
-- unreachable: an explicit activation attempt was silently downgraded to a
-- no-op instead of raising. The safety property still held (the row never
-- became active by any path) but the operator got no error, and the check could
-- not be exercised by a test — dev verification steps 3 and 4 failed for
-- exactly that reason.
--
-- The successful-run test now runs FIRST so the highest-value guard is
-- reachable, and therefore verifiable, even when no campaign is linked.
CREATE OR REPLACE FUNCTION public.agent_audiences_guard_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_active, false)) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_audience_runs r
      WHERE r.audience_id = NEW.id AND r.status = 'success'
    ) THEN
      RAISE EXCEPTION
        'agent_audiences: cannot activate "%" until a run has completed with status=success (run it manually first)',
        NEW.name
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.synced_campaign_id IS NULL THEN
      RAISE EXCEPTION
        'agent_audiences: cannot activate "%" without a linked synced_campaign_id',
        NEW.name
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF NEW.is_active AND NEW.synced_campaign_id IS NULL THEN
    NEW.is_active := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_audiences_guard_activation ON public.agent_audiences;
CREATE TRIGGER trg_agent_audiences_guard_activation
  BEFORE INSERT OR UPDATE ON public.agent_audiences
  FOR EACH ROW EXECUTE FUNCTION public.agent_audiences_guard_activation();

-- Keep total_pushed honest in the database rather than trusting every writer,
-- because max_total is enforced against it.
CREATE OR REPLACE FUNCTION public.agent_audience_pushes_bump_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.agent_audiences
     SET total_pushed = total_pushed + 1
   WHERE id = NEW.audience_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_audience_pushes_bump_total ON public.agent_audience_pushes;
CREATE TRIGGER trg_agent_audience_pushes_bump_total
  AFTER INSERT ON public.agent_audience_pushes
  FOR EACH ROW EXECUTE FUNCTION public.agent_audience_pushes_bump_total();

-- update_updated_at_column() exists on prod, but this migration must not assume
-- dev is in perfect parity — dev was seeded from a 2026-05-28 prod dump and has
-- drifted since. Create it only if absent; never redefine a working one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.update_updated_at_column()
      RETURNS TRIGGER LANGUAGE plpgsql AS $body$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $body$;
    $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_agent_audiences_updated_at ON public.agent_audiences;
CREATE TRIGGER trg_agent_audiences_updated_at
  BEFORE UPDATE ON public.agent_audiences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 5. RLS — mirrors agent_configs / agent_leads / saved_audiences
-- ============================================================================
-- WITH CHECK is added (the older agent policies only have USING) so a client
-- cannot INSERT a row owned by someone else. Edge functions use the service
-- role, which bypasses RLS.
ALTER TABLE public.agent_audiences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_audience_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_audience_pushes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='agent_audiences'
                   AND policyname='Users manage own agent audiences') THEN
    CREATE POLICY "Users manage own agent audiences" ON public.agent_audiences
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='agent_audience_runs'
                   AND policyname='Users manage own agent audience runs') THEN
    CREATE POLICY "Users manage own agent audience runs" ON public.agent_audience_runs
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='agent_audience_pushes'
                   AND policyname='Users manage own agent audience pushes') THEN
    CREATE POLICY "Users manage own agent audience pushes" ON public.agent_audience_pushes
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
