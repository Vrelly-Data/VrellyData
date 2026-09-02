-- People backfill (idempotent) — populate public.people from synced_contacts and agent_leads.
-- ADDITIVE ONLY. No modifications to source tables.

-- 1) From synced_contacts (preferred roster source). One row per (team,campaign,email).
-- We upsert into people with COALESCE semantics so non-null roster data wins over prior nulls.
INSERT INTO public.people AS p (
  team_id, person_key, email, linkedin_url, first_name, last_name, full_name,
  job_title, company_name, industry, company_size, city, state, country, domain, phone,
  source, metadata, first_seen_at, last_seen_at
)
SELECT
  sc.team_id,
  COALESCE(NULLIF(lower(sc.email), ''), NULLIF(sc.linkedin_url, ''), NULLIF(sc.external_contact_id, '')) AS person_key,
  NULLIF(lower(sc.email), '') AS email,
  NULLIF(sc.linkedin_url, '') AS linkedin_url,
  NULLIF(sc.first_name, '') AS first_name,
  NULLIF(sc.last_name, '') AS last_name,
  CASE
    WHEN COALESCE(NULLIF(sc.first_name, ''), NULLIF(sc.last_name, '')) IS NOT NULL
    THEN trim(CONCAT(COALESCE(sc.first_name, ''), ' ', COALESCE(sc.last_name, '')))
    ELSE NULLIF(sc.company, '') -- fallback to company when no names, kept for display parity
  END AS full_name,
  NULLIF(sc.job_title, '') AS job_title,
  NULLIF(sc.company, '') AS company_name,
  NULLIF(sc.industry, '') AS industry,
  NULLIF(sc.company_size, '') AS company_size,
  NULLIF(sc.city, '') AS city,
  NULLIF(sc.state, '') AS state,
  NULLIF(sc.country, '') AS country,
  NULLIF(sc.domain, '') AS domain,
  NULLIF(sc.phone, '') AS phone,
  'synced_contacts' AS source,
  jsonb_build_object('campaign_id', sc.campaign_id) AS metadata,
  COALESCE(sc.added_at, sc.created_at, now()) AS first_seen_at,
  COALESCE(sc.updated_at, sc.created_at, now()) AS last_seen_at
FROM public.synced_contacts sc
WHERE COALESCE(NULLIF(lower(sc.email), ''), NULLIF(sc.linkedin_url, ''), NULLIF(sc.external_contact_id, '')) IS NOT NULL
ON CONFLICT (team_id, person_key)
DO UPDATE SET
  email        = COALESCE(EXCLUDED.email,        p.email),
  linkedin_url = COALESCE(EXCLUDED.linkedin_url, p.linkedin_url),
  first_name   = COALESCE(EXCLUDED.first_name,   p.first_name),
  last_name    = COALESCE(EXCLUDED.last_name,    p.last_name),
  full_name    = COALESCE(EXCLUDED.full_name,    p.full_name),
  job_title    = COALESCE(EXCLUDED.job_title,    p.job_title),
  company_name = COALESCE(EXCLUDED.company_name, p.company_name),
  industry     = COALESCE(EXCLUDED.industry,     p.industry),
  company_size = COALESCE(EXCLUDED.company_size, p.company_size),
  city         = COALESCE(EXCLUDED.city,         p.city),
  state        = COALESCE(EXCLUDED.state,        p.state),
  country      = COALESCE(EXCLUDED.country,      p.country),
  domain       = COALESCE(EXCLUDED.domain,       p.domain),
  phone        = COALESCE(EXCLUDED.phone,        p.phone),
  last_seen_at = GREATEST(p.last_seen_at, COALESCE(EXCLUDED.last_seen_at, now())),
  metadata     = p.metadata || EXCLUDED.metadata;

-- 2) From agent_leads (responders + inbound). Provides people even when roster sync is absent.
-- team_id derived from user_id; person_key from email/linkedin/external_id.
INSERT INTO public.people AS p (
  team_id, person_key, email, linkedin_url, full_name, job_title, company_name,
  source, metadata, first_seen_at, last_seen_at
)
SELECT
  public.get_user_team_id(al.user_id) AS team_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), NULLIF(al.external_id, '')) AS person_key,
  NULLIF(lower(al.email), '') AS email,
  NULLIF(al.linkedin_url, '') AS linkedin_url,
  NULLIF(al.full_name, '') AS full_name,
  NULLIF(al.job_title, '') AS job_title,
  NULLIF(al.company, '') AS company_name,
  'agent_leads' AS source,
  jsonb_build_object('lead_id', al.id) AS metadata,
  COALESCE(al.created_at, now()) AS first_seen_at,
  COALESCE(al.updated_at, al.created_at, now()) AS last_seen_at
FROM public.agent_leads al
WHERE COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), NULLIF(al.external_id, '')) IS NOT NULL
ON CONFLICT (team_id, person_key)
DO UPDATE SET
  email        = COALESCE(EXCLUDED.email,        p.email),
  linkedin_url = COALESCE(EXCLUDED.linkedin_url, p.linkedin_url),
  full_name    = COALESCE(EXCLUDED.full_name,    p.full_name),
  job_title    = COALESCE(EXCLUDED.job_title,    p.job_title),
  company_name = COALESCE(EXCLUDED.company_name, p.company_name),
  last_seen_at = GREATEST(p.last_seen_at, COALESCE(EXCLUDED.last_seen_at, now())),
  metadata     = p.metadata || EXCLUDED.metadata;

