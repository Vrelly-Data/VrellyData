-- =============================================
-- DATA PLAYGROUND SCHEMA
-- =============================================

-- 1. Outbound Integrations (stores connected platforms like Reply.io)
CREATE TABLE public.outbound_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  platform TEXT NOT NULL, -- 'reply_io', 'smartlead', 'instantly'
  name TEXT NOT NULL, -- user-defined name for the integration
  api_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_status TEXT DEFAULT 'pending', -- 'pending', 'syncing', 'success', 'error'
  sync_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Synced Campaigns (campaigns from connected platforms)
CREATE TABLE public.synced_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  integration_id UUID NOT NULL REFERENCES public.outbound_integrations(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  external_campaign_id TEXT NOT NULL, -- ID from Reply.io/Smartlead/etc
  name TEXT NOT NULL,
  status TEXT, -- 'active', 'paused', 'completed', etc.
  stats JSONB DEFAULT '{}', -- open rates, reply rates, etc.
  raw_data JSONB DEFAULT '{}', -- full API response for reference
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(integration_id, external_campaign_id)
);

-- 3. Synced Sequences (email sequences/steps from campaigns)
CREATE TABLE public.synced_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.synced_campaigns(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  external_sequence_id TEXT, -- ID from the platform if available
  step_number INTEGER NOT NULL,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  delay_days INTEGER DEFAULT 0, -- days after previous step
  stats JSONB DEFAULT '{}', -- per-step stats
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 4. Synced Contacts (contacts with engagement data from campaigns)
CREATE TABLE public.synced_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.synced_campaigns(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  external_contact_id TEXT, -- ID from the platform
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  job_title TEXT,
  status TEXT, -- 'active', 'replied', 'bounced', 'unsubscribed', etc.
  engagement_data JSONB DEFAULT '{}', -- opens, clicks, replies, etc.
  custom_fields JSONB DEFAULT '{}',
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. Copy Templates (AI-remixed email templates)
CREATE TABLE public.copy_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  source_sequence_id UUID REFERENCES public.synced_sequences(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  remix_prompt TEXT, -- the AI prompt used to create this
  is_favorite BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_outbound_integrations_team ON public.outbound_integrations(team_id);
CREATE INDEX idx_synced_campaigns_team ON public.synced_campaigns(team_id);
CREATE INDEX idx_synced_campaigns_integration ON public.synced_campaigns(integration_id);
CREATE INDEX idx_synced_sequences_campaign ON public.synced_sequences(campaign_id);
CREATE INDEX idx_synced_sequences_team ON public.synced_sequences(team_id);
CREATE INDEX idx_synced_contacts_campaign ON public.synced_contacts(campaign_id);
CREATE INDEX idx_synced_contacts_team ON public.synced_contacts(team_id);
CREATE INDEX idx_synced_contacts_email ON public.synced_contacts(email);
CREATE INDEX idx_copy_templates_team ON public.copy_templates(team_id);

-- =============================================
-- ENABLE RLS
-- =============================================
ALTER TABLE public.outbound_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copy_templates ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS POLICIES - Outbound Integrations
-- =============================================
CREATE POLICY "Users can view their team integrations"
  ON public.outbound_integrations FOR SELECT
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can create integrations for their team"
  ON public.outbound_integrations FOR INSERT
  WITH CHECK (team_id = public.get_user_team_id(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Users can update their team integrations"
  ON public.outbound_integrations FOR UPDATE
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can delete their team integrations"
  ON public.outbound_integrations FOR DELETE
  USING (team_id = public.get_user_team_id(auth.uid()));

-- =============================================
-- RLS POLICIES - Synced Campaigns
-- =============================================
CREATE POLICY "Users can view their team campaigns"
  ON public.synced_campaigns FOR SELECT
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can create campaigns for their team"
  ON public.synced_campaigns FOR INSERT
  WITH CHECK (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can update their team campaigns"
  ON public.synced_campaigns FOR UPDATE
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can delete their team campaigns"
  ON public.synced_campaigns FOR DELETE
  USING (team_id = public.get_user_team_id(auth.uid()));

-- =============================================
-- RLS POLICIES - Synced Sequences
-- =============================================
CREATE POLICY "Users can view their team sequences"
  ON public.synced_sequences FOR SELECT
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can create sequences for their team"
  ON public.synced_sequences FOR INSERT
  WITH CHECK (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can update their team sequences"
  ON public.synced_sequences FOR UPDATE
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can delete their team sequences"
  ON public.synced_sequences FOR DELETE
  USING (team_id = public.get_user_team_id(auth.uid()));

-- =============================================
-- RLS POLICIES - Synced Contacts
-- =============================================
CREATE POLICY "Users can view their team contacts"
  ON public.synced_contacts FOR SELECT
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can create contacts for their team"
  ON public.synced_contacts FOR INSERT
  WITH CHECK (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can update their team contacts"
  ON public.synced_contacts FOR UPDATE
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can delete their team contacts"
  ON public.synced_contacts FOR DELETE
  USING (team_id = public.get_user_team_id(auth.uid()));

-- =============================================
-- RLS POLICIES - Copy Templates
-- =============================================
CREATE POLICY "Users can view their team copy templates"
  ON public.copy_templates FOR SELECT
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can create copy templates for their team"
  ON public.copy_templates FOR INSERT
  WITH CHECK (team_id = public.get_user_team_id(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Users can update their team copy templates"
  ON public.copy_templates FOR UPDATE
  USING (team_id = public.get_user_team_id(auth.uid()));

CREATE POLICY "Users can delete their team copy templates"
  ON public.copy_templates FOR DELETE
  USING (team_id = public.get_user_team_id(auth.uid()));

-- =============================================
-- UPDATE TRIGGERS
-- =============================================
CREATE TRIGGER update_outbound_integrations_updated_at
  BEFORE UPDATE ON public.outbound_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_synced_campaigns_updated_at
  BEFORE UPDATE ON public.synced_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_synced_sequences_updated_at
  BEFORE UPDATE ON public.synced_sequences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_synced_contacts_updated_at
  BEFORE UPDATE ON public.synced_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_copy_templates_updated_at
  BEFORE UPDATE ON public.copy_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();