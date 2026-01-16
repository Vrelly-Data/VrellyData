-- Update search_free_data_builder to add department alias mappings
-- This allows database values like "Executive" to match dropdown option "C-Suite"

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type TEXT DEFAULT 'person',
  p_industries TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_gender TEXT[] DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_seniority_levels TEXT[] DEFAULT NULL,
  p_departments TEXT[] DEFAULT NULL,
  p_company_size_ranges TEXT[] DEFAULT NULL,
  p_company_revenue TEXT[] DEFAULT NULL,
  p_technologies TEXT[] DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_personal_email BOOLEAN DEFAULT NULL,
  p_has_business_email BOOLEAN DEFAULT NULL,
  p_has_facebook BOOLEAN DEFAULT NULL,
  p_has_twitter BOOLEAN DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL,
  p_person_interests TEXT[] DEFAULT NULL,
  p_person_skills TEXT[] DEFAULT NULL,
  p_income TEXT[] DEFAULT NULL,
  p_net_worth TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(entity_data JSONB, entity_external_id TEXT, total_count BIGINT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- INDUSTRIES: Check both industry and industries fields
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE coalesce(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
         OR coalesce(fd.entity_data->>'industries', '') ILIKE '%' || ind || '%'
    ))
    -- CITIES
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE coalesce(fd.entity_data->>'city', '') ILIKE '%' || city || '%'
    ))
    -- COUNTRIES
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE coalesce(fd.entity_data->>'country', '') ILIKE '%' || country || '%'
    ))
    -- DEPARTMENTS: ILIKE matching with aliases for database values that differ from dropdown options
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        coalesce(fd.entity_data->>'department', '') ILIKE '%' || dept || '%'
        -- Alias mappings
        OR (dept = 'Engineering' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Engineering & Technical%')
        OR (dept = 'IT' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Information Technology%')
        OR (dept = 'Customer Success' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Customer Service%')
        OR (dept = 'Marketing' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Media And Communications%')
        OR (dept = 'C-Suite' AND (
          coalesce(fd.entity_data->>'department', '') ILIKE '%Executive%'
          OR coalesce(fd.entity_data->>'title', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
          OR coalesce(fd.entity_data->>'jobTitle', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
        ))
    ))
    -- GENDER
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE coalesce(fd.entity_data->>'gender', '') ILIKE '%' || g || '%'
    ))
    -- JOB TITLES
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
         OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    -- SENIORITY: Use helper function for comprehensive matching
    AND (p_seniority_levels IS NULL OR 
      title_matches_seniority(
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
        p_seniority_levels,
        fd.entity_data->>'seniority'
      )
    )
    -- COMPANY SIZE
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE 
        CASE 
          WHEN size_range = '1-10' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) <= 10
          WHEN size_range = '11-50' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 11 AND 50
          WHEN size_range = '51-200' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 51 AND 200
          WHEN size_range = '201-500' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 201 AND 500
          WHEN size_range = '501-1000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 501 AND 1000
          WHEN size_range = '1001-5000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 1001 AND 5000
          WHEN size_range = '5001-10000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 5001 AND 10000
          WHEN size_range = '10001+' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) > 10000
          ELSE FALSE
        END
    ))
    -- COMPANY REVENUE
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE coalesce(fd.entity_data->>'revenue', '') ILIKE '%' || rev || '%'
         OR coalesce(fd.entity_data->>'estimatedRevenue', '') ILIKE '%' || rev || '%'
    ))
    -- TECHNOLOGIES
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE coalesce(fd.entity_data->>'technologies', '') ILIKE '%' || tech || '%'
    ))
    -- PROSPECT DATA FILTERS
    AND (p_has_linkedin IS NULL OR 
      (p_has_linkedin = TRUE AND (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '')) OR
      (p_has_linkedin = FALSE AND (fd.entity_data->>'linkedinUrl' IS NULL OR fd.entity_data->>'linkedinUrl' = ''))
    )
    AND (p_has_phone IS NULL OR 
      (p_has_phone = TRUE AND (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '')) OR
      (p_has_phone = FALSE AND (fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = ''))
    )
    AND (p_has_personal_email IS NULL OR 
      (p_has_personal_email = TRUE AND (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '')) OR
      (p_has_personal_email = FALSE AND (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = ''))
    )
    AND (p_has_business_email IS NULL OR 
      (p_has_business_email = TRUE AND (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '')) OR
      (p_has_business_email = FALSE AND (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = ''))
    )
    AND (p_has_facebook IS NULL OR 
      (p_has_facebook = TRUE AND (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '')) OR
      (p_has_facebook = FALSE AND (fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = ''))
    )
    AND (p_has_twitter IS NULL OR 
      (p_has_twitter = TRUE AND (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '')) OR
      (p_has_twitter = FALSE AND (fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = ''))
    )
    AND (p_has_company_phone IS NULL OR 
      (p_has_company_phone = TRUE AND (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '')) OR
      (p_has_company_phone = FALSE AND (fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = ''))
    )
    AND (p_has_company_linkedin IS NULL OR 
      (p_has_company_linkedin = TRUE AND (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != '')) OR
      (p_has_company_linkedin = FALSE AND (fd.entity_data->>'companyLinkedinUrl' IS NULL OR fd.entity_data->>'companyLinkedinUrl' = ''))
    )
    AND (p_has_company_facebook IS NULL OR 
      (p_has_company_facebook = TRUE AND (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '')) OR
      (p_has_company_facebook = FALSE AND (fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = ''))
    )
    AND (p_has_company_twitter IS NULL OR 
      (p_has_company_twitter = TRUE AND (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '')) OR
      (p_has_company_twitter = FALSE AND (fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = ''))
    )
    -- KEYWORDS
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data::text ILIKE '%' || kw || '%'
    ))
    -- PERSON INTERESTS
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE coalesce(fd.entity_data->>'interests', '') ILIKE '%' || interest || '%'
    ))
    -- PERSON SKILLS
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE coalesce(fd.entity_data->>'skills', '') ILIKE '%' || skill || '%'
    ))
    -- INCOME
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE coalesce(fd.entity_data->>'income', '') ILIKE '%' || inc || '%'
    ))
    -- NET WORTH
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE coalesce(fd.entity_data->>'netWorth', '') ILIKE '%' || nw || '%'
    ));

  -- Return results with total count
  RETURN QUERY
  SELECT fd.entity_data, fd.entity_external_id, v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    -- INDUSTRIES
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE coalesce(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
         OR coalesce(fd.entity_data->>'industries', '') ILIKE '%' || ind || '%'
    ))
    -- CITIES
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) city
      WHERE coalesce(fd.entity_data->>'city', '') ILIKE '%' || city || '%'
    ))
    -- COUNTRIES
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) country
      WHERE coalesce(fd.entity_data->>'country', '') ILIKE '%' || country || '%'
    ))
    -- DEPARTMENTS: ILIKE matching with aliases for database values that differ from dropdown options
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        coalesce(fd.entity_data->>'department', '') ILIKE '%' || dept || '%'
        -- Alias mappings
        OR (dept = 'Engineering' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Engineering & Technical%')
        OR (dept = 'IT' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Information Technology%')
        OR (dept = 'Customer Success' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Customer Service%')
        OR (dept = 'Marketing' AND coalesce(fd.entity_data->>'department', '') ILIKE '%Media And Communications%')
        OR (dept = 'C-Suite' AND (
          coalesce(fd.entity_data->>'department', '') ILIKE '%Executive%'
          OR coalesce(fd.entity_data->>'title', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
          OR coalesce(fd.entity_data->>'jobTitle', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
        ))
    ))
    -- GENDER
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE coalesce(fd.entity_data->>'gender', '') ILIKE '%' || g || '%'
    ))
    -- JOB TITLES
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
         OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    -- SENIORITY
    AND (p_seniority_levels IS NULL OR 
      title_matches_seniority(
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
        p_seniority_levels,
        fd.entity_data->>'seniority'
      )
    )
    -- COMPANY SIZE
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE 
        CASE 
          WHEN size_range = '1-10' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) <= 10
          WHEN size_range = '11-50' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 11 AND 50
          WHEN size_range = '51-200' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 51 AND 200
          WHEN size_range = '201-500' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 201 AND 500
          WHEN size_range = '501-1000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 501 AND 1000
          WHEN size_range = '1001-5000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 1001 AND 5000
          WHEN size_range = '5001-10000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) BETWEEN 5001 AND 10000
          WHEN size_range = '10001+' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'companySize', '0')) > 10000
          ELSE FALSE
        END
    ))
    -- COMPANY REVENUE
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE coalesce(fd.entity_data->>'revenue', '') ILIKE '%' || rev || '%'
         OR coalesce(fd.entity_data->>'estimatedRevenue', '') ILIKE '%' || rev || '%'
    ))
    -- TECHNOLOGIES
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE coalesce(fd.entity_data->>'technologies', '') ILIKE '%' || tech || '%'
    ))
    -- PROSPECT DATA FILTERS
    AND (p_has_linkedin IS NULL OR 
      (p_has_linkedin = TRUE AND (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '')) OR
      (p_has_linkedin = FALSE AND (fd.entity_data->>'linkedinUrl' IS NULL OR fd.entity_data->>'linkedinUrl' = ''))
    )
    AND (p_has_phone IS NULL OR 
      (p_has_phone = TRUE AND (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '')) OR
      (p_has_phone = FALSE AND (fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = ''))
    )
    AND (p_has_personal_email IS NULL OR 
      (p_has_personal_email = TRUE AND (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '')) OR
      (p_has_personal_email = FALSE AND (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = ''))
    )
    AND (p_has_business_email IS NULL OR 
      (p_has_business_email = TRUE AND (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '')) OR
      (p_has_business_email = FALSE AND (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = ''))
    )
    AND (p_has_facebook IS NULL OR 
      (p_has_facebook = TRUE AND (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '')) OR
      (p_has_facebook = FALSE AND (fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = ''))
    )
    AND (p_has_twitter IS NULL OR 
      (p_has_twitter = TRUE AND (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '')) OR
      (p_has_twitter = FALSE AND (fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = ''))
    )
    AND (p_has_company_phone IS NULL OR 
      (p_has_company_phone = TRUE AND (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '')) OR
      (p_has_company_phone = FALSE AND (fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = ''))
    )
    AND (p_has_company_linkedin IS NULL OR 
      (p_has_company_linkedin = TRUE AND (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != '')) OR
      (p_has_company_linkedin = FALSE AND (fd.entity_data->>'companyLinkedinUrl' IS NULL OR fd.entity_data->>'companyLinkedinUrl' = ''))
    )
    AND (p_has_company_facebook IS NULL OR 
      (p_has_company_facebook = TRUE AND (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '')) OR
      (p_has_company_facebook = FALSE AND (fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = ''))
    )
    AND (p_has_company_twitter IS NULL OR 
      (p_has_company_twitter = TRUE AND (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '')) OR
      (p_has_company_twitter = FALSE AND (fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = ''))
    )
    -- KEYWORDS
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE fd.entity_data::text ILIKE '%' || kw || '%'
    ))
    -- PERSON INTERESTS
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE coalesce(fd.entity_data->>'interests', '') ILIKE '%' || interest || '%'
    ))
    -- PERSON SKILLS
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE coalesce(fd.entity_data->>'skills', '') ILIKE '%' || skill || '%'
    ))
    -- INCOME
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE coalesce(fd.entity_data->>'income', '') ILIKE '%' || inc || '%'
    ))
    -- NET WORTH
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE coalesce(fd.entity_data->>'netWorth', '') ILIKE '%' || nw || '%'
    ))
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;