-- Sender Project: External projects and campaigns configuration
CREATE TABLE IF NOT EXISTS public.external_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  name TEXT NOT NULL,
  api_endpoint TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.external_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.external_projects(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  field_mappings JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.external_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_campaigns ENABLE ROW LEVEL SECURITY;

-- RLS Policies for external_projects
CREATE POLICY "Users can view team external projects"
  ON public.external_projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = external_projects.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Team admins can manage external projects"
  ON public.external_projects FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = external_projects.team_id
      AND team_memberships.user_id = auth.uid()
      AND team_memberships.role = 'admin'
    )
  );

-- RLS Policies for external_campaigns
CREATE POLICY "Users can view team external campaigns"
  ON public.external_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM external_projects ep
      JOIN team_memberships tm ON tm.team_id = ep.team_id
      WHERE ep.id = external_campaigns.project_id
      AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Team admins can manage external campaigns"
  ON public.external_campaigns FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM external_projects ep
      JOIN team_memberships tm ON tm.team_id = ep.team_id
      WHERE ep.id = external_campaigns.project_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
    )
  );

-- Receiver Project: API keys and received contacts
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.received_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  contact_data JSONB NOT NULL,
  source_project TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.received_contacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for api_keys
CREATE POLICY "Team admins can manage api keys"
  ON public.api_keys FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = api_keys.team_id
      AND team_memberships.user_id = auth.uid()
      AND team_memberships.role = 'admin'
    )
  );

-- RLS Policies for campaigns
CREATE POLICY "Users can view team campaigns"
  ON public.campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = campaigns.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Team admins can manage campaigns"
  ON public.campaigns FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = campaigns.team_id
      AND team_memberships.user_id = auth.uid()
      AND team_memberships.role = 'admin'
    )
  );

-- RLS Policies for received_contacts
CREATE POLICY "Users can view team received contacts"
  ON public.received_contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = received_contacts.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert received contacts"
  ON public.received_contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = received_contacts.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_external_projects_updated_at
  BEFORE UPDATE ON public.external_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();