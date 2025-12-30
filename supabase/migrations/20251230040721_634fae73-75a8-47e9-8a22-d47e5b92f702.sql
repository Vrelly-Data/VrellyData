-- Function to allow global admins to fetch all user profiles with their admin status
CREATE OR REPLACE FUNCTION public.get_all_profiles_admin()
RETURNS TABLE (
  id uuid,
  name text,
  credits integer,
  plan text,
  subscription_status text,
  subscription_tier text,
  created_at timestamptz,
  is_admin boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_global_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  RETURN QUERY 
  SELECT 
    p.id,
    p.name,
    p.credits,
    p.plan,
    p.subscription_status,
    p.subscription_tier,
    p.created_at,
    EXISTS (
      SELECT 1 FROM public.user_roles ur 
      WHERE ur.user_id = p.id AND ur.role = 'admin'
    ) as is_admin
  FROM profiles p
  ORDER BY p.created_at DESC;
END;
$$;