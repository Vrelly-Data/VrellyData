
-- Update search_free_data_with_filters_v2 to handle company size as numeric ranges
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters_v2(
  p_entity_type entity_type,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_person_city text[] DEFAULT NULL,
  p_person_country text[] DEFAULT NULL,
  p_company_city text[] DEFAULT NULL,
  p_company_country text[] DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority text[] DEFAULT NULL,
  p_company_size text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_department text[] DEFAULT NULL,
  p_keywords text[] DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  entity_data jsonb,
  entity_external_id text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
BEGIN
  -- First, get the total count
  SELECT COUNT(*) INTO v_total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Industry filter
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) AS ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Person city filter
    AND (p_person_city IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_city) AS pc
      WHERE fd.entity_data->>'city' ILIKE '%' || pc || '%'
    ))
    -- Person country filter
    AND (p_person_country IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_country) AS pco
      WHERE fd.entity_data->>'country' ILIKE '%' || pco || '%'
    ))
    -- Company city filter
    AND (p_company_city IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_city) AS cc
      WHERE fd.entity_data->>'companyCity' ILIKE '%' || cc || '%'
    ))
    -- Company country filter
    AND (p_company_country IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_country) AS cco
      WHERE fd.entity_data->>'companyCountry' ILIKE '%' || cco || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR fd.entity_data->>'gender' ILIKE p_gender)
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) AS jt
      WHERE fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter
    AND (p_seniority IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority) AS sen
      WHERE fd.entity_data->>'seniority' ILIKE '%' || sen || '%'
         OR title_matches_seniority(p_seniority, fd.entity_data->>'jobTitle')
    ))
    -- Company size filter - NOW WITH NUMERIC RANGE MATCHING
    AND (p_company_size IS NULL OR (
      SELECT bool_or(
        CASE 
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            CASE s
              WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
              WHEN '10000+' THEN (fd.entity_data->>'companySize')::int >= 10001
              ELSE fd.entity_data->>'companySize' = s
            END
          ELSE fd.entity_data->>'companySize' = s
        END
      )
      FROM unnest(p_company_size) AS s
    ))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    -- Department filter
    AND (p_department IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_department) AS dept
      WHERE fd.entity_data->>'department' ILIKE '%' || dept || '%'
    ))
    -- Keywords filter
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) AS kw
      WHERE fd.entity_data::text ILIKE '%' || kw || '%'
    ))
    -- Prospect data availability filters
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_phone IS NULL OR (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_personal_email IS NULL OR (p_has_personal_email = true AND fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR (p_has_business_email = true AND fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_facebook IS NULL OR (p_has_facebook = true AND fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR (p_has_twitter = true AND fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = true AND fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = true AND fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
    -- Income filter
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    -- Net worth filter
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) AS pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) AS ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ));

  -- Return the results with total count
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    v_total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Industry filter
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) AS ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    -- Person city filter
    AND (p_person_city IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_city) AS pc
      WHERE fd.entity_data->>'city' ILIKE '%' || pc || '%'
    ))
    -- Person country filter
    AND (p_person_country IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_country) AS pco
      WHERE fd.entity_data->>'country' ILIKE '%' || pco || '%'
    ))
    -- Company city filter
    AND (p_company_city IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_city) AS cc
      WHERE fd.entity_data->>'companyCity' ILIKE '%' || cc || '%'
    ))
    -- Company country filter
    AND (p_company_country IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_country) AS cco
      WHERE fd.entity_data->>'companyCountry' ILIKE '%' || cco || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR fd.entity_data->>'gender' ILIKE p_gender)
    -- Job titles filter
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) AS jt
      WHERE fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
    ))
    -- Seniority filter
    AND (p_seniority IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority) AS sen
      WHERE fd.entity_data->>'seniority' ILIKE '%' || sen || '%'
         OR title_matches_seniority(p_seniority, fd.entity_data->>'jobTitle')
    ))
    -- Company size filter - NOW WITH NUMERIC RANGE MATCHING
    AND (p_company_size IS NULL OR (
      SELECT bool_or(
        CASE 
          WHEN fd.entity_data->>'companySize' ~ '^\d+$' THEN
            CASE s
              WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
              WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
              WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
              WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
              WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
              WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
              WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
              WHEN '10000+' THEN (fd.entity_data->>'companySize')::int >= 10001
              ELSE fd.entity_data->>'companySize' = s
            END
          ELSE fd.entity_data->>'companySize' = s
        END
      )
      FROM unnest(p_company_size) AS s
    ))
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    -- Department filter
    AND (p_department IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_department) AS dept
      WHERE fd.entity_data->>'department' ILIKE '%' || dept || '%'
    ))
    -- Keywords filter
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) AS kw
      WHERE fd.entity_data::text ILIKE '%' || kw || '%'
    ))
    -- Prospect data availability filters
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_phone IS NULL OR (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_personal_email IS NULL OR (p_has_personal_email = true AND fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR (p_has_business_email = true AND fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_facebook IS NULL OR (p_has_facebook = true AND fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR (p_has_twitter = true AND fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = true AND fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = true AND fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
    -- Income filter
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    -- Net worth filter
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) AS pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) AS ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
