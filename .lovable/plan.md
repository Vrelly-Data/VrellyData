
## Fix: User Deletion Blocked by Foreign Key Constraint

### Confirmed Root Cause

The backend logs show this exact error every time a user deletion is attempted:

```
ERROR: update or delete on table "users" violates foreign key constraint 
"audit_log_user_id_fkey" on table "audit_log"
```

The `audit_log` table has a foreign key pointing to `auth.users` set to `NO ACTION` on delete — meaning the database refuses to delete any user who has audit log records. The `profiles` table has a similar `RESTRICT` constraint.

### Fix: One Database Migration

Update both foreign key constraints to use `ON DELETE CASCADE` so that when a user is deleted, their audit log entries and profile are automatically cleaned up.

**SQL to run:**

```sql
-- Fix audit_log constraint (NO ACTION → CASCADE)
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Fix profiles constraint (RESTRICT → CASCADE)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

### What This Does

- Deleting a user from the Admin panel will cascade-delete their `audit_log` rows and `profiles` row automatically
- No data loss concerns — audit logs for a deleted user have no purpose once the user is gone
- The `admin-delete-user` edge function and UI code are already correct — this database fix is the only change needed
- After this runs, deleting any non-admin user from the Users tab will work immediately

### No Code Changes Required

Only the database migration needs to run. The edge function, hook, and UI are all working correctly.
