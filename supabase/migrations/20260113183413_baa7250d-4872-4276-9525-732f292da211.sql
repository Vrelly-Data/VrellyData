-- Drop and recreate search_free_data_builder with fixes for:
-- 1. Entity type cast (p_entity_type::entity_type)
-- 2. Correct camelCase field names for keyword search
-- 3. Search keywords array and technologies field

DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT NULL,
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_company_sizes text[] DEFAULT NULL,
  p_revenue_ranges text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_states text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
  p_funding_stages text[] DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_company boolean DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count integer;
  v_results jsonb;
  v_seniority_patterns text[];
  v_department_patterns text[];
BEGIN
  -- Build seniority patterns for flexible matching
  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) > 0 THEN
    v_seniority_patterns := ARRAY[]::text[];
    IF 'C-Level' = ANY(p_seniority_levels) THEN
      v_seniority_patterns := v_seniority_patterns || ARRAY['%chief%', '%ceo%', '%cfo%', '%cto%', '%coo%', '%cmo%', '%cio%', '%cpo%', '%cro%'];
    END IF;
    IF 'VP' = ANY(p_seniority_levels) THEN
      v_seniority_patterns := v_seniority_patterns || ARRAY['%vice president%', '%vp %', '% vp%', '%v.p.%'];
    END IF;
    IF 'Director' = ANY(p_seniority_levels) THEN
      v_seniority_patterns := v_seniority_patterns || ARRAY['%director%'];
    END IF;
    IF 'Manager' = ANY(p_seniority_levels) THEN
      v_seniority_patterns := v_seniority_patterns || ARRAY['%manager%', '%management%'];
    END IF;
    IF 'Senior' = ANY(p_seniority_levels) THEN
      v_seniority_patterns := v_seniority_patterns || ARRAY['%senior%', '%sr.%', '%sr %', '%lead %', '%principal%'];
    END IF;
    IF 'Entry' = ANY(p_seniority_levels) THEN
      v_seniority_patterns := v_seniority_patterns || ARRAY['%junior%', '%jr.%', '%jr %', '%entry%', '%associate%', '%assistant%', '%intern%', '%trainee%'];
    END IF;
  END IF;

  -- Build department patterns for flexible matching
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN
    v_department_patterns := ARRAY[]::text[];
    IF 'Engineering' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%engineer%', '%developer%', '%software%', '%programming%', '%devops%', '%sre%', '%technical%', '%architect%', '%development%'];
    END IF;
    IF 'Sales' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%sales%', '%account executive%', '%business development%', '%revenue%', '%commercial%'];
    END IF;
    IF 'Marketing' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%marketing%', '%brand%', '%content%', '%seo%', '%growth%', '%communications%', '%pr %', '%public relations%'];
    END IF;
    IF 'Product' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%product%'];
    END IF;
    IF 'Design' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%design%', '%ux%', '%ui%', '%creative%', '%graphic%'];
    END IF;
    IF 'Finance' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%finance%', '%accounting%', '%controller%', '%treasury%', '%tax%', '%audit%', '%financial%'];
    END IF;
    IF 'HR' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%human resources%', '% hr %', '%hr %', '% hr%', '%talent%', '%recruiting%', '%people ops%', '%people operations%', '%employee%'];
    END IF;
    IF 'Operations' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%operations%', '%ops%', '%logistics%', '%supply chain%', '%procurement%'];
    END IF;
    IF 'Legal' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%legal%', '%counsel%', '%attorney%', '%lawyer%', '%compliance%', '%regulatory%'];
    END IF;
    IF 'IT' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%information technology%', '% it %', '%it %', '% it%', '%systems%', '%infrastructure%', '%network%', '%security%', '%helpdesk%', '%support%'];
    END IF;
    IF 'Customer Success' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%customer success%', '%client success%', '%customer service%', '%support%', '%customer experience%'];
    END IF;
    IF 'Data' = ANY(p_departments) THEN
      v_department_patterns := v_department_patterns || ARRAY['%data%', '%analytics%', '%business intelligence%', '%bi %', '% bi%', '%scientist%', '%machine learning%', '%ml %', '%ai %'];
    END IF;
  END IF;

  -- Get total count
  SELECT COUNT(*) INTO v_total_count
  FROM free_data fd
  WHERE (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    -- Keywords filter (search in name, firstName, lastName, jobTitle, title, company, industry, technologies, keywords array)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(fd.entity_data->'keywords') = 'array' 
            THEN fd.entity_data->'keywords' ELSE '[]'::jsonb END
          ) AS k WHERE k ILIKE '%' || kw || '%'
        )
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
         OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority levels filter with pattern matching
    AND (v_seniority_patterns IS NULL OR array_length(v_seniority_patterns, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(v_seniority_patterns) pattern
      WHERE LOWER(fd.entity_data->>'jobTitle') LIKE pattern
         OR LOWER(fd.entity_data->>'title') LIKE pattern
    ))
    -- Departments filter with pattern matching
    AND (v_department_patterns IS NULL OR array_length(v_department_patterns, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(v_department_patterns) pattern
      WHERE LOWER(fd.entity_data->>'jobTitle') LIKE pattern
         OR LOWER(fd.entity_data->>'title') LIKE pattern
         OR LOWER(fd.entity_data->>'department') LIKE pattern
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Company sizes filter
    AND (p_company_sizes IS NULL OR array_length(p_company_sizes, 1) IS NULL OR 
      fd.entity_data->>'employeeCount' = ANY(p_company_sizes) OR
      fd.entity_data->>'companySize' = ANY(p_company_sizes)
    )
    -- Revenue ranges filter
    AND (p_revenue_ranges IS NULL OR array_length(p_revenue_ranges, 1) IS NULL OR 
      fd.entity_data->>'revenue' = ANY(p_revenue_ranges) OR
      fd.entity_data->>'companyRevenue' = ANY(p_revenue_ranges)
    )
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
      fd.entity_data->>'country' = ANY(p_countries) OR
      fd.entity_data->>'companyCountry' = ANY(p_countries)
    )
    -- States filter
    AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
      fd.entity_data->>'state' = ANY(p_states) OR
      fd.entity_data->>'companyState' = ANY(p_states)
    )
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
      fd.entity_data->>'city' = ANY(p_cities) OR
      fd.entity_data->>'companyCity' = ANY(p_cities)
    )
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    -- Funding stages filter
    AND (p_funding_stages IS NULL OR array_length(p_funding_stages, 1) IS NULL OR 
      fd.entity_data->>'fundingStage' = ANY(p_funding_stages)
    )
    -- Prospect data filters
    AND (p_has_email IS NULL OR p_has_email = FALSE OR (
      (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '') OR
      (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
      (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' != '')
    ))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
      (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != '') OR
      (fd.entity_data->>'directPhone' IS NOT NULL AND fd.entity_data->>'directPhone' != '')
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''
    ))
    AND (p_has_company IS NULL OR p_has_company = FALSE OR (
      fd.entity_data->>'company' IS NOT NULL AND fd.entity_data->>'company' != ''
    ));

  -- Get paginated results
  SELECT jsonb_agg(row_to_json(r))
  INTO v_results
  FROM (
    SELECT 
      fd.id,
      fd.entity_type,
      fd.entity_data,
      fd.source,
      fd.created_at
    FROM free_data fd
    WHERE (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
      -- Keywords filter (search in name, firstName, lastName, jobTitle, title, company, industry, technologies, keywords array)
      AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE 
          fd.entity_data->>'name' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(fd.entity_data->'keywords') = 'array' 
              THEN fd.entity_data->'keywords' ELSE '[]'::jsonb END
            ) AS k WHERE k ILIKE '%' || kw || '%'
          )
      ))
      -- Job titles filter
      AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) jt
        WHERE fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
           OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
      ))
      -- Seniority levels filter with pattern matching
      AND (v_seniority_patterns IS NULL OR array_length(v_seniority_patterns, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(v_seniority_patterns) pattern
        WHERE LOWER(fd.entity_data->>'jobTitle') LIKE pattern
           OR LOWER(fd.entity_data->>'title') LIKE pattern
      ))
      -- Departments filter with pattern matching
      AND (v_department_patterns IS NULL OR array_length(v_department_patterns, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(v_department_patterns) pattern
        WHERE LOWER(fd.entity_data->>'jobTitle') LIKE pattern
           OR LOWER(fd.entity_data->>'title') LIKE pattern
           OR LOWER(fd.entity_data->>'department') LIKE pattern
      ))
      -- Industries filter
      AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_industries) ind
        WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
      ))
      -- Company sizes filter
      AND (p_company_sizes IS NULL OR array_length(p_company_sizes, 1) IS NULL OR 
        fd.entity_data->>'employeeCount' = ANY(p_company_sizes) OR
        fd.entity_data->>'companySize' = ANY(p_company_sizes)
      )
      -- Revenue ranges filter
      AND (p_revenue_ranges IS NULL OR array_length(p_revenue_ranges, 1) IS NULL OR 
        fd.entity_data->>'revenue' = ANY(p_revenue_ranges) OR
        fd.entity_data->>'companyRevenue' = ANY(p_revenue_ranges)
      )
      -- Countries filter
      AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
        fd.entity_data->>'country' = ANY(p_countries) OR
        fd.entity_data->>'companyCountry' = ANY(p_countries)
      )
      -- States filter
      AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
        fd.entity_data->>'state' = ANY(p_states) OR
        fd.entity_data->>'companyState' = ANY(p_states)
      )
      -- Cities filter
      AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
        fd.entity_data->>'city' = ANY(p_cities) OR
        fd.entity_data->>'companyCity' = ANY(p_cities)
      )
      -- Technologies filter
      AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_technologies) tech
        WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
      ))
      -- Funding stages filter
      AND (p_funding_stages IS NULL OR array_length(p_funding_stages, 1) IS NULL OR 
        fd.entity_data->>'fundingStage' = ANY(p_funding_stages)
      )
      -- Prospect data filters
      AND (p_has_email IS NULL OR p_has_email = FALSE OR (
        (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '') OR
        (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
        (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' != '')
      ))
      AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
        (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
        (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != '') OR
        (fd.entity_data->>'directPhone' IS NOT NULL AND fd.entity_data->>'directPhone' != '')
      ))
      AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
        fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''
      ))
      AND (p_has_company IS NULL OR p_has_company = FALSE OR (
        fd.entity_data->>'company' IS NOT NULL AND fd.entity_data->>'company' != ''
      ))
    ORDER BY fd.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'total', v_total_count,
    'items', COALESCE(v_results, '[]'::jsonb),
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;