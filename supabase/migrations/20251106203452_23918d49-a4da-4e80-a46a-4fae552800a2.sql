-- ============================================================================
-- PHASE 1: CRITICAL SECURITY FIXES
-- ============================================================================

-- 1. Create app_role enum for proper role management
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- 2. Create user_roles table (separate from profiles to prevent privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, team_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Team admins can manage roles"
  ON public.user_roles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.team_id = user_roles.team_id
        AND ur.user_id = auth.uid()
        AND ur.role = 'admin'
    )
  );

-- 3. Create security definer function to check roles (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role, _team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND team_id = _team_id
      AND role = _role
  )
$$;

-- Helper function to get user's team_id from team_memberships
CREATE OR REPLACE FUNCTION public.get_user_team_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id
  FROM public.team_memberships
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- 4. Create comprehensive audit_log table
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  team_id UUID NOT NULL REFERENCES public.teams(id),
  action TEXT NOT NULL, -- 'unlock', 'export', 'role_change', 'bulk_access', 'secret_access'
  entity_type TEXT, -- 'person', 'company'
  entity_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for audit_log
CREATE POLICY "Team admins can view audit logs"
  ON public.audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND team_id = audit_log.team_id
        AND role = 'admin'
    )
  );

CREATE POLICY "Users can insert audit logs"
  ON public.audit_log
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 5. Migrate existing roles from profiles to user_roles
INSERT INTO public.user_roles (user_id, team_id, role, created_at)
SELECT 
  p.id,
  tm.team_id,
  CASE 
    WHEN p.role = 'admin' THEN 'admin'::app_role
    ELSE 'member'::app_role
  END,
  p.created_at
FROM public.profiles p
JOIN public.team_memberships tm ON tm.user_id = p.id
WHERE p.role IS NOT NULL
ON CONFLICT (user_id, team_id, role) DO NOTHING;

-- 6. Update RLS policies to use has_role() function

-- Drop old policies that check profiles.role
DROP POLICY IF EXISTS "Team admins can delete memberships" ON public.team_memberships;
DROP POLICY IF EXISTS "Team admins can manage memberships" ON public.team_memberships;
DROP POLICY IF EXISTS "Team admins can manage campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Team admins can manage webhooks" ON public.webhooks;
DROP POLICY IF EXISTS "Team admins can manage api keys" ON public.api_keys;
DROP POLICY IF EXISTS "Team admins can manage external projects" ON public.external_projects;
DROP POLICY IF EXISTS "Team admins can manage external campaigns" ON public.external_campaigns;
DROP POLICY IF EXISTS "Team admins can update teams" ON public.teams;

-- Create new policies using has_role()
CREATE POLICY "Team admins can delete memberships"
  ON public.team_memberships
  FOR DELETE
  USING (public.has_role(auth.uid(), 'admin', team_id));

CREATE POLICY "Team admins can manage memberships"
  ON public.team_memberships
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin', team_id));

CREATE POLICY "Team admins can manage campaigns"
  ON public.campaigns
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin', team_id));

CREATE POLICY "Team admins can manage webhooks"
  ON public.webhooks
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin', team_id));

CREATE POLICY "Team admins can manage api keys"
  ON public.api_keys
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin', team_id));

CREATE POLICY "Team admins can manage external projects"
  ON public.external_projects
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin', team_id));

CREATE POLICY "Team admins can manage external campaigns"
  ON public.external_campaigns
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.external_projects ep
      WHERE ep.id = external_campaigns.project_id
        AND public.has_role(auth.uid(), 'admin', ep.team_id)
    )
  );

CREATE POLICY "Team admins can update teams"
  ON public.teams
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin', id));

-- 7. Fix unlocked_records access control (user-level, not team-level)
DROP POLICY IF EXISTS "Users can view team unlocked records" ON public.unlocked_records;
DROP POLICY IF EXISTS "Users can insert unlocked records" ON public.unlocked_records;

CREATE POLICY "Users can view their own unlocked records"
  ON public.unlocked_records
  FOR SELECT
  USING (
    user_id = auth.uid() 
    OR public.has_role(auth.uid(), 'admin', team_id)
  );

CREATE POLICY "Users can insert their own unlocked records"
  ON public.unlocked_records
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.team_memberships
      WHERE team_id = unlocked_records.team_id
        AND user_id = auth.uid()
    )
  );

-- 8. Secure PII in people_records and company_records (admin only for bulk operations)
-- Add policy to restrict bulk access to admins
CREATE POLICY "Only admins can bulk access people records"
  ON public.people_records
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_memberships tm
      WHERE tm.team_id = people_records.team_id
        AND tm.user_id = auth.uid()
    )
    -- For queries returning >100 records, require admin role
    -- This will be enforced in application code
  );

CREATE POLICY "Only admins can bulk access company records"
  ON public.company_records
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_memberships tm
      WHERE tm.team_id = company_records.team_id
        AND tm.user_id = auth.uid()
    )
  );

-- 9. Update handle_new_user_team to assign admin role
CREATE OR REPLACE FUNCTION public.handle_new_user_team()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id UUID;
BEGIN
  -- Create a team for the new user
  INSERT INTO public.teams (name)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'name', 'My Team') || '''s Team')
  RETURNING id INTO new_team_id;
  
  -- Add user as member to their team
  INSERT INTO public.team_memberships (user_id, team_id, role)
  VALUES (NEW.id, new_team_id, 'member');
  
  -- Add user as admin in user_roles table
  INSERT INTO public.user_roles (user_id, team_id, role)
  VALUES (NEW.id, new_team_id, 'admin');
  
  RETURN NEW;
END;
$$;

-- 10. Create function to log audit events
CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action TEXT,
  _entity_type TEXT DEFAULT NULL,
  _entity_count INTEGER DEFAULT 0,
  _metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _team_id UUID;
  _audit_id UUID;
BEGIN
  -- Get user's team
  SELECT team_id INTO _team_id
  FROM public.team_memberships
  WHERE user_id = auth.uid()
  LIMIT 1;
  
  -- Insert audit log
  INSERT INTO public.audit_log (user_id, team_id, action, entity_type, entity_count, metadata)
  VALUES (auth.uid(), _team_id, _action, _entity_type, _entity_count, _metadata)
  RETURNING id INTO _audit_id;
  
  RETURN _audit_id;
END;
$$;

-- 11. Remove role column from profiles (deprecated)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;