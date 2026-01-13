-- Drop and recreate the search function with correct column name and return type
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2;

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
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  entity_external_id text,
  entity_data jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_data AS (
    SELECT 
      fd.entity_external_id,
      fd.entity_data
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type
      -- Keywords filter: search across multiple text fields
      AND (p_keywords IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE 
          fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'name' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'keywords' ILIKE '%' || kw || '%'
      ))
      -- Job titles filter
      AND (p_job_titles IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) jt
        WHERE fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
           OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
      ))
      -- Seniority levels filter
      AND (p_seniority_levels IS NULL OR fd.entity_data->>'seniority' = ANY(p_seniority_levels)
           OR fd.entity_data->>'seniorityLevel' = ANY(p_seniority_levels))
      -- Company size filter
      AND (p_company_size IS NULL OR fd.entity_data->>'companySize' = p_company_size
           OR fd.entity_data->>'employeeCount' = p_company_size)
      -- Industries filter
      AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
      -- Countries filter
      AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries)
           OR fd.entity_data->>'companyCountry' = ANY(p_countries))
      -- Cities filter
      AND (p_cities IS NULL OR fd.entity_data->>'city' = ANY(p_cities)
           OR fd.entity_data->>'companyCity' = ANY(p_cities))
      -- Gender filter
      AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
      -- Net worth filter
      AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
      -- Income filter
      AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
      -- Departments filter
      AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
      -- Revenue ranges filter
      AND (p_revenue_ranges IS NULL OR fd.entity_data->>'revenue' = ANY(p_revenue_ranges)
           OR fd.entity_data->>'companyRevenue' = ANY(p_revenue_ranges))
      -- Has email filter
      AND (p_has_email IS NULL OR (p_has_email = true AND (
        fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''
        OR fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''
        OR fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''
      )))
      -- Has phone filter
      AND (p_has_phone IS NULL OR (p_has_phone = true AND (
        fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''
        OR fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != ''
      )))
      -- Has linkedin filter
      AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND 
        fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
      -- Has twitter filter
      AND (p_has_twitter IS NULL OR (p_has_twitter = true AND 
        fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != ''))
      -- Has facebook filter
      AND (p_has_facebook IS NULL OR (p_has_facebook = true AND 
        fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != ''))
  )
  SELECT 
    filtered_data.entity_external_id,
    filtered_data.entity_data,
    COUNT(*) OVER() AS total_count
  FROM filtered_data
  ORDER BY filtered_data.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;