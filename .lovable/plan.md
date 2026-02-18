
## Fix: Apply Missing Database Migration

### Confirmed Root Cause

The backend logs show the exact same error persisting:

```
ERROR: update or delete on table "profiles" violates foreign key constraint 
"audiences_created_by_fkey" on table "audiences" (SQLSTATE 23503)
```

The previously approved migration to fix `audiences.created_by` and `unlock_events.user_id` was never actually executed against the database. These two foreign key constraints are still set to `NO ACTION`, blocking deletion.

### Fix: Run the Migration Now

The SQL to apply:

```sql
-- Fix audiences.created_by (NO ACTION → CASCADE)
ALTER TABLE public.audiences
  DROP CONSTRAINT IF EXISTS audiences_created_by_fkey;

ALTER TABLE public.audiences
  ADD CONSTRAINT audiences_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Fix unlock_events.user_id (NO ACTION → CASCADE)
ALTER TABLE public.unlock_events
  DROP CONSTRAINT IF EXISTS unlock_events_user_id_fkey;

ALTER TABLE public.unlock_events
  ADD CONSTRAINT unlock_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
```

### What This Does

- When a user is deleted, their `audiences` rows (where they are `created_by`) are automatically removed
- When a user is deleted, their `unlock_events` rows are automatically removed
- The full cascade chain becomes: `auth.users` → `profiles` (CASCADE) → `audiences` (CASCADE), `unlock_events` (CASCADE), `audit_log` (CASCADE)
- No code changes needed — only this migration

### No Code Changes Required

The edge function, hook, and UI are all correct and ready. This database fix is the only remaining blocker.
