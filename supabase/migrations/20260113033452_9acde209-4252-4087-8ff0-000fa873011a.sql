-- Update search_free_data_builder with Department equivalence and Revenue range matching
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
RETURNS TABLE(
  entity_external_id text,
  entity_data jsonb,
  total_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  -- Get total count first
  SELECT count(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords: search in multiple text fields
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'personName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'personBio' ILIKE '%' || kw || '%'
    ))
    -- Job titles: partial match
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority: normalized matching with equivalences
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sen
      WHERE (
        -- Direct match
        lower(fd.entity_data->>'seniority') = lower(sen)
        -- C-Level equivalences
        OR (lower(sen) IN ('c-level', 'c level', 'c_level', 'clevel') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('c-level', 'c level', 'c_level', 'clevel', 'c-suite', 'c suite', 'csuite'))
        -- VP equivalences
        OR (lower(sen) IN ('vp', 'vice president', 'vice-president') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('vp', 'vice president', 'vice-president', 'vp-level'))
        -- Director equivalences
        OR (lower(sen) IN ('director') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%director%')
        -- Manager equivalences
        OR (lower(sen) IN ('manager') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%manager%')
        -- Senior equivalences
        OR (lower(sen) IN ('senior') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('senior', 'sr', 'sr.'))
        -- Entry equivalences
        OR (lower(sen) IN ('entry', 'entry-level', 'junior') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('entry', 'entry-level', 'junior', 'entry level'))
      )
    ))
    -- Company Size: RANGE-BASED matching against employee count
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) szr
      WHERE (
        CASE 
          WHEN fd.entity_data->>'employeeCount' ~ '^\d+$' THEN
            CASE szr
              WHEN '1-10' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'employeeCount')::int > 10000
              ELSE false
            END
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            CASE szr
              WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'companySize')::int > 10000
              ELSE false
            END
          ELSE false
        END
      )
    ))
    -- Industries: partial match
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Countries: match person or company country
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ctr
      WHERE 
        fd.entity_data->>'personCountry' ILIKE '%' || ctr || '%'
        OR fd.entity_data->>'companyCountry' ILIKE '%' || ctr || '%'
        OR fd.entity_data->>'country' ILIKE '%' || ctr || '%'
    ))
    -- Cities: match person or company city
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) cty
      WHERE 
        fd.entity_data->>'personCity' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'companyCity' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'city' ILIKE '%' || cty || '%'
    ))
    -- Gender
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g
    ))
    -- Net Worth
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    -- Income
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Departments: match with equivalence mapping
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE (
        -- Direct partial match on both fields
        fd.entity_data->>'department' ILIKE '%' || dept || '%'
        OR fd.entity_data->>'personDepartment' ILIKE '%' || dept || '%'
        -- Executive = C-Suite equivalence
        OR (
          lower(dept) IN ('executive', 'c-level', 'leadership', 'c-suite')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) IN ('c-suite', 'c suite', 'executive', 'leadership', 'c-level')
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) IN ('c-suite', 'c suite', 'executive', 'leadership', 'c-level')
          )
        )
        -- Engineering/IT/Technology equivalence
        OR (
          lower(dept) IN ('engineering', 'it', 'technology', 'tech')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%engineering%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%technical%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%engineering%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%technical%'
          )
        )
        -- Sales equivalence
        OR (
          lower(dept) IN ('sales', 'business development', 'bd')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%sales%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%sales%'
          )
        )
        -- Marketing equivalence
        OR (
          lower(dept) IN ('marketing', 'growth', 'communications')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%marketing%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%marketing%'
          )
        )
        -- Finance equivalence
        OR (
          lower(dept) IN ('finance', 'accounting', 'financial')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%finance%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%accounting%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%finance%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%accounting%'
          )
        )
        -- HR/People equivalence
        OR (
          lower(dept) IN ('hr', 'human resources', 'people', 'talent')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%human%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%people%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%hr%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%human%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%people%'
          )
        )
        -- Operations equivalence
        OR (
          lower(dept) IN ('operations', 'ops')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%operations%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%ops%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%operations%'
          )
        )
      )
    ))
    -- Company Revenue: RANGE-BASED matching against numeric values
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE (
        CASE 
          WHEN fd.entity_data->>'companyRevenue' ~ '^\d+$' THEN
            CASE rev
              WHEN 'Under $1M' THEN (fd.entity_data->>'companyRevenue')::bigint < 1000000
              WHEN '$1M - $10M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 1000000 AND 10000000
              WHEN '$10M - $50M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 10000001 AND 50000000
              WHEN '$50M - $100M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 50000001 AND 100000000
              WHEN '$100M - $500M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 100000001 AND 500000000
              WHEN '$500M - $1B' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 500000001 AND 1000000000
              WHEN '$1B+' THEN (fd.entity_data->>'companyRevenue')::bigint > 1000000000
              ELSE false
            END
          WHEN fd.entity_data->>'revenue' ~ '^\d+$' THEN
            CASE rev
              WHEN 'Under $1M' THEN (fd.entity_data->>'revenue')::bigint < 1000000
              WHEN '$1M - $10M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 1000000 AND 10000000
              WHEN '$10M - $50M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 10000001 AND 50000000
              WHEN '$50M - $100M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 50000001 AND 100000000
              WHEN '$100M - $500M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 100000001 AND 500000000
              WHEN '$500M - $1B' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 500000001 AND 1000000000
              WHEN '$1B+' THEN (fd.entity_data->>'revenue')::bigint > 1000000000
              ELSE false
            END
          ELSE false
        END
      )
    ))
    -- Person Interests
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'personInterests' ILIKE '%' || pi || '%'
    ))
    -- Person Skills
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'personSkills' ILIKE '%' || ps || '%'
    ))
    -- Prospect data flags
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords: search in multiple text fields
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'personName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'personBio' ILIKE '%' || kw || '%'
    ))
    -- Job titles: partial match
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    -- Seniority: normalized matching with equivalences
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sen
      WHERE (
        lower(fd.entity_data->>'seniority') = lower(sen)
        OR (lower(sen) IN ('c-level', 'c level', 'c_level', 'clevel') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('c-level', 'c level', 'c_level', 'clevel', 'c-suite', 'c suite', 'csuite'))
        OR (lower(sen) IN ('vp', 'vice president', 'vice-president') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('vp', 'vice president', 'vice-president', 'vp-level'))
        OR (lower(sen) IN ('director') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%director%')
        OR (lower(sen) IN ('manager') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) LIKE '%manager%')
        OR (lower(sen) IN ('senior') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('senior', 'sr', 'sr.'))
        OR (lower(sen) IN ('entry', 'entry-level', 'junior') 
            AND lower(coalesce(fd.entity_data->>'seniority', '')) IN ('entry', 'entry-level', 'junior', 'entry level'))
      )
    ))
    -- Company Size: RANGE-BASED matching
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) szr
      WHERE (
        CASE 
          WHEN fd.entity_data->>'employeeCount' ~ '^\d+$' THEN
            CASE szr
              WHEN '1-10' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'employeeCount')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'employeeCount')::int > 10000
              ELSE false
            END
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            CASE szr
              WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
              WHEN '10001+' THEN (fd.entity_data->>'companySize')::int > 10000
              ELSE false
            END
          ELSE false
        END
      )
    ))
    -- Industries: partial match
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Countries
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ctr
      WHERE 
        fd.entity_data->>'personCountry' ILIKE '%' || ctr || '%'
        OR fd.entity_data->>'companyCountry' ILIKE '%' || ctr || '%'
        OR fd.entity_data->>'country' ILIKE '%' || ctr || '%'
    ))
    -- Cities
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) cty
      WHERE 
        fd.entity_data->>'personCity' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'companyCity' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'city' ILIKE '%' || cty || '%'
    ))
    -- Gender
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE fd.entity_data->>'gender' ILIKE g
    ))
    -- Net Worth
    AND (p_net_worth IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    -- Income
    AND (p_income IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    -- Departments with equivalence mapping
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE (
        fd.entity_data->>'department' ILIKE '%' || dept || '%'
        OR fd.entity_data->>'personDepartment' ILIKE '%' || dept || '%'
        OR (
          lower(dept) IN ('executive', 'c-level', 'leadership', 'c-suite')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) IN ('c-suite', 'c suite', 'executive', 'leadership', 'c-level')
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) IN ('c-suite', 'c suite', 'executive', 'leadership', 'c-level')
          )
        )
        OR (
          lower(dept) IN ('engineering', 'it', 'technology', 'tech')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%engineering%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%technical%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%engineering%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%technical%'
          )
        )
        OR (
          lower(dept) IN ('sales', 'business development', 'bd')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%sales%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%sales%'
          )
        )
        OR (
          lower(dept) IN ('marketing', 'growth', 'communications')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%marketing%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%marketing%'
          )
        )
        OR (
          lower(dept) IN ('finance', 'accounting', 'financial')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%finance%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%accounting%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%finance%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%accounting%'
          )
        )
        OR (
          lower(dept) IN ('hr', 'human resources', 'people', 'talent')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%human%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%people%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%hr%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%human%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%people%'
          )
        )
        OR (
          lower(dept) IN ('operations', 'ops')
          AND (
            lower(coalesce(fd.entity_data->>'department', '')) LIKE '%operations%'
            OR lower(coalesce(fd.entity_data->>'department', '')) LIKE '%ops%'
            OR lower(coalesce(fd.entity_data->>'personDepartment', '')) LIKE '%operations%'
          )
        )
      )
    ))
    -- Company Revenue: RANGE-BASED matching
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev
      WHERE (
        CASE 
          WHEN fd.entity_data->>'companyRevenue' ~ '^\d+$' THEN
            CASE rev
              WHEN 'Under $1M' THEN (fd.entity_data->>'companyRevenue')::bigint < 1000000
              WHEN '$1M - $10M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 1000000 AND 10000000
              WHEN '$10M - $50M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 10000001 AND 50000000
              WHEN '$50M - $100M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 50000001 AND 100000000
              WHEN '$100M - $500M' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 100000001 AND 500000000
              WHEN '$500M - $1B' THEN (fd.entity_data->>'companyRevenue')::bigint BETWEEN 500000001 AND 1000000000
              WHEN '$1B+' THEN (fd.entity_data->>'companyRevenue')::bigint > 1000000000
              ELSE false
            END
          WHEN fd.entity_data->>'revenue' ~ '^\d+$' THEN
            CASE rev
              WHEN 'Under $1M' THEN (fd.entity_data->>'revenue')::bigint < 1000000
              WHEN '$1M - $10M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 1000000 AND 10000000
              WHEN '$10M - $50M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 10000001 AND 50000000
              WHEN '$50M - $100M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 50000001 AND 100000000
              WHEN '$100M - $500M' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 100000001 AND 500000000
              WHEN '$500M - $1B' THEN (fd.entity_data->>'revenue')::bigint BETWEEN 500000001 AND 1000000000
              WHEN '$1B+' THEN (fd.entity_data->>'revenue')::bigint > 1000000000
              ELSE false
            END
          ELSE false
        END
      )
    ))
    -- Person Interests
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'personInterests' ILIKE '%' || pi || '%'
    ))
    -- Person Skills
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'personSkills' ILIKE '%' || ps || '%'
    ))
    -- Prospect data flags
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;