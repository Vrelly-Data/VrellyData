-- Columns required for Smartlead email integration.
-- Idempotent via ADD COLUMN IF NOT EXISTS so this is safe to re-run.
--
-- Context: earlier Smartlead-specific columns (channel, email_address,
-- smartlead_lead_id, smartlead_campaign_id, last_campaign_name) were applied
-- manually by the operator out-of-band. This migration fills the gaps and
-- becomes the canonical "apply in CI / other environments" record.

-- agent_leads
--   reply_message_id:     Smartlead's message ID for the latest prospect reply.
--                         Needed to call POST /reply-email-thread when the
--                         user approves and sends a response.
--   last_reply_raw_html:  Original HTML of the latest inbound reply. Stored
--                         for debugging; the stripped plain-text version
--                         lives in last_reply_text / reply_thread.
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS reply_message_id TEXT,
  ADD COLUMN IF NOT EXISTS last_reply_raw_html TEXT;

-- synced_campaigns
--   source:      Platform the campaign was synced from. Defaults to 'heyreach'
--                for existing rows; sync-smartlead-campaigns will explicitly
--                set 'smartlead' going forward.
--   raw_status:  Unnormalized status string as returned by the source platform
--                (e.g. 'ACTIVE', 'IN_PROGRESS'). Kept so filter UIs can fall
--                back to platform-native values when needed.
ALTER TABLE public.synced_campaigns
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'heyreach',
  ADD COLUMN IF NOT EXISTS raw_status TEXT;
