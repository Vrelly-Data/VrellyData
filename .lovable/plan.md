
## Fix: User Deletion Blocked by Foreign Key Constraints

### Root Cause

When the `admin-delete-user` backend function calls `auth.admin.deleteUser(userId)`, the database blocks it because the `audit_log` table has a foreign key (`audit_log_user_id_fkey`) pointing to `auth.users` with `NO ACTION` on delete — meaning it refuses to delete a user who has any audit log records.

Additionally, `profiles_id_fkey` uses `RESTRICT`, which could cause issues depending on deletion order.

### What Needs to Change

#### 1. Database Migration — Fix Foreign Key Constraints

Three constraints need to be updated to use `ON DELETE CASCADE`:

- `audit_log.user_id` → `auth.users` — currently `NO ACTION`, needs `CASCADE`
- `audit_log.team_id` → `teams` — currently `NO ACTION`, fine to cascade
- `profiles.id` → `auth.users` — currently `RESTRICT`, needs `CASCADE` so the profile is deleted when the auth user is deleted

The migration will:
1. Drop the blocking `audit_log_user_id_fkey` constraint
2. Re-add it with `ON DELETE CASCADE`
3. Drop `profiles_id_fkey`
4. Re-add it with `ON DELETE CASCADE`

```sql
-- Fix audit_log foreign key
ALTER TABLE public.audit_log
  DROP CONSTRAINT audit_log_user_id_fkey;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Fix profiles foreign key
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

#### 2. No Code Changes Required

The `admin-delete-user` edge function and `useAdminUsers` hook are already correct — the only issue is the database constraint. Once the migration runs, `auth.admin.deleteUser(userId)` will:
- Cascade-delete the user's `audit_log` rows automatically
- Cascade-delete their `profiles` row automatically
- The existing `user_roles` and `team_memberships` tables already have their own cascade behavior through `profiles`

### What This Does

- Deleting a user from the Admin panel will now work cleanly
- The user's audit logs and profile are removed alongside their account
- All other data (people records, campaigns, etc.) is already cleaned up via team membership cascades
- No change to the UI or edge function code is needed
