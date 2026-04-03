-- Agent Phase 2: inbox, classification, activity tracking

-- Add campaign_rules and profile fields to agent_configs
ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS campaign_rules JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reply_io_connected BOOLEAN DEFAULT false;

-- Add inbox + classification fields to agent_leads
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS reply_thread JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS intent TEXT CHECK (intent IN (
    'interested', 'not_interested', 'referral',
    'out_of_office', 'bounce', 'needs_more_info', 'unknown'
  )),
  ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS auto_handled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS inbox_status TEXT DEFAULT 'pending'
    CHECK (inbox_status IN (
      'pending', 'draft_ready', 'approved', 'sent', 'dismissed'
    ));

-- Activity log table
CREATE TABLE IF NOT EXISTS public.agent_activity (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_config_id UUID REFERENCES agent_configs(id) ON DELETE CASCADE,
  activity_type   TEXT NOT NULL CHECK (activity_type IN (
    'contact_added', 'reply_received', 'draft_created',
    'message_approved', 'message_sent', 'lead_stage_changed',
    'campaign_routed', 'agent_run_completed', 'agent_paused',
    'agent_resumed'
  )),
  lead_id         UUID REFERENCES agent_leads(id),
  lead_name       TEXT,
  lead_company    TEXT,
  description     TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_activity_user
  ON public.agent_activity(user_id, created_at DESC);
CREATE INDEX idx_agent_activity_type
  ON public.agent_activity(user_id, activity_type);
CREATE INDEX idx_agent_activity_lead
  ON public.agent_activity(lead_id);

-- Unique constraint for agent_leads upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_leads_user_external
  ON public.agent_leads(user_id, external_id)
  WHERE external_id IS NOT NULL;

-- Indexes for inbox + pipeline queries
CREATE INDEX IF NOT EXISTS idx_agent_leads_inbox
  ON public.agent_leads(user_id, inbox_status, channel);
CREATE INDEX IF NOT EXISTS idx_agent_leads_stage
  ON public.agent_leads(user_id, pipeline_stage);

-- RLS for agent_activity
ALTER TABLE public.agent_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agent activity"
  ON public.agent_activity FOR ALL
  USING (auth.uid() = user_id);
