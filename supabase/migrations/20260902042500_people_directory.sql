-- People directory (additive) — cross-platform, cross-campaign person snapshot per team.
-- Purpose: persist client people, keyed by a stable person_key (email|linkedin|external id),
-- and capture firmographics at the person level in addition to per-event snapshots.
-- Does NOT change existing tables or UI behavior.

CREATE TABLE IF NOT EXISTS public.people (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  person_key       text NOT NULL,   -- normalized email (preferred) else linkedin url else stable external id
  -- identity
  email            text,
  linkedin_url     text,
  first_name       text,
  last_name        text,
  full_name        text,
  -- firmographics
  job_title        text,
  seniority        text,
  department       text,
  company_name     text,
  industry         text,
  company_size     text,
  city             text,
  state            text,
  country          text,
  domain           text,
  phone            text,
  -- provenance
  source           text,            -- reply_io, smartlead, heyreach, agent_leads, backfill, ...
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at    timestamptz DEFAULT now(),
  last_seen_at     timestamptz DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Uniqueness per team + person_key
CREATE UNIQUE INDEX IF NOT EXISTS people_team_person_key_unique ON public.people(team_id, person_key);
CREATE INDEX IF NOT EXISTS people_team_email_idx ON public.people(team_id, lower(email));
CREATE INDEX IF NOT EXISTS people_team_linkedin_idx ON public.people(team_id, linkedin_url);

-- Keep updated_at fresh
DROP TRIGGER IF EXISTS people_updated_at ON public.people;
CREATE TRIGGER people_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

DO $pol$ BEGIN
  CREATE POLICY "Service role full access" ON public.people
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Platform admins read all people" ON public.people
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.is_platform_admin = true OR p.is_super_admin = true)
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Users read their team people" ON public.people
    FOR SELECT
    USING (team_id = public.get_user_team_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

