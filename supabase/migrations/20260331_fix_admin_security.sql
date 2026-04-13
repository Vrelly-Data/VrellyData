-- Separate platform admin from team admin
-- Every user currently has role='admin' in user_roles (their own team)
-- is_global_admin() was querying user_roles with no team scope = everyone is admin
-- Fix: add is_platform_admin column to profiles, scope admin check to that column only

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND is_platform_admin = true
  )
$$;

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Platform admins can read all profiles"
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR is_global_admin(auth.uid())
  );
