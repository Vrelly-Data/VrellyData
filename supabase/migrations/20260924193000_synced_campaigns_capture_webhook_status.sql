-- Capture webhook per-campaign status tracking (additive, safe).
-- Records whether a Smartlead EMAIL_REPLY webhook is registered for a campaign,
-- when it was last checked, the provider webhook id, and the last error (if any).
--
-- Safe to run multiple times: CREATE COLUMN IF NOT EXISTS guards included.
-- Does not change existing behaviour; only adds observability fields.

DO $migration$
BEGIN
  -- Registered flag: true when our webhook is present on the campaign
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'synced_campaigns'
       AND column_name  = 'capture_webhook_registered'
  ) THEN
    ALTER TABLE public.synced_campaigns
      ADD COLUMN capture_webhook_registered boolean;
  END IF;

  -- Provider webhook id (string; Smartlead returns numeric ids but store as text)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'synced_campaigns'
       AND column_name  = 'capture_webhook_id'
  ) THEN
    ALTER TABLE public.synced_campaigns
      ADD COLUMN capture_webhook_id text;
  END IF;

  -- Last time we checked/ensured the webhook for this campaign
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'synced_campaigns'
       AND column_name  = 'capture_webhook_checked_at'
  ) THEN
    ALTER TABLE public.synced_campaigns
      ADD COLUMN capture_webhook_checked_at timestamptz;
  END IF;

  -- Last error text if ensure failed (best-effort, truncated in writers)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'synced_campaigns'
       AND column_name  = 'capture_webhook_error'
  ) THEN
    ALTER TABLE public.synced_campaigns
      ADD COLUMN capture_webhook_error text;
  END IF;
END
$migration$;

COMMENT ON COLUMN public.synced_campaigns.capture_webhook_registered IS
  'Whether a capture webhook (e.g. Smartlead EMAIL_REPLY) is currently registered for this campaign (best-effort, updated by ensure sweeps).';
COMMENT ON COLUMN public.synced_campaigns.capture_webhook_id IS
  'Provider webhook id for the capture webhook registered on this campaign (string).';
COMMENT ON COLUMN public.synced_campaigns.capture_webhook_checked_at IS
  'Timestamp the capture webhook registration was last checked/ensured for this campaign.';
COMMENT ON COLUMN public.synced_campaigns.capture_webhook_error IS
  'Last error string when attempting to ensure the capture webhook for this campaign (best-effort, truncated by writers).';

