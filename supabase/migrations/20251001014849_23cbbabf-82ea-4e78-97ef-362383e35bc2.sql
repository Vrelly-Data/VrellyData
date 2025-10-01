-- Create enum types
CREATE TYPE public.user_role AS ENUM ('admin', 'member');
CREATE TYPE public.entity_type AS ENUM ('person', 'company');
CREATE TYPE public.export_status AS ENUM ('pending', 'running', 'done', 'failed');
CREATE TYPE public.export_format AS ENUM ('csv', 'json');
CREATE TYPE public.suppression_type AS ENUM ('email', 'domain', 'company_id', 'person_id');

-- Create profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  role public.user_role NOT NULL DEFAULT 'member',
  credits INT NOT NULL DEFAULT 0,
  plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create teams table
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create team memberships table
CREATE TABLE public.team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, team_id)
);

-- Create audiences table
CREATE TABLE public.audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.entity_type NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  result_count INT DEFAULT 0,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create filter presets table
CREATE TABLE public.filter_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.entity_type NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create unlock events table
CREATE TABLE public.unlock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  audience_id UUID REFERENCES public.audiences(id) ON DELETE SET NULL,
  entity_type public.entity_type NOT NULL,
  entity_external_id TEXT NOT NULL,
  cost INT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create suppression lists table
CREATE TABLE public.suppression_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  type public.suppression_type NOT NULL,
  value TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, type, value)
);

-- Create export jobs table
CREATE TABLE public.export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  audience_id UUID NOT NULL REFERENCES public.audiences(id) ON DELETE CASCADE,
  status public.export_status NOT NULL DEFAULT 'pending',
  format public.export_format NOT NULL DEFAULT 'csv',
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Create webhooks table
CREATE TABLE public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filter_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unlock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppression_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for teams (users can see teams they belong to)
CREATE POLICY "Users can view their teams" ON public.teams FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = id AND user_id = auth.uid()));
CREATE POLICY "Users can insert teams" ON public.teams FOR INSERT WITH CHECK (true);
CREATE POLICY "Team admins can update teams" ON public.teams FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = id AND user_id = auth.uid() AND role = 'admin'));

-- RLS Policies for team_memberships
CREATE POLICY "Users can view their team memberships" ON public.team_memberships FOR SELECT 
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.team_memberships tm WHERE tm.team_id = team_id AND tm.user_id = auth.uid()));
CREATE POLICY "Users can insert team memberships" ON public.team_memberships FOR INSERT WITH CHECK (true);
CREATE POLICY "Team admins can manage memberships" ON public.team_memberships FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.team_memberships tm WHERE tm.team_id = team_id AND tm.user_id = auth.uid() AND tm.role = 'admin'));
CREATE POLICY "Team admins can delete memberships" ON public.team_memberships FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.team_memberships tm WHERE tm.team_id = team_id AND tm.user_id = auth.uid() AND tm.role = 'admin'));

-- RLS Policies for audiences
CREATE POLICY "Users can view team audiences" ON public.audiences FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = audiences.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can create audiences" ON public.audiences FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = audiences.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can update team audiences" ON public.audiences FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = audiences.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete team audiences" ON public.audiences FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = audiences.team_id AND user_id = auth.uid()));

-- RLS Policies for filter_presets (same as audiences)
CREATE POLICY "Users can view team presets" ON public.filter_presets FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = filter_presets.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can create presets" ON public.filter_presets FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = filter_presets.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can update team presets" ON public.filter_presets FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = filter_presets.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete team presets" ON public.filter_presets FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = filter_presets.team_id AND user_id = auth.uid()));

-- RLS Policies for unlock_events
CREATE POLICY "Users can view their unlock events" ON public.unlock_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create unlock events" ON public.unlock_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for suppression_lists
CREATE POLICY "Users can view team suppressions" ON public.suppression_lists FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = suppression_lists.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can create suppressions" ON public.suppression_lists FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = suppression_lists.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete suppressions" ON public.suppression_lists FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = suppression_lists.team_id AND user_id = auth.uid()));

-- RLS Policies for export_jobs
CREATE POLICY "Users can view team exports" ON public.export_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = export_jobs.team_id AND user_id = auth.uid()));
CREATE POLICY "Users can create exports" ON public.export_jobs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = export_jobs.team_id AND user_id = auth.uid()));

-- RLS Policies for webhooks
CREATE POLICY "Team admins can manage webhooks" ON public.webhooks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = webhooks.team_id AND user_id = auth.uid() AND role = 'admin'));

-- Create function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, credits)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name', 100);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_audiences_updated_at BEFORE UPDATE ON public.audiences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();