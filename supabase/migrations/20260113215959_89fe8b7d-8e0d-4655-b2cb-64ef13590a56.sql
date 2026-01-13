CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT NULL,
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
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
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  entity_data jsonb,
  entity_external_id text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  -- First get total count with all filters applied
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE 
    -- Entity type filter
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- Keywords filter (search across multiple fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'fullName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'summary' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'headline' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'skills' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'interests' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'city' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'state' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'country' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'location' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'department' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'seniority' ILIKE '%' || kw || '%'
    ))
    
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority filter
    AND (p_seniority_levels IS NULL OR title_matches_seniority(p_seniority_levels, COALESCE(fd.entity_data->>'jobTitle', fd.entity_data->>'title', '')))
    
    -- Department filter
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE fd.entity_data->>'department' ILIKE '%' || dept || '%'
    ))
    
    -- Company size filter (supports multiple ranges)
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE (
        CASE 
          WHEN size_range = '1-10' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 1 AND 10
          WHEN size_range = '11-50' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 11 AND 50
          WHEN size_range = '51-200' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 51 AND 200
          WHEN size_range = '201-500' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 201 AND 500
          WHEN size_range = '501-1000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 501 AND 1000
          WHEN size_range = '1001-5000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 1001 AND 5000
          WHEN size_range = '5001-10000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 5001 AND 10000
          WHEN size_range = '10001+' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) > 10000
          ELSE FALSE
        END
      )
    ))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE fd.entity_data->>'companyRevenue' ILIKE '%' || rev || '%'
        OR fd.entity_data->>'revenue' ILIKE '%' || rev || '%'
    ))
    
    -- Industries filter
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE 
        fd.entity_data->>'industry' ILIKE '%' || ind || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
    ))
    
    -- Countries filter
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || country || '%'
        OR fd.entity_data->>'companyCountry' ILIKE '%' || country || '%'
        OR fd.entity_data->>'location' ILIKE '%' || country || '%'
    ))
    
    -- Cities filter
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || city || '%'
        OR fd.entity_data->>'companyCity' ILIKE '%' || city || '%'
        OR fd.entity_data->>'location' ILIKE '%' || city || '%'
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g || '%'
    ))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    
    -- Income filter
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))
    
    -- Technologies filter (JSON array containment)
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'technologies' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'technologies') = 'array'
             THEN fd.entity_data->'technologies' 
             ELSE '[]'::jsonb 
        END
      ) tech
      WHERE tech = ANY(p_technologies)
    ))
    
    -- Contact data availability filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (
      fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (
      (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '')
      OR (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' <> '')
      OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> '')
    ))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '')
      OR (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' <> '')
      OR (fd.entity_data->>'directPhone' IS NOT NULL AND fd.entity_data->>'directPhone' <> '')
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (
      fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> ''
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
      fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> ''
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
      fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (
      fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> ''
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
      fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> ''
    ));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    v_total as total_count
  FROM free_data fd
  WHERE 
    -- Entity type filter
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- Keywords filter (search across multiple fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'fullName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'summary' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'headline' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'skills' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'interests' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'city' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'state' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'country' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'location' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'department' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'seniority' ILIKE '%' || kw || '%'
    ))
    
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority filter
    AND (p_seniority_levels IS NULL OR title_matches_seniority(p_seniority_levels, COALESCE(fd.entity_data->>'jobTitle', fd.entity_data->>'title', '')))
    
    -- Department filter
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE fd.entity_data->>'department' ILIKE '%' || dept || '%'
    ))
    
    -- Company size filter (supports multiple ranges)
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE (
        CASE 
          WHEN size_range = '1-10' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 1 AND 10
          WHEN size_range = '11-50' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 11 AND 50
          WHEN size_range = '51-200' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 51 AND 200
          WHEN size_range = '201-500' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 201 AND 500
          WHEN size_range = '501-1000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 501 AND 1000
          WHEN size_range = '1001-5000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 1001 AND 5000
          WHEN size_range = '5001-10000' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) BETWEEN 5001 AND 10000
          WHEN size_range = '10001+' THEN parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', fd.entity_data->>'employeeCount', '0')) > 10000
          ELSE FALSE
        END
      )
    ))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE fd.entity_data->>'companyRevenue' ILIKE '%' || rev || '%'
        OR fd.entity_data->>'revenue' ILIKE '%' || rev || '%'
    ))
    
    -- Industries filter
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE 
        fd.entity_data->>'industry' ILIKE '%' || ind || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
    ))
    
    -- Countries filter
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || country || '%'
        OR fd.entity_data->>'companyCountry' ILIKE '%' || country || '%'
        OR fd.entity_data->>'location' ILIKE '%' || country || '%'
    ))
    
    -- Cities filter
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || city || '%'
        OR fd.entity_data->>'companyCity' ILIKE '%' || city || '%'
        OR fd.entity_data->>'location' ILIKE '%' || city || '%'
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g || '%'
    ))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    
    -- Income filter
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))
    
    -- Technologies filter (JSON array containment)
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN fd.entity_data->'technologies' IS NOT NULL 
              AND jsonb_typeof(fd.entity_data->'technologies') = 'array'
             THEN fd.entity_data->'technologies' 
             ELSE '[]'::jsonb 
        END
      ) tech
      WHERE tech = ANY(p_technologies)
    ))
    
    -- Contact data availability filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (
      fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''
    ))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (
      (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '')
      OR (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' <> '')
      OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> '')
    ))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
      (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '')
      OR (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' <> '')
      OR (fd.entity_data->>'directPhone' IS NOT NULL AND fd.entity_data->>'directPhone' <> '')
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
      fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (
      fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> ''
    ))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
      fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> ''
    ))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
      fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
      fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (
      fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> ''
    ))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
      fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> ''
    ))
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;