-- Admin → Inference Insights: LinkedIn connection accepts, platform-reported.
-- outbound_integrations is readable only by the owning team (RLS), so a platform
-- admin cannot sum stats_cache across teams from the browser. This function
-- returns ONLY the aggregate (never api keys) and is gated to platform admins.
-- Idempotent: CREATE OR REPLACE FUNCTION

CREATE OR REPLACE FUNCTION public.admin_linkedin_acceptance_stats(p_team_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH scoped AS (
  SELECT
    lower(i.platform) AS platform,
    -- Reply.io teams cache linkedinConnectionsAccepted at the top level;
    -- HeyReach also keeps the raw overallStats.connectionsAccepted
    COALESCE(
      (i.stats_cache->>'linkedinConnectionsAccepted')::bigint,
      (i.stats_cache->'overallStats'->>'connectionsAccepted')::bigint
    ) AS accepted,
    (i.stats_cache->>'cached_at')::timestamptz AS cached_at
  FROM public.outbound_integrations i
  WHERE lower(i.platform) IN ('reply.io', 'heyreach')
    AND (p_team_ids IS NULL OR i.team_id = ANY(p_team_ids))
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.is_platform_admin = true OR p.is_super_admin = true)
    )
)
SELECT jsonb_build_object(
  'replyIoAccepted',      COALESCE(SUM(accepted) FILTER (WHERE platform = 'reply.io'), 0),
  'replyIoIntegrations',  COUNT(*) FILTER (WHERE platform = 'reply.io' AND accepted IS NOT NULL),
  'heyreachAccepted',     COALESCE(SUM(accepted) FILTER (WHERE platform = 'heyreach'), 0),
  'heyreachIntegrations', COUNT(*) FILTER (WHERE platform = 'heyreach' AND accepted IS NOT NULL),
  'oldestCachedAt',       MIN(cached_at)
)
FROM scoped;
$$;

REVOKE ALL ON FUNCTION public.admin_linkedin_acceptance_stats(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_linkedin_acceptance_stats(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_linkedin_acceptance_stats(uuid[])
  IS 'Platform-admin only: sum of platform-reported LinkedIn connection accepts from outbound_integrations.stats_cache (Reply.io teams + HeyReach overallStats). Non-admins get zeros.';
