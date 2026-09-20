-- One-shot optional backfill: copy firmographics from public.people onto
-- historical public.inference_events rows where the event fields are blank.
-- SAFE: only fills NULL/empty; never overwrites non-empty event values.
-- Idempotent and reversible by re-running with the same WHERE conditions.
--
-- How to run (admin console):
--   BEGIN;
--   -- Review affected counts first (SELECTs below).
--   -- If acceptable, execute the UPDATE statements.
--   COMMIT;
--
-- Counts (preview)
SELECT COUNT(*) AS events_with_blank_job_title_but_people_has_value
FROM public.inference_events e
JOIN public.people p ON p.team_id = e.team_id AND p.person_key = e.person_key
WHERE COALESCE(NULLIF(TRIM(e.job_title), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(p.job_title), ''), NULL) IS NOT NULL;

SELECT COUNT(*) AS events_with_blank_industry_but_people_has_value
FROM public.inference_events e
JOIN public.people p ON p.team_id = e.team_id AND p.person_key = e.person_key
WHERE COALESCE(NULLIF(TRIM(e.industry), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(p.industry), ''), NULL) IS NOT NULL;

SELECT COUNT(*) AS events_with_blank_city_but_people_has_value
FROM public.inference_events e
JOIN public.people p ON p.team_id = e.team_id AND p.person_key = e.person_key
WHERE COALESCE(NULLIF(TRIM(e.city), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(p.city), ''), NULL) IS NOT NULL;

-- Updates (perform only if counts look reasonable)
UPDATE public.inference_events e
SET job_title = p.job_title
FROM public.people p
WHERE p.team_id = e.team_id
  AND p.person_key = e.person_key
  AND COALESCE(NULLIF(TRIM(e.job_title), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(p.job_title), ''), NULL) IS NOT NULL;

UPDATE public.inference_events e
SET industry = p.industry
FROM public.people p
WHERE p.team_id = e.team_id
  AND p.person_key = e.person_key
  AND COALESCE(NULLIF(TRIM(e.industry), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(p.industry), ''), NULL) IS NOT NULL;

UPDATE public.inference_events e
SET city = p.city
FROM public.people p
WHERE p.team_id = e.team_id
  AND p.person_key = e.person_key
  AND COALESCE(NULLIF(TRIM(e.city), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(p.city), ''), NULL) IS NOT NULL;

-- Notes:
-- - This is strictly additive (fills blanks). It does not modify non-empty
--   values, and therefore preserves provenance on events that recorded a value.
-- - The UI already reads from inference_events_enriched (view) which coalesces
--   at read time. This backfill is optional to improve ad-hoc SQL and legacy
--   charts that still read the base table.
