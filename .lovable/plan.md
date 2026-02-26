

# Security Fixes Implementation Plan

## Migration 1: Single SQL migration covering all 9 fixes

### Fix 1 - Create safe views for `outbound_integrations` and `external_projects`
- Create `outbound_integrations_safe` view excluding `api_key_encrypted`, `webhook_secret`
- Create `external_projects_safe` view excluding `api_key_encrypted`
- Both views use `security_invoker = on` so RLS still applies

### Fix 2 - Rename misleading policies on `people_records` and `company_records`
- Drop "Only admins can bulk access people records" SELECT policy
- Drop "Only admins can bulk access company records" SELECT policy
- (The duplicate "Users can view team..." policies already exist and are correct, so just dropping the misleading ones)

### Fix 3 - Fix `teams` SELECT policy bug
- Current policy has `team_memberships.team_id = team_memberships.id` (self-join bug)
- Replace with `team_memberships.team_id = teams.id`

### Fix 4 - Restrict `teams` INSERT policy
- Change `WITH CHECK (true)` to `WITH CHECK (false)` since only the `handle_new_user_team` trigger (SECURITY DEFINER) should create teams

### Fix 5 - Restrict `team_memberships` INSERT policy
- Change `WITH CHECK (true)` to `WITH CHECK (false)` since only the trigger should insert memberships

### Fix 6 - Restrict `resources` ALL policy
- Drop the overly permissive `USING (true) WITH CHECK (true)` ALL policy
- Recreate scoped to global admins only: `USING (is_global_admin(auth.uid()))`

### Fix 7 - Restrict `resource_api_keys` ALL policy
- Same pattern as resources: drop permissive ALL, recreate for global admins only

### Fix 8 - Restrict `webhook_events` INSERT policy
- Change `WITH CHECK (true)` to `WITH CHECK (false)` since only edge functions (service role) insert webhook events

### Fix 9 - Enable leaked password protection
- Use auth configuration tool

## Code Change: `src/components/settings/ExternalProjectsSettings.tsx`
- Query from `external_projects_safe` view instead of `external_projects`
- Remove the "show/hide API key" toggle since the key is no longer in the view
- Show a static masked indicator instead

## Summary
- 1 database migration (all policy fixes + views)
- 1 file edit (ExternalProjectsSettings.tsx)
- No logic changes to any other part of the app

