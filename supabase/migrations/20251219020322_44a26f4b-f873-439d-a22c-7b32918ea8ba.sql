-- Function to get distinct filter suggestions from free_data table
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
      SELECT jsonb_agg(DISTINCT val)
      FROM (
        SELECT TRIM(val) as val
        FROM free_data fd,
        LATERAL unnest(string_to_array(fd.entity_data->>'interests', ',')) AS val
        WHERE fd.entity_data->>'interests' IS NOT NULL
          AND TRIM(val) <> ''
        ORDER BY val
        LIMIT 200
      ) sub
    ),
    'skills', (
      SELECT jsonb_agg(DISTINCT val)
      FROM (
        SELECT TRIM(val) as val
        FROM free_data fd,
        LATERAL unnest(string_to_array(fd.entity_data->>'skills', ',')) AS val
        WHERE fd.entity_data->>'skills' IS NOT NULL
          AND TRIM(val) <> ''
        ORDER BY val
        LIMIT 200
      ) sub
    ),
    'industries', (
      SELECT jsonb_agg(DISTINCT val)
      FROM (
        SELECT COALESCE(NULLIF(TRIM(fd.entity_data->>'industry'), ''), NULLIF(TRIM(fd.entity_data->>'companyIndustry'), '')) as val
        FROM free_data fd
        WHERE COALESCE(fd.entity_data->>'industry', fd.entity_data->>'companyIndustry') IS NOT NULL
          AND COALESCE(NULLIF(TRIM(fd.entity_data->>'industry'), ''), NULLIF(TRIM(fd.entity_data->>'companyIndustry'), '')) IS NOT NULL
        ORDER BY val
        LIMIT 200
      ) sub
    )
  ) INTO result;
  
  RETURN result;
END;
$function$;