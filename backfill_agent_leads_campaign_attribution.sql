-- backfill_agent_leads_campaign_attribution.sql
--
-- Retroactively populates agent_leads.campaign_external_id for historical
-- LinkedIn leads by joining through webhook_events on contact_email.
--
-- Companion to migration 20260610130000_agent_leads_campaign_external_id.sql
-- (which adds the column itself). This script lives outside supabase/
-- migrations on purpose — it's a one-shot data fix, not a schema change,
-- and we want it to be explicitly reviewable + manually runnable rather
-- than auto-applied by `supabase db push`.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENCY
-- ----------------------------------------------------------------------------
-- Safe to run multiple times. The WHERE clauses guarantee:
--   * We only consider agent_leads rows that DON'T already have an
--     attribution (campaign_external_id IS NULL).
--   * We only touch rows where the join is UNAMBIGUOUS — i.e. all matching
--     webhook_events share exactly one distinct campaign_external_id.
--   * Rows with no matching webhook_events stay NULL.
--   * Rows where multiple campaigns are observed stay NULL (ambiguous).
-- Re-running does nothing additional unless new webhook_events have
-- arrived since the last run.
--
-- ----------------------------------------------------------------------------
-- SCOPE
-- ----------------------------------------------------------------------------
-- Only LinkedIn leads (channel='linkedin') with a non-null email. The
-- Smartlead side uses smartlead_campaign_id, which is already populated by
-- smartlead-webhook at insert time — no parallel backfill needed there.
--
-- ----------------------------------------------------------------------------
-- HOW IT WORKS
-- ----------------------------------------------------------------------------
-- 1. `candidates`: every LinkedIn agent_lead row with NULL attribution and
--    a non-null email.
-- 2. `attribution`: for each candidate, aggregate the DISTINCT
--    campaign_external_ids seen across matching webhook_events. The match
--    is on contact_email + non-null campaign_external_id.
-- 3. The UPDATE touches only rows where `array_length(...) = 1`, i.e.
--    exactly one distinct campaign observed.
--
-- The double guard on the UPDATE (`array_length(...) = 1` AND
-- `al.campaign_external_id IS NULL`) makes re-runs no-ops even if the data
-- shape changes between runs — concurrent webhook writes can't accidentally
-- be clobbered.

WITH candidates AS (
  SELECT
    al.id    AS lead_id,
    al.email AS lead_email
  FROM public.agent_leads al
  WHERE al.campaign_external_id IS NULL
    AND al.channel = 'linkedin'
    AND al.email IS NOT NULL
),
attribution AS (
  SELECT
    c.lead_id,
    array_agg(DISTINCT we.campaign_external_id) AS campaigns
  FROM candidates c
  JOIN public.webhook_events we
    ON we.contact_email = c.lead_email
   AND we.campaign_external_id IS NOT NULL
  GROUP BY c.lead_id
)
UPDATE public.agent_leads al
SET campaign_external_id = attribution.campaigns[1]
FROM attribution
WHERE al.id = attribution.lead_id
  AND array_length(attribution.campaigns, 1) = 1
  AND al.campaign_external_id IS NULL;

-- Optional: report on what happened. Comment out if you'd rather run silently.
SELECT
  COUNT(*) FILTER (WHERE channel = 'linkedin' AND campaign_external_id IS NOT NULL) AS attributed_linkedin_leads,
  COUNT(*) FILTER (WHERE channel = 'linkedin' AND campaign_external_id IS NULL)     AS unattributed_linkedin_leads
FROM public.agent_leads;
