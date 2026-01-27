-- Add webhook tracking columns to outbound_integrations
ALTER TABLE outbound_integrations 
ADD COLUMN IF NOT EXISTS webhook_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
ADD COLUMN IF NOT EXISTS webhook_status TEXT DEFAULT 'not_configured';

-- Create webhook_events table for activity logging
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES outbound_integrations(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  contact_email TEXT,
  campaign_external_id TEXT,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on webhook_events
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS: Team members can view their webhook events
CREATE POLICY "Users can view team webhook events" ON webhook_events 
FOR SELECT USING (team_id = get_user_team_id(auth.uid()));

-- RLS: Allow insert from service role (edge functions)
CREATE POLICY "Service role can insert webhook events" ON webhook_events
FOR INSERT WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_integration_id ON webhook_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_team_id ON webhook_events(team_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);

-- Enable realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;