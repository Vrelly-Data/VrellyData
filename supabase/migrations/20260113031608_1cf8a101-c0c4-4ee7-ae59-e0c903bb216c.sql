-- Create a NEW canonical Builder search function with a unique name
-- This avoids all the overload confusion with previous versions

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
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
RETURNS TABLE (
  entity_external_id text,
  entity_data jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO total
  FROM free_data fd
  WHERE 
    -- Entity type filter
    fd.entity_type = p_entity_type::entity_type

    -- Keywords: search across multiple text fields (OR logic within keywords)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyDescription' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
    ))

    -- Job titles: partial match across multiple field names
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        fd.entity_data->>'title' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'personJobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'job_title' ILIKE '%' || jt || '%'
    ))

    -- Seniority: normalize common variants (C-Level = C suite = Executive)
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sen
      WHERE 
        -- Direct partial match on multiple field names
        fd.entity_data->>'seniority' ILIKE '%' || sen || '%'
        OR fd.entity_data->>'seniorityLevel' ILIKE '%' || sen || '%'
        OR fd.entity_data->>'personSeniority' ILIKE '%' || sen || '%'
        -- C-Level equivalence: match C suite, c-level, c level, executive
        OR (
          lower(sen) IN ('c-level', 'c level', 'c-suite', 'c suite', 'executive')
          AND (
            lower(coalesce(fd.entity_data->>'seniority', '')) IN ('c suite', 'c-suite', 'c level', 'c-level', 'executive', 'c - level')
            OR lower(coalesce(fd.entity_data->>'seniorityLevel', '')) IN ('c suite', 'c-suite', 'c level', 'c-level', 'executive', 'c - level')
            OR lower(coalesce(fd.entity_data->>'personSeniority', '')) IN ('c suite', 'c-suite', 'c level', 'c-level', 'executive', 'c - level')
          )
        )
        -- VP equivalence
        OR (
          lower(sen) IN ('vp', 'vice president', 'vp-level')
          AND (
            lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%vp%'
            OR lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%vice president%'
            OR lower(coalesce(fd.entity_data->>'seniorityLevel', '')) LIKE '%vp%'
          )
        )
        -- Director equivalence
        OR (
          lower(sen) IN ('director', 'director-level')
          AND (
            lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%director%'
            OR lower(coalesce(fd.entity_data->>'seniorityLevel', '')) LIKE '%director%'
          )
        )
    ))

    -- Company Size: RANGE-BASED matching against numeric values
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) sz
      WHERE (
        -- Try to parse the stored value as an integer
        CASE 
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            CASE sz
              WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'companySize')::int > 10000
              WHEN '5000+' THEN (fd.entity_data->>'companySize')::int > 5000
              ELSE false
            END
          -- Also check employeeCount field
          WHEN fd.entity_data->>'employeeCount' ~ '^\d+$' THEN
            CASE sz
              WHEN '1-10' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'employeeCount')::int > 10000
              WHEN '5000+' THEN (fd.entity_data->>'employeeCount')::int > 5000
              ELSE false
            END
          -- Also check employees field
          WHEN fd.entity_data->>'employees' ~ '^\d+$' THEN
            CASE sz
              WHEN '1-10' THEN (fd.entity_data->>'employees')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'employees')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'employees')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'employees')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'employees')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'employees')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'employees')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'employees')::int > 10000
              WHEN '5000+' THEN (fd.entity_data->>'employees')::int > 5000
              ELSE false
            END
          -- Fallback: exact string match for pre-formatted ranges
          ELSE 
            fd.entity_data->>'companySize' = sz
            OR fd.entity_data->>'companySizeRange' = sz
        END
      )
    ))

    -- Industries: partial match
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE 
        fd.entity_data->>'industry' ILIKE '%' || ind || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
    ))

    -- Countries: check multiple field names
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) c
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || c || '%'
        OR fd.entity_data->>'personCountry' ILIKE '%' || c || '%'
        OR fd.entity_data->>'companyCountry' ILIKE '%' || c || '%'
    ))

    -- Cities: check multiple field names
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ct
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || ct || '%'
        OR fd.entity_data->>'personCity' ILIKE '%' || ct || '%'
        OR fd.entity_data->>'companyCity' ILIKE '%' || ct || '%'
    ))

    -- Gender: M/F matching
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g
    ))

    -- Net worth ranges
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))

    -- Income ranges
    AND (p_income IS NULL OR fd.entity_data->>'incomeRange' = ANY(p_income) OR fd.entity_data->>'income' = ANY(p_income))

    -- Departments: partial match across multiple field names
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        fd.entity_data->>'department' ILIKE '%' || dept || '%'
        OR fd.entity_data->>'personDepartment' ILIKE '%' || dept || '%'
    ))

    -- Company revenue ranges
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE 
        fd.entity_data->>'companyRevenue' ILIKE '%' || rev || '%'
        OR fd.entity_data->>'revenue' ILIKE '%' || rev || '%'
    ))

    -- Person interests: partial match
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))

    -- Person skills: partial match
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))

    -- Has personal email
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      coalesce(fd.entity_data->>'personalEmail', '') <> ''
      OR coalesce(fd.entity_data->>'personal_email', '') <> ''
      OR jsonb_array_length(coalesce(fd.entity_data->'personalEmails', '[]'::jsonb)) > 0
    ))

    -- Has business email
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      coalesce(fd.entity_data->>'businessEmail', '') <> ''
      OR coalesce(fd.entity_data->>'business_email', '') <> ''
      OR coalesce(fd.entity_data->>'email', '') <> ''
    ))

    -- Has phone
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'directNumber', '') <> ''
      OR coalesce(fd.entity_data->>'direct_number', '') <> ''
    ))

    -- Has LinkedIn
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      coalesce(fd.entity_data->>'linkedin', '') <> ''
      OR coalesce(fd.entity_data->>'linkedinUrl', '') <> ''
      OR coalesce(fd.entity_data->>'linkedin_url', '') <> ''
    ))

    -- Has Facebook
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      coalesce(fd.entity_data->>'facebookUrl', '') <> ''
      OR coalesce(fd.entity_data->>'facebook_url', '') <> ''
    ))

    -- Has Twitter
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      coalesce(fd.entity_data->>'twitterUrl', '') <> ''
      OR coalesce(fd.entity_data->>'twitter_url', '') <> ''
    ))

    -- Has company phone
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      coalesce(fd.entity_data->>'companyPhone', '') <> ''
      OR coalesce(fd.entity_data->>'company_phone', '') <> ''
    ))

    -- Has company LinkedIn
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      coalesce(fd.entity_data->>'companyLinkedin', '') <> ''
      OR coalesce(fd.entity_data->>'company_linkedin', '') <> ''
    ))

    -- Has company Facebook
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      coalesce(fd.entity_data->>'companyFacebookUrl', '') <> ''
      OR coalesce(fd.entity_data->>'company_facebook', '') <> ''
    ))

    -- Has company Twitter
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      coalesce(fd.entity_data->>'companyTwitterUrl', '') <> ''
      OR coalesce(fd.entity_data->>'company_twitter', '') <> ''
    ));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    total
  FROM free_data fd
  WHERE 
    -- Entity type filter
    fd.entity_type = p_entity_type::entity_type

    -- Keywords: search across multiple text fields (OR logic within keywords)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'description' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyDescription' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'bio' ILIKE '%' || kw || '%'
    ))

    -- Job titles: partial match across multiple field names
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        fd.entity_data->>'title' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'personJobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'job_title' ILIKE '%' || jt || '%'
    ))

    -- Seniority: normalize common variants (C-Level = C suite = Executive)
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sen
      WHERE 
        -- Direct partial match on multiple field names
        fd.entity_data->>'seniority' ILIKE '%' || sen || '%'
        OR fd.entity_data->>'seniorityLevel' ILIKE '%' || sen || '%'
        OR fd.entity_data->>'personSeniority' ILIKE '%' || sen || '%'
        -- C-Level equivalence
        OR (
          lower(sen) IN ('c-level', 'c level', 'c-suite', 'c suite', 'executive')
          AND (
            lower(coalesce(fd.entity_data->>'seniority', '')) IN ('c suite', 'c-suite', 'c level', 'c-level', 'executive', 'c - level')
            OR lower(coalesce(fd.entity_data->>'seniorityLevel', '')) IN ('c suite', 'c-suite', 'c level', 'c-level', 'executive', 'c - level')
            OR lower(coalesce(fd.entity_data->>'personSeniority', '')) IN ('c suite', 'c-suite', 'c level', 'c-level', 'executive', 'c - level')
          )
        )
        -- VP equivalence
        OR (
          lower(sen) IN ('vp', 'vice president', 'vp-level')
          AND (
            lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%vp%'
            OR lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%vice president%'
            OR lower(coalesce(fd.entity_data->>'seniorityLevel', '')) LIKE '%vp%'
          )
        )
        -- Director equivalence
        OR (
          lower(sen) IN ('director', 'director-level')
          AND (
            lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%director%'
            OR lower(coalesce(fd.entity_data->>'seniorityLevel', '')) LIKE '%director%'
          )
        )
    ))

    -- Company Size: RANGE-BASED matching against numeric values
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) sz
      WHERE (
        CASE 
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            CASE sz
              WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'companySize')::int > 10000
              WHEN '5000+' THEN (fd.entity_data->>'companySize')::int > 5000
              ELSE false
            END
          WHEN fd.entity_data->>'employeeCount' ~ '^\d+$' THEN
            CASE sz
              WHEN '1-10' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'employeeCount')::int > 10000
              WHEN '5000+' THEN (fd.entity_data->>'employeeCount')::int > 5000
              ELSE false
            END
          WHEN fd.entity_data->>'employees' ~ '^\d+$' THEN
            CASE sz
              WHEN '1-10' THEN (fd.entity_data->>'employees')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'employees')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'employees')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'employees')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'employees')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'employees')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'employees')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'employees')::int > 10000
              WHEN '5000+' THEN (fd.entity_data->>'employees')::int > 5000
              ELSE false
            END
          ELSE 
            fd.entity_data->>'companySize' = sz
            OR fd.entity_data->>'companySizeRange' = sz
        END
      )
    ))

    -- Industries: partial match
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE 
        fd.entity_data->>'industry' ILIKE '%' || ind || '%'
        OR fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
    ))

    -- Countries
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) c
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || c || '%'
        OR fd.entity_data->>'personCountry' ILIKE '%' || c || '%'
        OR fd.entity_data->>'companyCountry' ILIKE '%' || c || '%'
    ))

    -- Cities
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) ct
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || ct || '%'
        OR fd.entity_data->>'personCity' ILIKE '%' || ct || '%'
        OR fd.entity_data->>'companyCity' ILIKE '%' || ct || '%'
    ))

    -- Gender
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g
    ))

    -- Net worth
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))

    -- Income
    AND (p_income IS NULL OR fd.entity_data->>'incomeRange' = ANY(p_income) OR fd.entity_data->>'income' = ANY(p_income))

    -- Departments
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        fd.entity_data->>'department' ILIKE '%' || dept || '%'
        OR fd.entity_data->>'personDepartment' ILIKE '%' || dept || '%'
    ))

    -- Company revenue
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE 
        fd.entity_data->>'companyRevenue' ILIKE '%' || rev || '%'
        OR fd.entity_data->>'revenue' ILIKE '%' || rev || '%'
    ))

    -- Person interests
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))

    -- Person skills
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) skill
      WHERE fd.entity_data->>'skills' ILIKE '%' || skill || '%'
    ))

    -- Has personal email
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      coalesce(fd.entity_data->>'personalEmail', '') <> ''
      OR coalesce(fd.entity_data->>'personal_email', '') <> ''
      OR jsonb_array_length(coalesce(fd.entity_data->'personalEmails', '[]'::jsonb)) > 0
    ))

    -- Has business email
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      coalesce(fd.entity_data->>'businessEmail', '') <> ''
      OR coalesce(fd.entity_data->>'business_email', '') <> ''
      OR coalesce(fd.entity_data->>'email', '') <> ''
    ))

    -- Has phone
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'directNumber', '') <> ''
      OR coalesce(fd.entity_data->>'direct_number', '') <> ''
    ))

    -- Has LinkedIn
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      coalesce(fd.entity_data->>'linkedin', '') <> ''
      OR coalesce(fd.entity_data->>'linkedinUrl', '') <> ''
      OR coalesce(fd.entity_data->>'linkedin_url', '') <> ''
    ))

    -- Has Facebook
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      coalesce(fd.entity_data->>'facebookUrl', '') <> ''
      OR coalesce(fd.entity_data->>'facebook_url', '') <> ''
    ))

    -- Has Twitter
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      coalesce(fd.entity_data->>'twitterUrl', '') <> ''
      OR coalesce(fd.entity_data->>'twitter_url', '') <> ''
    ))

    -- Has company phone
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      coalesce(fd.entity_data->>'companyPhone', '') <> ''
      OR coalesce(fd.entity_data->>'company_phone', '') <> ''
    ))

    -- Has company LinkedIn
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      coalesce(fd.entity_data->>'companyLinkedin', '') <> ''
      OR coalesce(fd.entity_data->>'company_linkedin', '') <> ''
    ))

    -- Has company Facebook
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      coalesce(fd.entity_data->>'companyFacebookUrl', '') <> ''
      OR coalesce(fd.entity_data->>'company_facebook', '') <> ''
    ))

    -- Has company Twitter
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      coalesce(fd.entity_data->>'companyTwitterUrl', '') <> ''
      OR coalesce(fd.entity_data->>'company_twitter', '') <> ''
    ))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;