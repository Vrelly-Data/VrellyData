-- Fix get_filter_suggestions() to apply LIMIT after DISTINCT and add technologies support
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
    'interests', (
      SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
      FROM (
        SELECT DISTINCT TRIM(val) as val
        FROM free_data fd,
        LATERAL unnest(string_to_array(fd.entity_data->>'interests', ',')) AS val
        WHERE fd.entity_data->>'interests' IS NOT NULL
          AND TRIM(val) <> ''
        ORDER BY val
        LIMIT 500
      ) sub
    ),
    'skills', (
      SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
      FROM (
        SELECT DISTINCT TRIM(val) as val
        FROM free_data fd,
        LATERAL unnest(string_to_array(fd.entity_data->>'skills', ',')) AS val
        WHERE fd.entity_data->>'skills' IS NOT NULL
          AND TRIM(val) <> ''
        ORDER BY val
        LIMIT 500
      ) sub
    ),
    'industries', (
      SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
      FROM (
        SELECT DISTINCT COALESCE(
          NULLIF(TRIM(fd.entity_data->>'industry'), ''), 
          NULLIF(TRIM(fd.entity_data->>'companyIndustry'), '')
        ) as val
        FROM free_data fd
        WHERE COALESCE(fd.entity_data->>'industry', fd.entity_data->>'companyIndustry') IS NOT NULL
          AND COALESCE(
            NULLIF(TRIM(fd.entity_data->>'industry'), ''), 
            NULLIF(TRIM(fd.entity_data->>'companyIndustry'), '')
          ) IS NOT NULL
        ORDER BY val
        LIMIT 500
      ) sub
    ),
    'technologies', (
      SELECT COALESCE(jsonb_agg(val ORDER BY val), '[]'::jsonb)
      FROM (
        SELECT DISTINCT TRIM(tech::text, '"') as val
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
    )
  ) INTO result;
  
  RETURN result;
END;
$function$;