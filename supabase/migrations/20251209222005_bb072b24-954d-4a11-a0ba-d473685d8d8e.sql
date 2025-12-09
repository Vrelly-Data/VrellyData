-- Drop the problematic recursive policy that causes infinite recursion
DROP POLICY IF EXISTS "Team admins can manage roles" ON public.user_roles;

-- Create new policy using the security definer function (bypasses RLS)
CREATE POLICY "Team admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role, team_id)
);