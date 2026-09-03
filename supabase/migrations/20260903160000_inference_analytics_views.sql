-- Inference Analytics Views (additive, no schema mutation)
-- - Send performance by hour/weekday (UTC and PR-local variants)
-- - Reply latency pairing (replied -> nearest preceding sent)
-- - Copy/subject outcome rollups (from classified events)
-- - Reply language by copy fingerprint (pairs replied with nearest sent)
--
-- All views are security_invoker so RLS applies. No writes, no table changes.

-- Helper: normalize provider_thread_id from metadata (text)
CREATE OR REPLACE VIEW public.inference_events_with_provider_ids
WITH (security_invoker = true)
AS
SELECT
  e.*,
  NULLIF((e.metadata->>'provider')::text, '') AS provider,
  NULLIF((e.metadata->>'provider_thread_id')::text, '') AS provider_thread_id,
  NULLIF((e.metadata->>'provider_message_id')::text, '') AS provider_message_id,
  NULLIF((e.metadata->>'reply_language_code')::text, '') AS reply_language_code,
  NULLIF((e.metadata->>'reply_language_method')::text, '') AS reply_language_method
FROM public.inference_events e;

-- 1) Send performance by UTC hour and weekday
CREATE OR REPLACE VIEW public.inference_send_counts_utc
WITH (security_invoker = true)
AS
SELECT
  team_id,
  channel,
  provider,
  EXTRACT(DOW FROM occurred_at AT TIME ZONE 'UTC')::int AS weekday_utc,
  EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'UTC')::int AS hour_utc,
  COUNT(*)::bigint AS sends
FROM public.inference_events_with_provider_ids
WHERE event_type = 'sent'
GROUP BY 1,2,3,4,5;

-- 1b) Send performance by America/Puerto_Rico local hour and weekday
CREATE OR REPLACE VIEW public.inference_send_counts_pr
WITH (security_invoker = true)
AS
SELECT
  team_id,
  channel,
  provider,
  EXTRACT(DOW FROM occurred_at AT TIME ZONE 'America/Puerto_Rico')::int AS weekday_pr,
  EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'America/Puerto_Rico')::int AS hour_pr,
  COUNT(*)::bigint AS sends
FROM public.inference_events_with_provider_ids
WHERE event_type = 'sent'
GROUP BY 1,2,3,4,5;

-- 2) Reply latency: pair each 'replied' with the nearest preceding 'sent'
--    Prefers a provider_thread_id match when both sides have it; otherwise
--    falls back to person_key-only pairing. No fabricated matches.
CREATE OR REPLACE VIEW public.inference_reply_latency
WITH (security_invoker = true)
AS
SELECT
  e.team_id,
  e.person_key,
  e.channel,
  e.provider AS reply_provider,
  e.provider_thread_id AS reply_thread_id,
  e.occurred_at AS reply_occurred_at,
  s.id AS sent_event_id,
  s.provider AS sent_provider,
  s.provider_thread_id AS sent_thread_id,
  s.copy_fingerprint AS sent_copy_fingerprint,
  s.subject AS sent_subject,
  s.occurred_at AS sent_occurred_at,
  EXTRACT(EPOCH FROM (e.occurred_at - s.occurred_at))::bigint AS reply_latency_seconds
FROM public.inference_events_with_provider_ids e
LEFT JOIN LATERAL (
  SELECT s.*
  FROM public.inference_events_with_provider_ids s
  WHERE s.team_id = e.team_id
    AND s.person_key = e.person_key
    AND s.channel = e.channel
    AND s.event_type = 'sent'
    AND s.occurred_at <= e.occurred_at
    AND (
      -- Prefer exact provider_thread_id match when both present
      (e.provider_thread_id IS NOT NULL AND e.provider_thread_id <> '' AND s.provider_thread_id = e.provider_thread_id)
      OR (e.provider_thread_id IS NULL OR e.provider_thread_id = '')
    )
  ORDER BY
    CASE WHEN e.provider_thread_id IS NOT NULL AND e.provider_thread_id <> '' AND s.provider_thread_id = e.provider_thread_id THEN 0 ELSE 1 END,
    s.occurred_at DESC
  LIMIT 1
) s ON TRUE
WHERE e.event_type = 'replied';

-- 3) Copy/subject outcome rollups — classified events carry copy_fingerprint
CREATE OR REPLACE VIEW public.inference_copy_outcome_by_segments
WITH (security_invoker = true)
AS
SELECT
  team_id,
  channel,
  copy_fingerprint,
  COALESCE(NULLIF(subject, ''), NULL) AS subject,
  COALESCE(NULLIF(industry, ''), '(unknown)') AS industry,
  COALESCE(NULLIF(job_title, ''), '(unknown)') AS job_title,
  COALESCE(NULLIF(seniority, ''), '(unknown)') AS seniority,
  COALESCE(NULLIF(campaign_name, ''), '(unknown)') AS campaign_name,
  COALESCE(NULLIF(intent, ''), 'unknown') AS intent,
  COUNT(*)::bigint AS n
FROM public.inference_events_with_provider_ids
WHERE event_type = 'classified'
  AND copy_fingerprint IS NOT NULL
GROUP BY 1,2,3,4,5,6,7,8,9
ORDER BY n DESC;

-- 4) Reply language by industry and copy fingerprint
--    Join replies to nearest preceding sent (from reply_latency view) to get copy_fingerprint.
CREATE OR REPLACE VIEW public.inference_reply_language_by_copy
WITH (security_invoker = true)
AS
SELECT
  e.team_id,
  COALESCE(NULLIF(e.industry, ''), '(unknown)') AS industry,
  rl.sent_copy_fingerprint AS copy_fingerprint,
  e.channel,
  COALESCE(NULLIF(e.reply_language_code, ''), 'unknown') AS reply_language_code,
  COUNT(*)::bigint AS n
FROM public.inference_events_with_provider_ids e
JOIN public.inference_reply_latency rl
  ON rl.team_id = e.team_id
 AND rl.person_key = e.person_key
 AND rl.channel = e.channel
 AND rl.reply_occurred_at = e.occurred_at
WHERE e.event_type = 'replied'
  AND rl.sent_copy_fingerprint IS NOT NULL
GROUP BY 1,2,3,4,5
ORDER BY n DESC;

