-- Add reply_team_id column to store which Reply.io client team this integration is for (agency accounts)
ALTER TABLE public.outbound_integrations 
ADD COLUMN IF NOT EXISTS reply_team_id text;

-- Add comment for documentation
COMMENT ON COLUMN public.outbound_integrations.reply_team_id IS 'For Reply.io agency accounts: the specific client team ID to sync';