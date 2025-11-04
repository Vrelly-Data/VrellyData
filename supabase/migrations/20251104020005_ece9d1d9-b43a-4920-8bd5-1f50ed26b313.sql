-- Fix the infinite recursion in team_memberships RLS policy
DROP POLICY IF EXISTS "Users can view their team memberships" ON team_memberships;

CREATE POLICY "Users can view their team memberships" 
ON team_memberships FOR SELECT 
USING (user_id = auth.uid());

-- Create function to auto-create team and membership on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_team()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id uuid;
BEGIN
  -- Create a team for the new user
  INSERT INTO public.teams (name)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'name', 'My Team') || '''s Team')
  RETURNING id INTO new_team_id;
  
  -- Add user as admin to their team
  INSERT INTO public.team_memberships (user_id, team_id, role)
  VALUES (NEW.id, new_team_id, 'admin');
  
  RETURN NEW;
END;
$$;

-- Create trigger to call this function after user creation
DROP TRIGGER IF EXISTS on_auth_user_created_team ON auth.users;
CREATE TRIGGER on_auth_user_created_team
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_team();

-- For existing users without teams, create teams
DO $$
DECLARE
  user_record RECORD;
  new_team_id uuid;
BEGIN
  FOR user_record IN 
    SELECT u.id, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.team_memberships tm ON tm.user_id = u.id
    WHERE tm.id IS NULL
  LOOP
    -- Create team
    INSERT INTO public.teams (name)
    VALUES (COALESCE(user_record.raw_user_meta_data->>'name', 'My Team') || '''s Team')
    RETURNING id INTO new_team_id;
    
    -- Create membership
    INSERT INTO public.team_memberships (user_id, team_id, role)
    VALUES (user_record.id, new_team_id, 'admin');
  END LOOP;
END $$;