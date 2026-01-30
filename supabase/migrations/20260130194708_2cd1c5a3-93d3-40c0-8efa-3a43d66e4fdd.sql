-- Merge LinkedIn stats from CSV import rows into matching linked Reply.io campaigns
UPDATE synced_campaigns target
SET stats = COALESCE(target.stats, '{}'::jsonb) || jsonb_build_object(
  'linkedinMessagesSent', COALESCE((source.stats->>'linkedinMessagesSent')::int, 0),
  'linkedinConnectionsSent', COALESCE((source.stats->>'linkedinConnectionsSent')::int, 0),
  'linkedinConnectionsAccepted', COALESCE((source.stats->>'linkedinConnectionsAccepted')::int, 0),
  'linkedinReplies', COALESCE((source.stats->>'linkedinReplies')::int, 0),
  'linkedinDataSource', source.stats->>'linkedinDataSource',
  'linkedinDataUploadedAt', source.stats->>'linkedinDataUploadedAt'
),
updated_at = now()
FROM synced_campaigns source
WHERE target.is_linked = true
  AND source.is_linked = false
  AND source.external_campaign_id LIKE 'csv_import_%'
  AND lower(trim(target.name)) = lower(trim(source.name))
  AND source.stats->>'linkedinConnectionsSent' IS NOT NULL;

-- Remove duplicate CSV import rows after successful merge
DELETE FROM synced_campaigns
WHERE is_linked = false
  AND external_campaign_id LIKE 'csv_import_%'
  AND EXISTS (
    SELECT 1 FROM synced_campaigns linked
    WHERE linked.is_linked = true
      AND lower(trim(linked.name)) = lower(trim(synced_campaigns.name))
  );