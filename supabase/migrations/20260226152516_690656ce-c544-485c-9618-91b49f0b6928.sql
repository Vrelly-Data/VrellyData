
-- Fix: Revoke API access to the materialized view (it should only be accessed via the RPC function)
REVOKE ALL ON public.mv_filter_suggestions FROM anon, authenticated;

-- Fix: Set search_path on refresh_filter_suggestions
CREATE OR REPLACE FUNCTION public.refresh_filter_suggestions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_filter_suggestions;
END;
$function$;
