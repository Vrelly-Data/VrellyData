

## Fix: Distinguish Platform Admins from Team Admins

### Problem
The `handle_new_user_team` trigger gives every new user the `admin` role in their own auto-created team. The sidebar and `AdminRoute` check `userRoles.some(r => r.role === 'admin')`, which matches ANY admin role -- so every user sees the Admin panel.

### Solution
Use the existing `is_global_admin` database function (which checks if a user is admin in any team) is not the right check either since every user is admin of their own team. Instead, we need a concept of "platform admin" vs "team admin."

The cleanest fix: stop assigning `admin` role to every new user in `handle_new_user_team`. New users should get `member` role in `user_roles`. Only your account (myallbudden@gmail.com) should have `admin` in `user_roles`.

### Changes

**1. Update `handle_new_user_team` trigger (database migration)**
- Change the `user_roles` insert from `role = 'admin'` to `role = 'member'`
- New users will still be members of their team but won't have admin privileges

**2. Clean up existing bad data (data update)**
- Remove the `admin` role from Richard Dawson's `user_roles` entry (and any other non-admin users who got it)
- Keep only your account's admin role intact

**3. No frontend changes needed**
- The sidebar already checks `userRoles.some(r => r.role === 'admin')` which will now correctly return `false` for regular users
- `AdminRoute`, `ProtectedRoute`, and `is_global_admin()` all rely on the same `user_roles` table, so they'll work correctly once the data and trigger are fixed

### Technical Details

Database migration to update the trigger:
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_team_id UUID;
BEGIN
  INSERT INTO public.teams (name)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'name', 'My Team') || '''s Team')
  RETURNING id INTO new_team_id;

  INSERT INTO public.team_memberships (user_id, team_id, role)
  VALUES (NEW.id, new_team_id, 'member');

  -- Changed: new users get 'member' role, not 'admin'
  INSERT INTO public.user_roles (user_id, team_id, role)
  VALUES (NEW.id, new_team_id, 'member');

  RETURN NEW;
END;
$$;
```

Data cleanup (using insert/update tool):
- Query all `user_roles` where `role = 'admin'` and the user is NOT your account
- Update those rows to `role = 'member'`

