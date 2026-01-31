-- Create a secure function to fetch anonymized leaderboard data across all teams
CREATE OR REPLACE FUNCTION get_campaign_leaderboard(p_limit integer DEFAULT 50)
RETURNS TABLE (
  rank integer,
  messages_sent bigint,
  replies bigint,
  reply_rate numeric,
  contacts bigint,
  completion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROW_NUMBER() OVER (ORDER BY 
      CASE WHEN (stats->>'sent')::int > 0 
           THEN ((stats->>'replies')::numeric / (stats->>'sent')::numeric) * 100 
           ELSE 0 END DESC
    )::integer as rank,
    COALESCE((stats->>'sent')::bigint, 0) as messages_sent,
    COALESCE((stats->>'replies')::bigint, 0) as replies,
    CASE WHEN (stats->>'sent')::int > 0 
         THEN ROUND(((stats->>'replies')::numeric / (stats->>'sent')::numeric) * 100, 1) 
         ELSE 0 END as reply_rate,
    COALESCE((stats->>'peopleCount')::bigint, 0) as contacts,
    CASE WHEN (stats->>'peopleCount')::int > 0 
         THEN ROUND(((stats->>'peopleFinished')::numeric / (stats->>'peopleCount')::numeric) * 100, 1) 
         ELSE 0 END as completion_rate
  FROM synced_campaigns
  WHERE is_linked = true
    AND (stats->>'sent')::int > 0
  ORDER BY reply_rate DESC
  LIMIT p_limit;
END;
$$;