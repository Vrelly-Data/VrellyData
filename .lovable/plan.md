
## Critical Bug: Every New User Gets Admin Role

### Root Cause Confirmed

The `handle_new_user_team` database trigger, which runs automatically every time a new user signs up, contains this line:

```sql
INSERT INTO public.user_roles (user_id, team_id, role)
VALUES (NEW.id, new_team_id, 'admin');  -- BUG: should be 'member'
```

Every single user who creates an account is being inserted into `user_roles` with the `admin` role. This gives them full admin access to the platform — including the Admin panel, all user management, and all admin-only features.

This was confirmed by querying the database: the test signup "Incrementums Test" (myall@incrementums.org) that just signed up moments ago is already an admin.

### Impact

- Every user who has signed up on the live site has admin-level access
- They can access `/admin`, view all users, delete users, manage sales knowledge, etc.
- This is an active security breach while the site is live

### The Fix

One database migration to correct the trigger — changing `'admin'` to `'member'`:

```sql
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
```

### Cleanup: Remove Accidental Admin Roles

After fixing the trigger, any users who signed up and were incorrectly granted admin access need to have their role corrected to `member`:

```sql
-- Downgrade all non-intended admins (everyone except myallbudden@gmail.com)
UPDATE public.user_roles
SET role = 'member'
WHERE role = 'admin'
AND user_id != '9840671d-369f-438e-ac6e-f319771a1b5a';  -- your admin user ID
```

Currently, the only users in the database are:
- `myallbudden@gmail.com` (you, the legitimate admin) — stays as admin
- `myall@incrementums.org` (the test signup from a moment ago) — gets corrected to member

### What This Does NOT Change

- Your admin account (`myallbudden@gmail.com`) keeps its `admin` role — no change
- All future signups will correctly get the `member` role
- The `isAdmin()` check in the app correctly reads from the database, so this fix takes effect immediately for all existing sessions

### Steps to Apply

1. Run the migration to fix the trigger function (changes `'admin'` → `'member'`)
2. Run the cleanup SQL to downgrade incorrectly-assigned admins
3. Verify by signing up a test account — it should NOT have admin access
