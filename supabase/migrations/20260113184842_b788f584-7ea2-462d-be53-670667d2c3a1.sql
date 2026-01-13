-- Drop the existing function
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text, text[], text[], text[], text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, text, text, integer, integer);

-- Recreate with corrected field names for prospect data filters
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_states text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_size_min text DEFAULT NULL,
  p_company_size_max text DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_revenue_min integer DEFAULT NULL,
  p_revenue_max integer DEFAULT NULL,
  p_keywords text DEFAULT NULL,
  p_sort_by text DEFAULT 'name',
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer;
  v_total_count integer;
  v_results jsonb;
  v_size_ranges text[];
  v_keywords text[];
BEGIN
  v_offset := (p_page - 1) * p_per_page;
  
  -- Parse company size range
  IF p_company_size_min IS NOT NULL OR p_company_size_max IS NOT NULL THEN
    v_size_ranges := ARRAY['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'];
  END IF;
  
  -- Parse keywords
  IF p_keywords IS NOT NULL AND p_keywords != '' THEN
    v_keywords := string_to_array(lower(trim(p_keywords)), ' ');
  END IF;
  
  -- Count total matching records
  SELECT COUNT(*) INTO v_total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' = ANY(p_industries))
    -- Location filters
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' = ANY(p_cities))
    AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
         fd.entity_data->>'state' = ANY(p_states))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' = ANY(p_countries))
    -- Gender filter (person only)
    AND (p_gender IS NULL OR p_gender = '' OR 
         (p_entity_type = 'person' AND fd.entity_data->>'gender' = p_gender))
    -- Job titles filter (check both jobTitle and title fields)
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         fd.entity_data->>'jobTitle' = ANY(p_job_titles) OR
         fd.entity_data->>'title' = ANY(p_job_titles))
    -- Seniority filter (pattern match on jobTitle)
    AND (p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_seniority) AS s
           WHERE fd.entity_data->>'jobTitle' ILIKE '%' || s || '%'
              OR fd.entity_data->>'title' ILIKE '%' || s || '%'
         ))
    -- Departments filter (pattern match on jobTitle)
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_departments) AS d
           WHERE fd.entity_data->>'jobTitle' ILIKE '%' || d || '%'
              OR fd.entity_data->>'title' ILIKE '%' || d || '%'
         ))
    -- Prospect data filters - CORRECTED FIELD NAMES
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
    -- Keywords filter (search across multiple fields including keywords array)
    AND (v_keywords IS NULL OR array_length(v_keywords, 1) IS NULL OR
         EXISTS (
           SELECT 1 FROM unnest(v_keywords) AS kw
           WHERE lower(fd.entity_data->>'name') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'firstName') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'lastName') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'jobTitle') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'title') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'company') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'industry') ILIKE '%' || kw || '%'
              OR lower(fd.entity_data->>'technologies') ILIKE '%' || kw || '%'
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(fd.entity_data->'keywords') = 'array'
                  THEN fd.entity_data->'keywords' ELSE '[]'::jsonb END
                ) AS k WHERE lower(k) ILIKE '%' || kw || '%'
              )
         ));
  
  -- Get paginated results
  SELECT jsonb_agg(row_to_json(t))
  INTO v_results
  FROM (
    SELECT 
      fd.entity_external_id,
      fd.entity_data
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type::entity_type
      -- Industries filter
      AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
           fd.entity_data->>'industry' = ANY(p_industries))
      -- Location filters
      AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
           fd.entity_data->>'city' = ANY(p_cities))
      AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
           fd.entity_data->>'state' = ANY(p_states))
      AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
           fd.entity_data->>'country' = ANY(p_countries))
      -- Gender filter (person only)
      AND (p_gender IS NULL OR p_gender = '' OR 
           (p_entity_type = 'person' AND fd.entity_data->>'gender' = p_gender))
      -- Job titles filter
      AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
           fd.entity_data->>'jobTitle' = ANY(p_job_titles) OR
           fd.entity_data->>'title' = ANY(p_job_titles))
      -- Seniority filter
      AND (p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL OR 
           EXISTS (
             SELECT 1 FROM unnest(p_seniority) AS s
             WHERE fd.entity_data->>'jobTitle' ILIKE '%' || s || '%'
                OR fd.entity_data->>'title' ILIKE '%' || s || '%'
           ))
      -- Departments filter
      AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR 
           EXISTS (
             SELECT 1 FROM unnest(p_departments) AS d
             WHERE fd.entity_data->>'jobTitle' ILIKE '%' || d || '%'
                OR fd.entity_data->>'title' ILIKE '%' || d || '%'
           ))
      -- Prospect data filters - CORRECTED FIELD NAMES
      AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
      AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
      AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
      AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
      AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
      AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
      AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
      AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))
      AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
      AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
      -- Keywords filter
      AND (v_keywords IS NULL OR array_length(v_keywords, 1) IS NULL OR
           EXISTS (
             SELECT 1 FROM unnest(v_keywords) AS kw
             WHERE lower(fd.entity_data->>'name') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'firstName') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'lastName') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'jobTitle') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'title') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'company') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'industry') ILIKE '%' || kw || '%'
                OR lower(fd.entity_data->>'technologies') ILIKE '%' || kw || '%'
                OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(fd.entity_data->'keywords') = 'array'
                    THEN fd.entity_data->'keywords' ELSE '[]'::jsonb END
                  ) AS k WHERE lower(k) ILIKE '%' || kw || '%'
                )
           ))
    ORDER BY 
      CASE WHEN p_sort_by = 'name' THEN fd.entity_data->>'name' END ASC,
      CASE WHEN p_sort_by = 'company' THEN fd.entity_data->>'company' END ASC,
      CASE WHEN p_sort_by = 'industry' THEN fd.entity_data->>'industry' END ASC
    LIMIT p_per_page
    OFFSET v_offset
  ) t;
  
  RETURN jsonb_build_object(
    'items', COALESCE(v_results, '[]'::jsonb),
    'total_estimate', v_total_count,
    'page', p_page,
    'per_page', p_per_page,
    'has_more', (v_offset + p_per_page) < v_total_count
  );
END;
$$;