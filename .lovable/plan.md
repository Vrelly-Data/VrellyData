
## Change: Demote Richard Dawson from Admin to Member

### Current State

The database has the following roles:

| Name | Role | Role ID |
|---|---|---|
| Richard Dawson | **admin** | `1592b26b-8718-4021-be86-7f80d426e830` |
| myall budden | admin (own team) | `f7a671df-1e4b-4e5e-822d-bff3d89d7969` |
| myall budden | member (another team) | `aba65194-7e6f-43a6-9579-16dfef096297` |

### What Needs to Change

Richard Dawson's `user_roles` record (ID: `1592b26b-8718-4021-be86-7f80d426e830`) needs to be updated from `admin` → `member`.

This is a **data change only** — no code changes are needed.

### SQL to Execute

```sql
UPDATE public.user_roles
SET role = 'member'
WHERE id = '1592b26b-8718-4021-be86-7f80d426e830';
```

### What This Does

- Richard Dawson will lose access to the Admin panel (`/admin`) and all admin-gated features
- Myall Budden's admin status on their own team is untouched
- The `ProtectedRoute` and `AdminRoute` components in the app already read from `user_roles`, so the access restriction will take effect immediately on Richard's next page load — no code changes required

### No Code Changes Required

The existing `isAdmin()` function in `authStore.ts` and the `AdminRoute` / `ProtectedRoute` components already correctly read from the `user_roles` table server-side, so this database change alone is sufficient.
