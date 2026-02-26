
-- Fix 1: Create safe views excluding sensitive columns
CREATE VIEW public.outbound_integrations_safe
  WITH (security_invoker = on)
AS SELECT
  id, team_id, created_by, is_active, last_synced_at,
  created_at, updated_at, links_initialized, reply_team_id,
  webhook_subscription_id, webhook_status, platform, name,
  sync_status, sync_error
FROM public.outbound_integrations;

CREATE VIEW public.external_projects_safe
  WITH (security_invoker = on)
AS SELECT
  id, team_id, is_active, created_at, updated_at, name, api_endpoint
FROM public.external_projects;

-- Fix 2: Drop misleading SELECT policies (correct duplicates already exist)
DROP POLICY IF EXISTS "Only admins can bulk access people records" ON public.people_records;
DROP POLICY IF EXISTS "Only admins can bulk access company records" ON public.company_records;

-- Fix 3: Fix teams SELECT policy bug (self-join)
DROP POLICY IF EXISTS "Users can view their teams" ON public.teams;
CREATE POLICY "Users can view their teams"
  ON public.teams FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM team_memberships
    WHERE team_memberships.team_id = teams.id
      AND team_memberships.user_id = auth.uid()
  ));

-- Fix 4: Restrict teams INSERT to trigger only
DROP POLICY IF EXISTS "Users can insert teams" ON public.teams;
CREATE POLICY "Users can insert teams"
  ON public.teams FOR INSERT
  WITH CHECK (false);

-- Fix 5: Restrict team_memberships INSERT to trigger only
DROP POLICY IF EXISTS "Users can insert team memberships" ON public.team_memberships;
CREATE POLICY "Users can insert team memberships"
  ON public.team_memberships FOR INSERT
  WITH CHECK (false);

-- Fix 6: Restrict resources ALL policy to global admins
DROP POLICY IF EXISTS "Service role can manage resources" ON public.resources;
CREATE POLICY "Admins can manage resources"
  ON public.resources FOR ALL
  USING (is_global_admin(auth.uid()))
  WITH CHECK (is_global_admin(auth.uid()));

-- Fix 7: Restrict resource_api_keys ALL policy to global admins
DROP POLICY IF EXISTS "Service role can manage resource api keys" ON public.resource_api_keys;
CREATE POLICY "Admins can manage resource api keys"
  ON public.resource_api_keys FOR ALL
  USING (is_global_admin(auth.uid()))
  WITH CHECK (is_global_admin(auth.uid()));

-- Fix 8: Restrict webhook_events INSERT
DROP POLICY IF EXISTS "Service role can insert webhook events" ON public.webhook_events;
CREATE POLICY "Service role can insert webhook events"
  ON public.webhook_events FOR INSERT
  WITH CHECK (false);
