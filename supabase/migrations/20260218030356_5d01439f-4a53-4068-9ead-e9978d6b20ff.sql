
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
  
  -- Add user as MEMBER in user_roles (not admin)
  INSERT INTO public.user_roles (user_id, team_id, role)
  VALUES (NEW.id, new_team_id, 'member');
  
  RETURN NEW;
END;
$$;
