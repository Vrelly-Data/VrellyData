
## Fix: User Deletion Still Blocked — New Constraint Identified

### What Happened

The previous migration successfully fixed `audit_log` and `profiles`. However, there is a chain of blocking constraints. Now that profiles can be deleted, the database hits the next blocker:

```
ERROR: update or delete on table "profiles" violates foreign key constraint 
"audiences_created_by_fkey" on table "audiences" (SQLSTATE 23503)
```

### Full Constraint Audit

A full scan of all foreign keys in the database was run. Here are every constraint referencing `profiles.id` and their current delete behavior:

| Constraint | Table | Column | Delete Rule | Status |
|---|---|---|---|---|
| `audiences_created_by_fkey` | `audiences` | `created_by` | NO ACTION | BLOCKING |
| `unlock_events_user_id_fkey` | `unlock_events` | `user_id` | NO ACTION | BLOCKING |
| `team_memberships_user_id_fkey` | `team_memberships` | `user_id` | CASCADE | OK |
| `credit_transactions_user_id_fkey` | `credit_transactions` | `user_id` | CASCADE | OK |

### Fix: One More Migration

Two constraints need to be updated to `ON DELETE CASCADE`:

1. `audiences.created_by` — when a user is deleted, their audiences should be deleted too (the audiences they created belong to their team, the team will also be cleaned up)
2. `unlock_events.user_id` — when a user is deleted, their unlock event history should cascade away

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

- When a user is deleted, their `audiences` records (where they are `created_by`) and `unlock_events` records will be automatically removed
- The cascade chain then becomes: `auth.users` → `profiles` (CASCADE) → `audiences` (CASCADE), `unlock_events` (CASCADE), `audit_log` (CASCADE)
- All other tables (`team_memberships`, `credit_transactions`) already have proper CASCADE rules
- No code changes required — just this migration

### No Code Changes Required

The `admin-delete-user` edge function, hook, and UI are all correct. Only database constraint fixes are needed.
