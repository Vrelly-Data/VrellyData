-- Create unlocked records tracking table
CREATE TABLE public.unlocked_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  entity_type entity_type NOT NULL,
  entity_external_id TEXT NOT NULL,
  entity_data JSONB NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, entity_external_id, entity_type)
);

-- Create persistent people records table
CREATE TABLE public.people_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  entity_external_id TEXT NOT NULL,
  entity_data JSONB NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, entity_external_id)
);

-- Create persistent company records table
CREATE TABLE public.company_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  entity_external_id TEXT NOT NULL,
  entity_data JSONB NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, entity_external_id)
);

-- Enable RLS on all three tables
ALTER TABLE public.unlocked_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_records ENABLE ROW LEVEL SECURITY;

-- RLS policies for unlocked_records
CREATE POLICY "Users can view team unlocked records"
  ON public.unlocked_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = unlocked_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert unlocked records"
  ON public.unlocked_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = unlocked_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

-- RLS policies for people_records
CREATE POLICY "Users can view team people records"
  ON public.people_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = people_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert people records"
  ON public.people_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = people_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update team people records"
  ON public.people_records FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = people_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete team people records"
  ON public.people_records FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = people_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

-- RLS policies for company_records
CREATE POLICY "Users can view team company records"
  ON public.company_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = company_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert company records"
  ON public.company_records FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = company_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update team company records"
  ON public.company_records FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = company_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete team company records"
  ON public.company_records FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_memberships
      WHERE team_memberships.team_id = company_records.team_id
      AND team_memberships.user_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX idx_unlocked_records_team_id ON public.unlocked_records(team_id);
CREATE INDEX idx_unlocked_records_entity_external_id ON public.unlocked_records(entity_external_id);
CREATE INDEX idx_people_records_team_id ON public.people_records(team_id);
CREATE INDEX idx_company_records_team_id ON public.company_records(team_id);

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_people_records_updated_at
  BEFORE UPDATE ON public.people_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_records_updated_at
  BEFORE UPDATE ON public.company_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();