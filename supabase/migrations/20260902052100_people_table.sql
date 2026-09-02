-- public.people — optional additive normalized person roster
-- Mirrors inference_events RLS: service role full access; platform admins read-all; team members read own team.
-- Unique identity: (team_id, person_key) where person_key = normalized email OR linkedin_url OR stable external id.

CREATE TABLE IF NOT EXISTS public.people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  person_key    text NOT NULL,
  -- Identity
  email         text,
  linkedin_url  text,
  full_name     text,
  -- Firmographics
  job_title     text,
  seniority     text,
  department    text,
  company_name  text,
  industry      text,
  city          text,
  state         text,
  country       text,
  company_size  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Stable identity per team
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_team_person_key ON public.people (team_id, person_key);
CREATE INDEX IF NOT EXISTS idx_people_email ON public.people (email);
CREATE INDEX IF NOT EXISTS idx_people_linkedin ON public.people (linkedin_url);

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $pol$ BEGIN
  CREATE POLICY "Service role full access (people)"
    ON public.people FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- Platform admins can read all rows
DO $pol$ BEGIN
  CREATE POLICY "Platform admins can read all people"
    ON public.people FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.is_platform_admin = true OR p.is_super_admin = true)
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- Team members can read rows for their team
DO $pol$ BEGIN
  CREATE POLICY "Users can read their team people"
    ON public.people FOR SELECT
    USING (team_id = public.get_user_team_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- No generic INSERT/UPDATE/DELETE for clients (service role only via policy above)

-- Updated-at trigger
DROP TRIGGER IF EXISTS update_people_updated_at ON public.people;
CREATE TRIGGER update_people_updated_at
  BEFORE UPDATE ON public.people
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill from synced_contacts (preferred) then agent_leads (fills gaps). Idempotent.
-- 1) synced_contacts
INSERT INTO public.people (
  team_id, person_key, email, linkedin_url, full_name,
  job_title, company_name, industry, city, state, country, company_size
)
SELECT
  sc.team_id,
  COALESCE(NULLIF(lower(sc.email), ''), NULLIF(sc.linkedin_url, '')) AS person_key,
  NULLIF(lower(sc.email), '')                                       AS email,
  NULLIF(sc.linkedin_url, '')                                       AS linkedin_url,
  NULLIF(trim(concat_ws(' ', sc.first_name, sc.last_name)), '')     AS full_name,
  NULLIF(sc.job_title, '')                                          AS job_title,
  NULLIF(sc.company, '')                                            AS company_name,
  NULLIF(sc.industry, '')                                           AS industry,
  NULLIF(sc.city, '')                                               AS city,
  NULLIF(sc.state, '')                                              AS state,
  NULLIF(sc.country, '')                                            AS country,
  NULLIF(sc.company_size, '')                                       AS company_size
FROM public.synced_contacts sc
WHERE COALESCE(NULLIF(lower(sc.email), ''), NULLIF(sc.linkedin_url, '')) IS NOT NULL
ON CONFLICT (team_id, person_key) DO NOTHING;

-- 2) agent_leads
INSERT INTO public.people (
  team_id, person_key, email, linkedin_url, full_name,
  job_title, company_name
)
SELECT
  public.get_user_team_id(al.user_id)                                                     AS team_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id)      AS person_key,
  NULLIF(lower(al.email), '')                                                             AS email,
  NULLIF(al.linkedin_url, '')                                                             AS linkedin_url,
  NULLIF(al.full_name, '')                                                                AS full_name,
  NULLIF(al.job_title, '')                                                                AS job_title,
  NULLIF(al.company, '')                                                                  AS company_name
FROM public.agent_leads al
WHERE COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (team_id, person_key) DO NOTHING;

