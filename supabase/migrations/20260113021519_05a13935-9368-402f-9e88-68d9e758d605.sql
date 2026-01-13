-- Drop both existing overloads of the function
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  entity_type, text[], text[], text[], text[], text[], text[], text,
  text[], text[], text[], text[], text[], text[], boolean, boolean,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  text[], text[], text[], text[], integer, integer
);

DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  text, text[], text[], text[], text, text[], text[], text[], text[],
  text[], text[], boolean, boolean, boolean, boolean, boolean, boolean,
  text[], text[], text[], text[], text[], text[], text[], boolean,
  boolean, boolean, boolean, integer, integer
);

-- Create the unified function with improved keyword search
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters_v2(
  p_entity_type entity_type,
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_company_size text DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_locations text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_states text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_website boolean DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_names text[] DEFAULT NULL,
  p_company_types text[] DEFAULT NULL,
  p_founding_years text[] DEFAULT NULL,
  p_revenue_ranges text[] DEFAULT NULL,
  p_employee_ranges text[] DEFAULT NULL,
  p_tech_stacks text[] DEFAULT NULL,
  p_has_revenue boolean DEFAULT NULL,
  p_has_employees boolean DEFAULT NULL,
  p_has_funding boolean DEFAULT NULL,
  p_has_description boolean DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb;
  v_total_estimate bigint;
  v_company_size_min integer;
  v_company_size_max integer;
BEGIN
  -- Parse company size range if provided
  IF p_company_size IS NOT NULL AND p_company_size != '' THEN
    v_company_size_min := CASE 
      WHEN p_company_size = '1-10' THEN 1
      WHEN p_company_size = '11-50' THEN 11
      WHEN p_company_size = '51-200' THEN 51
      WHEN p_company_size = '201-500' THEN 201
      WHEN p_company_size = '501-1000' THEN 501
      WHEN p_company_size = '1001-5000' THEN 1001
      WHEN p_company_size = '5001-10000' THEN 5001
      WHEN p_company_size = '10001+' THEN 10001
      ELSE NULL
    END;
    v_company_size_max := CASE 
      WHEN p_company_size = '1-10' THEN 10
      WHEN p_company_size = '11-50' THEN 50
      WHEN p_company_size = '51-200' THEN 200
      WHEN p_company_size = '201-500' THEN 500
      WHEN p_company_size = '501-1000' THEN 1000
      WHEN p_company_size = '1001-5000' THEN 5000
      WHEN p_company_size = '5001-10000' THEN 10000
      WHEN p_company_size = '10001+' THEN 999999999
      ELSE NULL
    END;
  END IF;

  -- Get total estimate
  SELECT COUNT(*) INTO v_total_estimate
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords search (search in name, title, company, description, AND keywords array)
    AND (p_keywords IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'firstName', '') || ' ' || COALESCE(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'company', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'title', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
        OR COALESCE(fd.entity_data->>'industry', '') ILIKE '%' || kw || '%'
        -- Search in the keywords array (convert to text for ILIKE)
        OR COALESCE(fd.entity_data->>'keywords', '') ILIKE '%' || kw || '%'
      ) FROM unnest(p_keywords) kw
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
        OR COALESCE(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
      ) FROM unnest(p_job_titles) jt
    ))
    -- Seniority levels filter
    AND (p_seniority_levels IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'seniorityLevel', '') ILIKE '%' || sl || '%'
        OR COALESCE(fd.entity_data->>'seniority', '') ILIKE '%' || sl || '%'
      ) FROM unnest(p_seniority_levels) sl
    ))
    -- Company size filter (numeric range matching)
    AND (p_company_size IS NULL OR p_company_size = '' OR v_company_size_min IS NULL OR (
      CASE 
        WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
          (fd.entity_data->>'companySize')::integer >= v_company_size_min 
          AND (fd.entity_data->>'companySize')::integer <= v_company_size_max
        WHEN fd.entity_data->>'companySize' ~ '^\d+-\d+$' THEN
          SPLIT_PART(fd.entity_data->>'companySize', '-', 1)::integer >= v_company_size_min
          AND SPLIT_PART(fd.entity_data->>'companySize', '-', 2)::integer <= v_company_size_max
        WHEN fd.entity_data->>'companySize' ~ '^\d+\+$' THEN
          REGEXP_REPLACE(fd.entity_data->>'companySize', '\+$', '')::integer >= v_company_size_min
        ELSE
          fd.entity_data->>'companySize' = p_company_size
      END
    ))
    -- Industries filter
    AND (p_industries IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
      ) FROM unnest(p_industries) ind
    ))
    -- Locations filter
    AND (p_locations IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'location', '') ILIKE '%' || loc || '%'
        OR COALESCE(fd.entity_data->>'city', '') ILIKE '%' || loc || '%'
        OR COALESCE(fd.entity_data->>'state', '') ILIKE '%' || loc || '%'
        OR COALESCE(fd.entity_data->>'country', '') ILIKE '%' || loc || '%'
      ) FROM unnest(p_locations) loc
    ))
    -- Countries filter
    AND (p_countries IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'country', '') ILIKE '%' || cnt || '%'
      ) FROM unnest(p_countries) cnt
    ))
    -- States filter
    AND (p_states IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'state', '') ILIKE '%' || st || '%'
      ) FROM unnest(p_states) st
    ))
    -- Cities filter
    AND (p_cities IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'city', '') ILIKE '%' || ct || '%'
      ) FROM unnest(p_cities) ct
    ))
    -- Gender filter
    AND (p_gender IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'gender', '') ILIKE '%' || g || '%'
      ) FROM unnest(p_gender) g
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'netWorth', '') ILIKE '%' || nw || '%'
      ) FROM unnest(p_net_worth) nw
    ))
    -- Income filter
    AND (p_income IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'income', '') ILIKE '%' || inc || '%'
      ) FROM unnest(p_income) inc
    ))
    -- Has email filter
    AND (p_has_email IS NULL OR (
      p_has_email = (COALESCE(fd.entity_data->>'email', '') != '' AND fd.entity_data->>'email' IS NOT NULL)
    ))
    -- Has phone filter
    AND (p_has_phone IS NULL OR (
      p_has_phone = (COALESCE(fd.entity_data->>'phone', '') != '' AND fd.entity_data->>'phone' IS NOT NULL)
    ))
    -- Has LinkedIn filter
    AND (p_has_linkedin IS NULL OR (
      p_has_linkedin = (COALESCE(fd.entity_data->>'linkedin', '') != '' AND fd.entity_data->>'linkedin' IS NOT NULL)
    ))
    -- Has Twitter filter
    AND (p_has_twitter IS NULL OR (
      p_has_twitter = (COALESCE(fd.entity_data->>'twitter', '') != '' AND fd.entity_data->>'twitter' IS NOT NULL)
    ))
    -- Has Facebook filter
    AND (p_has_facebook IS NULL OR (
      p_has_facebook = (COALESCE(fd.entity_data->>'facebook', '') != '' AND fd.entity_data->>'facebook' IS NOT NULL)
    ))
    -- Has website filter
    AND (p_has_website IS NULL OR (
      p_has_website = (COALESCE(fd.entity_data->>'website', '') != '' AND fd.entity_data->>'website' IS NOT NULL)
    ))
    -- Departments filter
    AND (p_departments IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'department', '') ILIKE '%' || dept || '%'
      ) FROM unnest(p_departments) dept
    ))
    -- Company names filter
    AND (p_company_names IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'companyName', '') ILIKE '%' || cn || '%'
        OR COALESCE(fd.entity_data->>'company', '') ILIKE '%' || cn || '%'
        OR COALESCE(fd.entity_data->>'name', '') ILIKE '%' || cn || '%'
      ) FROM unnest(p_company_names) cn
    ))
    -- Company types filter
    AND (p_company_types IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'companyType', '') ILIKE '%' || ct || '%'
        OR COALESCE(fd.entity_data->>'type', '') ILIKE '%' || ct || '%'
      ) FROM unnest(p_company_types) ct
    ))
    -- Founding years filter
    AND (p_founding_years IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'foundingYear', '') = fy
        OR COALESCE(fd.entity_data->>'founded', '') = fy
      ) FROM unnest(p_founding_years) fy
    ))
    -- Revenue ranges filter
    AND (p_revenue_ranges IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'revenue', '') ILIKE '%' || rr || '%'
        OR COALESCE(fd.entity_data->>'revenueRange', '') ILIKE '%' || rr || '%'
      ) FROM unnest(p_revenue_ranges) rr
    ))
    -- Employee ranges filter
    AND (p_employee_ranges IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'employees', '') ILIKE '%' || er || '%'
        OR COALESCE(fd.entity_data->>'employeeRange', '') ILIKE '%' || er || '%'
        OR COALESCE(fd.entity_data->>'companySize', '') ILIKE '%' || er || '%'
      ) FROM unnest(p_employee_ranges) er
    ))
    -- Tech stacks filter
    AND (p_tech_stacks IS NULL OR (
      SELECT bool_or(
        COALESCE(fd.entity_data->>'techStack', '') ILIKE '%' || ts || '%'
        OR COALESCE(fd.entity_data->>'technologies', '') ILIKE '%' || ts || '%'
      ) FROM unnest(p_tech_stacks) ts
    ))
    -- Has revenue filter
    AND (p_has_revenue IS NULL OR (
      p_has_revenue = (COALESCE(fd.entity_data->>'revenue', '') != '' AND fd.entity_data->>'revenue' IS NOT NULL)
    ))
    -- Has employees filter
    AND (p_has_employees IS NULL OR (
      p_has_employees = (
        (COALESCE(fd.entity_data->>'employees', '') != '' AND fd.entity_data->>'employees' IS NOT NULL)
        OR (COALESCE(fd.entity_data->>'companySize', '') != '' AND fd.entity_data->>'companySize' IS NOT NULL)
      )
    ))
    -- Has funding filter
    AND (p_has_funding IS NULL OR (
      p_has_funding = (COALESCE(fd.entity_data->>'funding', '') != '' AND fd.entity_data->>'funding' IS NOT NULL)
    ))
    -- Has description filter
    AND (p_has_description IS NULL OR (
      p_has_description = (COALESCE(fd.entity_data->>'description', '') != '' AND fd.entity_data->>'description' IS NOT NULL)
    ));

  -- Get paginated results
  SELECT jsonb_agg(row_to_json(r))
  INTO v_results
  FROM (
    SELECT 
      fd.id,
      fd.entity_type,
      fd.external_id,
      fd.entity_data,
      fd.created_at
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type
      -- Keywords search (search in name, title, company, description, AND keywords array)
      AND (p_keywords IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'firstName', '') || ' ' || COALESCE(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'company', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'title', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
          OR COALESCE(fd.entity_data->>'industry', '') ILIKE '%' || kw || '%'
          -- Search in the keywords array (convert to text for ILIKE)
          OR COALESCE(fd.entity_data->>'keywords', '') ILIKE '%' || kw || '%'
        ) FROM unnest(p_keywords) kw
      ))
      -- Job titles filter
      AND (p_job_titles IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
          OR COALESCE(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
        ) FROM unnest(p_job_titles) jt
      ))
      -- Seniority levels filter
      AND (p_seniority_levels IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'seniorityLevel', '') ILIKE '%' || sl || '%'
          OR COALESCE(fd.entity_data->>'seniority', '') ILIKE '%' || sl || '%'
        ) FROM unnest(p_seniority_levels) sl
      ))
      -- Company size filter (numeric range matching)
      AND (p_company_size IS NULL OR p_company_size = '' OR v_company_size_min IS NULL OR (
        CASE 
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            (fd.entity_data->>'companySize')::integer >= v_company_size_min 
            AND (fd.entity_data->>'companySize')::integer <= v_company_size_max
          WHEN fd.entity_data->>'companySize' ~ '^\d+-\d+$' THEN
            SPLIT_PART(fd.entity_data->>'companySize', '-', 1)::integer >= v_company_size_min
            AND SPLIT_PART(fd.entity_data->>'companySize', '-', 2)::integer <= v_company_size_max
          WHEN fd.entity_data->>'companySize' ~ '^\d+\+$' THEN
            REGEXP_REPLACE(fd.entity_data->>'companySize', '\+$', '')::integer >= v_company_size_min
          ELSE
            fd.entity_data->>'companySize' = p_company_size
        END
      ))
      -- Industries filter
      AND (p_industries IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
        ) FROM unnest(p_industries) ind
      ))
      -- Locations filter
      AND (p_locations IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'location', '') ILIKE '%' || loc || '%'
          OR COALESCE(fd.entity_data->>'city', '') ILIKE '%' || loc || '%'
          OR COALESCE(fd.entity_data->>'state', '') ILIKE '%' || loc || '%'
          OR COALESCE(fd.entity_data->>'country', '') ILIKE '%' || loc || '%'
        ) FROM unnest(p_locations) loc
      ))
      -- Countries filter
      AND (p_countries IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'country', '') ILIKE '%' || cnt || '%'
        ) FROM unnest(p_countries) cnt
      ))
      -- States filter
      AND (p_states IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'state', '') ILIKE '%' || st || '%'
        ) FROM unnest(p_states) st
      ))
      -- Cities filter
      AND (p_cities IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'city', '') ILIKE '%' || ct || '%'
        ) FROM unnest(p_cities) ct
      ))
      -- Gender filter
      AND (p_gender IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'gender', '') ILIKE '%' || g || '%'
        ) FROM unnest(p_gender) g
      ))
      -- Net worth filter
      AND (p_net_worth IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'netWorth', '') ILIKE '%' || nw || '%'
        ) FROM unnest(p_net_worth) nw
      ))
      -- Income filter
      AND (p_income IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'income', '') ILIKE '%' || inc || '%'
        ) FROM unnest(p_income) inc
      ))
      -- Has email filter
      AND (p_has_email IS NULL OR (
        p_has_email = (COALESCE(fd.entity_data->>'email', '') != '' AND fd.entity_data->>'email' IS NOT NULL)
      ))
      -- Has phone filter
      AND (p_has_phone IS NULL OR (
        p_has_phone = (COALESCE(fd.entity_data->>'phone', '') != '' AND fd.entity_data->>'phone' IS NOT NULL)
      ))
      -- Has LinkedIn filter
      AND (p_has_linkedin IS NULL OR (
        p_has_linkedin = (COALESCE(fd.entity_data->>'linkedin', '') != '' AND fd.entity_data->>'linkedin' IS NOT NULL)
      ))
      -- Has Twitter filter
      AND (p_has_twitter IS NULL OR (
        p_has_twitter = (COALESCE(fd.entity_data->>'twitter', '') != '' AND fd.entity_data->>'twitter' IS NOT NULL)
      ))
      -- Has Facebook filter
      AND (p_has_facebook IS NULL OR (
        p_has_facebook = (COALESCE(fd.entity_data->>'facebook', '') != '' AND fd.entity_data->>'facebook' IS NOT NULL)
      ))
      -- Has website filter
      AND (p_has_website IS NULL OR (
        p_has_website = (COALESCE(fd.entity_data->>'website', '') != '' AND fd.entity_data->>'website' IS NOT NULL)
      ))
      -- Departments filter
      AND (p_departments IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'department', '') ILIKE '%' || dept || '%'
        ) FROM unnest(p_departments) dept
      ))
      -- Company names filter
      AND (p_company_names IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'companyName', '') ILIKE '%' || cn || '%'
          OR COALESCE(fd.entity_data->>'company', '') ILIKE '%' || cn || '%'
          OR COALESCE(fd.entity_data->>'name', '') ILIKE '%' || cn || '%'
        ) FROM unnest(p_company_names) cn
      ))
      -- Company types filter
      AND (p_company_types IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'companyType', '') ILIKE '%' || ct || '%'
          OR COALESCE(fd.entity_data->>'type', '') ILIKE '%' || ct || '%'
        ) FROM unnest(p_company_types) ct
      ))
      -- Founding years filter
      AND (p_founding_years IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'foundingYear', '') = fy
          OR COALESCE(fd.entity_data->>'founded', '') = fy
        ) FROM unnest(p_founding_years) fy
      ))
      -- Revenue ranges filter
      AND (p_revenue_ranges IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'revenue', '') ILIKE '%' || rr || '%'
          OR COALESCE(fd.entity_data->>'revenueRange', '') ILIKE '%' || rr || '%'
        ) FROM unnest(p_revenue_ranges) rr
      ))
      -- Employee ranges filter
      AND (p_employee_ranges IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'employees', '') ILIKE '%' || er || '%'
          OR COALESCE(fd.entity_data->>'employeeRange', '') ILIKE '%' || er || '%'
          OR COALESCE(fd.entity_data->>'companySize', '') ILIKE '%' || er || '%'
        ) FROM unnest(p_employee_ranges) er
      ))
      -- Tech stacks filter
      AND (p_tech_stacks IS NULL OR (
        SELECT bool_or(
          COALESCE(fd.entity_data->>'techStack', '') ILIKE '%' || ts || '%'
          OR COALESCE(fd.entity_data->>'technologies', '') ILIKE '%' || ts || '%'
        ) FROM unnest(p_tech_stacks) ts
      ))
      -- Has revenue filter
      AND (p_has_revenue IS NULL OR (
        p_has_revenue = (COALESCE(fd.entity_data->>'revenue', '') != '' AND fd.entity_data->>'revenue' IS NOT NULL)
      ))
      -- Has employees filter
      AND (p_has_employees IS NULL OR (
        p_has_employees = (
          (COALESCE(fd.entity_data->>'employees', '') != '' AND fd.entity_data->>'employees' IS NOT NULL)
          OR (COALESCE(fd.entity_data->>'companySize', '') != '' AND fd.entity_data->>'companySize' IS NOT NULL)
        )
      ))
      -- Has funding filter
      AND (p_has_funding IS NULL OR (
        p_has_funding = (COALESCE(fd.entity_data->>'funding', '') != '' AND fd.entity_data->>'funding' IS NOT NULL)
      ))
      -- Has description filter
      AND (p_has_description IS NULL OR (
        p_has_description = (COALESCE(fd.entity_data->>'description', '') != '' AND fd.entity_data->>'description' IS NOT NULL)
      ))
    ORDER BY fd.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'items', COALESCE(v_results, '[]'::jsonb),
    'total_estimate', v_total_estimate,
    'page', (p_offset / p_limit) + 1,
    'per_page', p_limit,
    'has_more', (p_offset + p_limit) < v_total_estimate
  );
END;
$$;