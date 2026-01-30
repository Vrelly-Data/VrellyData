-- One-time fix: Correct campaign statuses based on raw_data for Reply.io integrations
-- Reply.io v1 uses: 0=draft, 2=active, 4=paused, 7=finished

UPDATE synced_campaigns sc
SET status = CASE 
    WHEN (sc.raw_data->>'status')::int = 0 THEN 'draft'
    WHEN (sc.raw_data->>'status')::int = 2 THEN 'active'
    WHEN (sc.raw_data->>'status')::int = 4 THEN 'paused'
    WHEN (sc.raw_data->>'status')::int = 7 THEN 'finished'
    ELSE sc.status
  END,
  updated_at = now()
WHERE sc.integration_id IN (
  SELECT id FROM outbound_integrations WHERE platform = 'reply.io'
)
AND sc.raw_data->>'status' IS NOT NULL
AND (sc.raw_data->>'status')::int IN (0, 2, 4, 7);