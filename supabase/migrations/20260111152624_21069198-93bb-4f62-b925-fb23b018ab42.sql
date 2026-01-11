-- Drop and recreate the search_free_data_with_filters function with fixed parameters
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters(
  p_entity_type TEXT,
  p_keywords TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_seniority TEXT[] DEFAULT NULL,
  p_department TEXT[] DEFAULT NULL,
  p_company_size TEXT[] DEFAULT NULL,
  p_net_worth TEXT[] DEFAULT NULL,
  p_income TEXT[] DEFAULT NULL,
  p_has_personal_email BOOLEAN DEFAULT NULL,
  p_has_business_email BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_facebook BOOLEAN DEFAULT NULL,
  p_has_twitter BOOLEAN DEFAULT NULL,
  p_person_city TEXT[] DEFAULT NULL,
  p_person_country TEXT[] DEFAULT NULL,
  p_company_city TEXT[] DEFAULT NULL,
  p_company_country TEXT[] DEFAULT NULL,
  p_person_interests TEXT[] DEFAULT NULL,
  p_person_skills TEXT[] DEFAULT NULL,
  p_company_revenue TEXT[] DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  entity_external_id TEXT,
  entity_data JSONB,
  total_count BIGINT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter (search in multiple fields)
    AND (
      p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE 
          fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'companyIndustry' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'personJobTitle' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'personFullName' ILIKE '%' || kw || '%'
      )
    )
    -- Industries filter
    AND (
      p_industries IS NULL OR array_length(p_industries, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_industries) ind
        WHERE fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
      )
    )
    -- Cities filter (legacy - checks both person and company)
    AND (
      p_cities IS NULL OR array_length(p_cities, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_cities) city
        WHERE 
          fd.entity_data->>'personCity' ILIKE '%' || city || '%'
          OR fd.entity_data->>'companyCity' ILIKE '%' || city || '%'
      )
    )
    -- Gender filter
    AND (
      p_gender IS NULL
      OR fd.entity_data->>'personGender' = p_gender
    )
    -- Job titles filter
    AND (
      p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) jt
        WHERE fd.entity_data->>'personJobTitle' ILIKE '%' || jt || '%'
      )
    )
    -- Seniority filter
    AND (
      p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_seniority) sen
        WHERE fd.entity_data->>'personSeniority' ILIKE '%' || sen || '%'
      )
    )
    -- Department filter
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_department) dept
        WHERE fd.entity_data->>'personDepartment' ILIKE '%' || dept || '%'
      )
    )
    -- Company size filter
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_size) cs
        WHERE fd.entity_data->>'companySize' ILIKE '%' || cs || '%'
          OR fd.entity_data->>'companyEmployeeCount' ILIKE '%' || cs || '%'
      )
    )
    -- Net worth filter
    AND (
      p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw
        WHERE fd.entity_data->>'personNetWorth' ILIKE '%' || nw || '%'
      )
    )
    -- Income filter
    AND (
      p_income IS NULL OR array_length(p_income, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_income) inc
        WHERE fd.entity_data->>'personIncome' ILIKE '%' || inc || '%'
      )
    )
    -- Has personal email
    AND (
      p_has_personal_email IS NULL OR p_has_personal_email = false
      OR (fd.entity_data->>'personEmail' IS NOT NULL AND fd.entity_data->>'personEmail' <> '')
    )
    -- Has business email
    AND (
      p_has_business_email IS NULL OR p_has_business_email = false
      OR (fd.entity_data->>'personBusinessEmail' IS NOT NULL AND fd.entity_data->>'personBusinessEmail' <> '')
    )
    -- Has phone (direct mobile)
    AND (
      p_has_phone IS NULL OR p_has_phone = false
      OR (fd.entity_data->>'personPhone' IS NOT NULL AND fd.entity_data->>'personPhone' <> '')
    )
    -- Has personal LinkedIn
    AND (
      p_has_linkedin IS NULL OR p_has_linkedin = false
      OR (fd.entity_data->>'personLinkedin' IS NOT NULL AND fd.entity_data->>'personLinkedin' <> '')
    )
    -- Has personal Facebook
    AND (
      p_has_facebook IS NULL OR p_has_facebook = false
      OR (fd.entity_data->>'personFacebookUrl' IS NOT NULL AND fd.entity_data->>'personFacebookUrl' <> '')
    )
    -- Has personal Twitter
    AND (
      p_has_twitter IS NULL OR p_has_twitter = false
      OR (fd.entity_data->>'personTwitterUrl' IS NOT NULL AND fd.entity_data->>'personTwitterUrl' <> '')
    )
    -- Has company phone
    AND (
      p_has_company_phone IS NULL OR p_has_company_phone = false
      OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> '')
    )
    -- Has company LinkedIn
    AND (
      p_has_company_linkedin IS NULL OR p_has_company_linkedin = false
      OR (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '')
    )
    -- Has company Facebook
    AND (
      p_has_company_facebook IS NULL OR p_has_company_facebook = false
      OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> '')
    )
    -- Has company Twitter
    AND (
      p_has_company_twitter IS NULL OR p_has_company_twitter = false
      OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> '')
    )
    -- Person city filter
    AND (
      p_person_city IS NULL OR array_length(p_person_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_city) pc
        WHERE fd.entity_data->>'personCity' ILIKE '%' || pc || '%'
      )
    )
    -- Person country filter
    AND (
      p_person_country IS NULL OR array_length(p_person_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_country) pc
        WHERE fd.entity_data->>'personCountry' ILIKE '%' || pc || '%'
      )
    )
    -- Company city filter
    AND (
      p_company_city IS NULL OR array_length(p_company_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_city) cc
        WHERE fd.entity_data->>'companyCity' ILIKE '%' || cc || '%'
      )
    )
    -- Company country filter
    AND (
      p_company_country IS NULL OR array_length(p_company_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_country) cc
        WHERE fd.entity_data->>'companyCountry' ILIKE '%' || cc || '%'
      )
    )
    -- Person interests filter
    AND (
      p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_interests) pi
        WHERE fd.entity_data->>'personInterests' ILIKE '%' || pi || '%'
      )
    )
    -- Person skills filter
    AND (
      p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_skills) ps
        WHERE fd.entity_data->>'personSkills' ILIKE '%' || ps || '%'
      )
    )
    -- Company revenue filter
    AND (
      p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_revenue) cr
        WHERE fd.entity_data->>'companyRevenue' ILIKE '%' || cr || '%'
      )
    );

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total as total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter (search in multiple fields)
    AND (
      p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE 
          fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'companyIndustry' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'personJobTitle' ILIKE '%' || kw || '%'
          OR fd.entity_data->>'personFullName' ILIKE '%' || kw || '%'
      )
    )
    -- Industries filter
    AND (
      p_industries IS NULL OR array_length(p_industries, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_industries) ind
        WHERE fd.entity_data->>'companyIndustry' ILIKE '%' || ind || '%'
      )
    )
    -- Cities filter (legacy - checks both person and company)
    AND (
      p_cities IS NULL OR array_length(p_cities, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_cities) city
        WHERE 
          fd.entity_data->>'personCity' ILIKE '%' || city || '%'
          OR fd.entity_data->>'companyCity' ILIKE '%' || city || '%'
      )
    )
    -- Gender filter
    AND (
      p_gender IS NULL
      OR fd.entity_data->>'personGender' = p_gender
    )
    -- Job titles filter
    AND (
      p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) jt
        WHERE fd.entity_data->>'personJobTitle' ILIKE '%' || jt || '%'
      )
    )
    -- Seniority filter
    AND (
      p_seniority IS NULL OR array_length(p_seniority, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_seniority) sen
        WHERE fd.entity_data->>'personSeniority' ILIKE '%' || sen || '%'
      )
    )
    -- Department filter
    AND (
      p_department IS NULL OR array_length(p_department, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_department) dept
        WHERE fd.entity_data->>'personDepartment' ILIKE '%' || dept || '%'
      )
    )
    -- Company size filter
    AND (
      p_company_size IS NULL OR array_length(p_company_size, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_size) cs
        WHERE fd.entity_data->>'companySize' ILIKE '%' || cs || '%'
          OR fd.entity_data->>'companyEmployeeCount' ILIKE '%' || cs || '%'
      )
    )
    -- Net worth filter
    AND (
      p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw
        WHERE fd.entity_data->>'personNetWorth' ILIKE '%' || nw || '%'
      )
    )
    -- Income filter
    AND (
      p_income IS NULL OR array_length(p_income, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_income) inc
        WHERE fd.entity_data->>'personIncome' ILIKE '%' || inc || '%'
      )
    )
    -- Has personal email
    AND (
      p_has_personal_email IS NULL OR p_has_personal_email = false
      OR (fd.entity_data->>'personEmail' IS NOT NULL AND fd.entity_data->>'personEmail' <> '')
    )
    -- Has business email
    AND (
      p_has_business_email IS NULL OR p_has_business_email = false
      OR (fd.entity_data->>'personBusinessEmail' IS NOT NULL AND fd.entity_data->>'personBusinessEmail' <> '')
    )
    -- Has phone (direct mobile)
    AND (
      p_has_phone IS NULL OR p_has_phone = false
      OR (fd.entity_data->>'personPhone' IS NOT NULL AND fd.entity_data->>'personPhone' <> '')
    )
    -- Has personal LinkedIn
    AND (
      p_has_linkedin IS NULL OR p_has_linkedin = false
      OR (fd.entity_data->>'personLinkedin' IS NOT NULL AND fd.entity_data->>'personLinkedin' <> '')
    )
    -- Has personal Facebook
    AND (
      p_has_facebook IS NULL OR p_has_facebook = false
      OR (fd.entity_data->>'personFacebookUrl' IS NOT NULL AND fd.entity_data->>'personFacebookUrl' <> '')
    )
    -- Has personal Twitter
    AND (
      p_has_twitter IS NULL OR p_has_twitter = false
      OR (fd.entity_data->>'personTwitterUrl' IS NOT NULL AND fd.entity_data->>'personTwitterUrl' <> '')
    )
    -- Has company phone
    AND (
      p_has_company_phone IS NULL OR p_has_company_phone = false
      OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> '')
    )
    -- Has company LinkedIn
    AND (
      p_has_company_linkedin IS NULL OR p_has_company_linkedin = false
      OR (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '')
    )
    -- Has company Facebook
    AND (
      p_has_company_facebook IS NULL OR p_has_company_facebook = false
      OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> '')
    )
    -- Has company Twitter
    AND (
      p_has_company_twitter IS NULL OR p_has_company_twitter = false
      OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> '')
    )
    -- Person city filter
    AND (
      p_person_city IS NULL OR array_length(p_person_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_city) pc
        WHERE fd.entity_data->>'personCity' ILIKE '%' || pc || '%'
      )
    )
    -- Person country filter
    AND (
      p_person_country IS NULL OR array_length(p_person_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_country) pc
        WHERE fd.entity_data->>'personCountry' ILIKE '%' || pc || '%'
      )
    )
    -- Company city filter
    AND (
      p_company_city IS NULL OR array_length(p_company_city, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_city) cc
        WHERE fd.entity_data->>'companyCity' ILIKE '%' || cc || '%'
      )
    )
    -- Company country filter
    AND (
      p_company_country IS NULL OR array_length(p_company_country, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_country) cc
        WHERE fd.entity_data->>'companyCountry' ILIKE '%' || cc || '%'
      )
    )
    -- Person interests filter
    AND (
      p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_interests) pi
        WHERE fd.entity_data->>'personInterests' ILIKE '%' || pi || '%'
      )
    )
    -- Person skills filter
    AND (
      p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_person_skills) ps
        WHERE fd.entity_data->>'personSkills' ILIKE '%' || ps || '%'
      )
    )
    -- Company revenue filter
    AND (
      p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_company_revenue) cr
        WHERE fd.entity_data->>'companyRevenue' ILIKE '%' || cr || '%'
      )
    )
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;