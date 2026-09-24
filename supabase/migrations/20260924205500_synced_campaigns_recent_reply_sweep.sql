-- Track when a campaign was last included in the recent-replies sweep.
-- Additive and safe; guarded against reapplication.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'synced_campaigns'
       AND column_name  = 'capture_recent_reply_sweep_at'
  ) THEN
    ALTER TABLE public.synced_campaigns
      ADD COLUMN capture_recent_reply_sweep_at timestamptz;
  END IF;
END
$migration$;

COMMENT ON COLUMN public.synced_campaigns.capture_recent_reply_sweep_at IS
  'Timestamp of the last time this campaign was considered in the Smartlead recent-replies safety-net sweep.';

