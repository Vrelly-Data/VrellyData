
-- 1. Create materialized view with pre-computed filter suggestions
CREATE MATERIALIZED VIEW public.mv_filter_suggestions AS
SELECT
  (
    SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
    FROM (
      SELECT DISTINCT LOWER(TRIM(val)) as val
      FROM free_data fd,
      LATERAL unnest(string_to_array(fd.entity_data->>'interests', ',')) AS val
      WHERE fd.entity_data->>'interests' IS NOT NULL
        AND TRIM(val) <> ''
      ORDER BY val
      LIMIT 500
    ) sub
  ) AS interests,
  (
    SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
    FROM (
      SELECT DISTINCT LOWER(TRIM(val)) as val
      FROM free_data fd,
      LATERAL unnest(string_to_array(fd.entity_data->>'skills', ',')) AS val
      WHERE fd.entity_data->>'skills' IS NOT NULL
        AND TRIM(val) <> ''
      ORDER BY val
      LIMIT 500
    ) sub
  ) AS skills,
  (
    SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
    FROM (
      SELECT DISTINCT LOWER(TRIM(COALESCE(
        NULLIF(TRIM(fd.entity_data->>'industry'), ''), 
        NULLIF(TRIM(fd.entity_data->>'companyIndustry'), '')
      ))) as val
      FROM free_data fd
      WHERE COALESCE(fd.entity_data->>'industry', fd.entity_data->>'companyIndustry') IS NOT NULL
        AND COALESCE(
          NULLIF(TRIM(fd.entity_data->>'industry'), ''), 
          NULLIF(TRIM(fd.entity_data->>'companyIndustry'), '')
        ) IS NOT NULL
      ORDER BY val
      LIMIT 500
    ) sub
  ) AS industries,
  (
    SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
    FROM (
      SELECT DISTINCT LOWER(TRIM(TRIM(tech::text, '"'))) as val
      FROM free_data fd,
      LATERAL jsonb_array_elements(
        CASE 
          WHEN jsonb_typeof(fd.entity_data->'technologies') = 'array' 
          THEN fd.entity_data->'technologies'
          ELSE '[]'::jsonb
        END
      ) AS tech
      WHERE fd.entity_data->'technologies' IS NOT NULL
        AND TRIM(tech::text, '"') <> ''
      ORDER BY val
      LIMIT 500
    ) sub
  ) AS technologies;

-- 2. Unique index to enable REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_filter_suggestions_unique ON public.mv_filter_suggestions ((1));

-- 3. Replace get_filter_suggestions() to read from the materialized view
CREATE OR REPLACE FUNCTION public.get_filter_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'interests', mv.interests,
    'skills', mv.skills,
    'industries', mv.industries,
    'technologies', mv.technologies
  ) INTO result
  FROM public.mv_filter_suggestions mv
  LIMIT 1;

  RETURN COALESCE(result, jsonb_build_object(
    'interests', '[]'::jsonb,
    'skills', '[]'::jsonb,
    'industries', '[]'::jsonb,
    'technologies', '[]'::jsonb
  ));
END;
$function$;

-- 4. Helper function to refresh the materialized view
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
