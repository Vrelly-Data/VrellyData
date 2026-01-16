-- Restore stable filter logic for search_free_data_builder
-- Fixes: Prospect Data field mismatches + Net Worth/Income numeric parsing

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type TEXT DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_seniority_levels TEXT[] DEFAULT NULL,
  p_company_size_ranges TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_gender TEXT[] DEFAULT NULL,
  p_net_worth TEXT[] DEFAULT NULL,
  p_income TEXT[] DEFAULT NULL,
  p_departments TEXT[] DEFAULT NULL,
  p_company_revenue TEXT[] DEFAULT NULL,
  p_person_interests TEXT[] DEFAULT NULL,
  p_person_skills TEXT[] DEFAULT NULL,
  p_technologies TEXT[] DEFAULT NULL,
  p_has_personal_email BOOLEAN DEFAULT NULL,
  p_has_business_email BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_facebook BOOLEAN DEFAULT NULL,
  p_has_twitter BOOLEAN DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
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
  -- Count total matching records
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- Keywords (search in multiple fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'fullName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
    ))
    
    -- Job titles
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority levels
    AND (p_seniority_levels IS NULL OR 
      fd.entity_data->>'seniority' = ANY(p_seniority_levels) OR
      public.title_matches_seniority(p_seniority_levels, fd.entity_data->>'seniority', fd.entity_data->>'title')
    )
    
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges))
    
    -- Industries
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    
    -- Countries (check multiple fields)
    AND (p_countries IS NULL OR 
      fd.entity_data->>'country' = ANY(p_countries) OR
      fd.entity_data->>'personCountry' = ANY(p_countries) OR
      fd.entity_data->>'companyCountry' = ANY(p_countries)
    )
    
    -- Cities (check multiple fields)
    AND (p_cities IS NULL OR 
      fd.entity_data->>'city' = ANY(p_cities) OR
      fd.entity_data->>'personCity' = ANY(p_cities) OR
      fd.entity_data->>'companyCity' = ANY(p_cities)
    )
    
    -- Gender
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    
    -- Net Worth - numeric parsing with range mapping
    AND (p_net_worth IS NULL OR (
      CASE
        WHEN fd.entity_data->>'netWorth' IS NULL OR fd.entity_data->>'netWorth' = '' THEN FALSE
        WHEN fd.entity_data->>'netWorth' LIKE '-%' THEN FALSE -- Skip negative values
        ELSE
          CASE
            WHEN 'Under $100K' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) < 100 THEN TRUE
            WHEN '$100K - $500K' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 100 AND 499 THEN TRUE
            WHEN '$500K - $1M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 500 AND 999 THEN TRUE
            WHEN '$1M - $5M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 1000 AND 4999 THEN TRUE
            WHEN '$5M - $10M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 5000 AND 9999 THEN TRUE
            WHEN '$10M - $50M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 10000 AND 49999 THEN TRUE
            WHEN '$50M+' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) >= 50000 THEN TRUE
            ELSE FALSE
          END
      END
    ))
    
    -- Income - numeric parsing with range mapping (check incomeRange field)
    AND (p_income IS NULL OR (
      CASE
        WHEN fd.entity_data->>'incomeRange' IS NULL OR fd.entity_data->>'incomeRange' = '' THEN FALSE
        ELSE
          CASE
            WHEN 'Under $50K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) < 50 THEN TRUE
            WHEN '$50K - $100K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 50 AND 99 THEN TRUE
            WHEN '$100K - $200K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 100 AND 199 THEN TRUE
            WHEN '$200K - $500K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 200 AND 499 THEN TRUE
            WHEN '$500K - $1M' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 500 AND 999 THEN TRUE
            WHEN '$1M+' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) >= 1000 THEN TRUE
            ELSE FALSE
          END
      END
    ))
    
    -- Departments
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE fd.entity_data->>'department' ILIKE '%' || dept || '%'
    ))
    
    -- Company revenue
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    
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
    
    -- Technologies
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    
    -- Personal email (check multiple field variants)
    AND (p_has_personal_email IS NULL OR 
      (p_has_personal_email = TRUE AND (
        (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
        (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '')
      )) OR
      (p_has_personal_email = FALSE AND 
        (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = '') AND
        (fd.entity_data->>'email' IS NULL OR fd.entity_data->>'email' = '')
      )
    )
    
    -- Business email (check multiple field variants)
    AND (p_has_business_email IS NULL OR 
      (p_has_business_email = TRUE AND (
        (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
        (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' != '')
      )) OR
      (p_has_business_email = FALSE AND 
        (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = '') AND
        (fd.entity_data->>'workEmail' IS NULL OR fd.entity_data->>'workEmail' = '')
      )
    )
    
    -- Phone (check multiple field variants)
    AND (p_has_phone IS NULL OR 
      (p_has_phone = TRUE AND (
        (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
        (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != '')
      )) OR
      (p_has_phone = FALSE AND 
        (fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = '') AND
        (fd.entity_data->>'mobilePhone' IS NULL OR fd.entity_data->>'mobilePhone' = '')
      )
    )
    
    -- Personal LinkedIn (check BOTH linkedin AND linkedinUrl)
    AND (p_has_linkedin IS NULL OR 
      (p_has_linkedin = TRUE AND (
        (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != '') OR
        (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '')
      )) OR
      (p_has_linkedin = FALSE AND 
        (fd.entity_data->>'linkedin' IS NULL OR fd.entity_data->>'linkedin' = '') AND
        (fd.entity_data->>'linkedinUrl' IS NULL OR fd.entity_data->>'linkedinUrl' = '')
      )
    )
    
    -- Personal Facebook (check multiple field variants)
    AND (p_has_facebook IS NULL OR 
      (p_has_facebook = TRUE AND (
        (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '') OR
        (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != '')
      )) OR
      (p_has_facebook = FALSE AND 
        (fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = '') AND
        (fd.entity_data->>'facebook' IS NULL OR fd.entity_data->>'facebook' = '')
      )
    )
    
    -- Personal Twitter (check multiple field variants)
    AND (p_has_twitter IS NULL OR 
      (p_has_twitter = TRUE AND (
        (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '') OR
        (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != '')
      )) OR
      (p_has_twitter = FALSE AND 
        (fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = '') AND
        (fd.entity_data->>'twitter' IS NULL OR fd.entity_data->>'twitter' = '')
      )
    )
    
    -- Company phone
    AND (p_has_company_phone IS NULL OR 
      (p_has_company_phone = TRUE AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '') OR
      (p_has_company_phone = FALSE AND (fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = ''))
    )
    
    -- Company LinkedIn (check BOTH companyLinkedin AND companyLinkedinUrl)
    AND (p_has_company_linkedin IS NULL OR 
      (p_has_company_linkedin = TRUE AND (
        (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != '') OR
        (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != '')
      )) OR
      (p_has_company_linkedin = FALSE AND 
        (fd.entity_data->>'companyLinkedin' IS NULL OR fd.entity_data->>'companyLinkedin' = '') AND
        (fd.entity_data->>'companyLinkedinUrl' IS NULL OR fd.entity_data->>'companyLinkedinUrl' = '')
      )
    )
    
    -- Company Facebook (check multiple field variants)
    AND (p_has_company_facebook IS NULL OR 
      (p_has_company_facebook = TRUE AND (
        (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '') OR
        (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' != '')
      )) OR
      (p_has_company_facebook = FALSE AND 
        (fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = '') AND
        (fd.entity_data->>'companyFacebook' IS NULL OR fd.entity_data->>'companyFacebook' = '')
      )
    )
    
    -- Company Twitter (check multiple field variants)
    AND (p_has_company_twitter IS NULL OR 
      (p_has_company_twitter = TRUE AND (
        (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '') OR
        (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' != '')
      )) OR
      (p_has_company_twitter = FALSE AND 
        (fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = '') AND
        (fd.entity_data->>'companyTwitter' IS NULL OR fd.entity_data->>'companyTwitter' = '')
      )
    );

  -- Return paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- Keywords (search in multiple fields)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'fullName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
    ))
    
    -- Job titles
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority levels
    AND (p_seniority_levels IS NULL OR 
      fd.entity_data->>'seniority' = ANY(p_seniority_levels) OR
      public.title_matches_seniority(p_seniority_levels, fd.entity_data->>'seniority', fd.entity_data->>'title')
    )
    
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges))
    
    -- Industries
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    
    -- Countries (check multiple fields)
    AND (p_countries IS NULL OR 
      fd.entity_data->>'country' = ANY(p_countries) OR
      fd.entity_data->>'personCountry' = ANY(p_countries) OR
      fd.entity_data->>'companyCountry' = ANY(p_countries)
    )
    
    -- Cities (check multiple fields)
    AND (p_cities IS NULL OR 
      fd.entity_data->>'city' = ANY(p_cities) OR
      fd.entity_data->>'personCity' = ANY(p_cities) OR
      fd.entity_data->>'companyCity' = ANY(p_cities)
    )
    
    -- Gender
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    
    -- Net Worth - numeric parsing with range mapping
    AND (p_net_worth IS NULL OR (
      CASE
        WHEN fd.entity_data->>'netWorth' IS NULL OR fd.entity_data->>'netWorth' = '' THEN FALSE
        WHEN fd.entity_data->>'netWorth' LIKE '-%' THEN FALSE -- Skip negative values
        ELSE
          CASE
            WHEN 'Under $100K' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) < 100 THEN TRUE
            WHEN '$100K - $500K' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 100 AND 499 THEN TRUE
            WHEN '$500K - $1M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 500 AND 999 THEN TRUE
            WHEN '$1M - $5M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 1000 AND 4999 THEN TRUE
            WHEN '$5M - $10M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 5000 AND 9999 THEN TRUE
            WHEN '$10M - $50M' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 10000 AND 49999 THEN TRUE
            WHEN '$50M+' = ANY(p_net_worth) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::NUMERIC, 0) >= 50000 THEN TRUE
            ELSE FALSE
          END
      END
    ))
    
    -- Income - numeric parsing with range mapping (check incomeRange field)
    AND (p_income IS NULL OR (
      CASE
        WHEN fd.entity_data->>'incomeRange' IS NULL OR fd.entity_data->>'incomeRange' = '' THEN FALSE
        ELSE
          CASE
            WHEN 'Under $50K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) < 50 THEN TRUE
            WHEN '$50K - $100K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 50 AND 99 THEN TRUE
            WHEN '$100K - $200K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 100 AND 199 THEN TRUE
            WHEN '$200K - $500K' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 200 AND 499 THEN TRUE
            WHEN '$500K - $1M' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) BETWEEN 500 AND 999 THEN TRUE
            WHEN '$1M+' = ANY(p_income) AND 
              COALESCE(NULLIF(regexp_replace(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::NUMERIC, 0) >= 1000 THEN TRUE
            ELSE FALSE
          END
      END
    ))
    
    -- Departments
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE fd.entity_data->>'department' ILIKE '%' || dept || '%'
    ))
    
    -- Company revenue
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
    
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
    
    -- Technologies
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    
    -- Personal email (check multiple field variants)
    AND (p_has_personal_email IS NULL OR 
      (p_has_personal_email = TRUE AND (
        (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != '') OR
        (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '')
      )) OR
      (p_has_personal_email = FALSE AND 
        (fd.entity_data->>'personalEmail' IS NULL OR fd.entity_data->>'personalEmail' = '') AND
        (fd.entity_data->>'email' IS NULL OR fd.entity_data->>'email' = '')
      )
    )
    
    -- Business email (check multiple field variants)
    AND (p_has_business_email IS NULL OR 
      (p_has_business_email = TRUE AND (
        (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
        (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' != '')
      )) OR
      (p_has_business_email = FALSE AND 
        (fd.entity_data->>'businessEmail' IS NULL OR fd.entity_data->>'businessEmail' = '') AND
        (fd.entity_data->>'workEmail' IS NULL OR fd.entity_data->>'workEmail' = '')
      )
    )
    
    -- Phone (check multiple field variants)
    AND (p_has_phone IS NULL OR 
      (p_has_phone = TRUE AND (
        (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
        (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != '')
      )) OR
      (p_has_phone = FALSE AND 
        (fd.entity_data->>'phone' IS NULL OR fd.entity_data->>'phone' = '') AND
        (fd.entity_data->>'mobilePhone' IS NULL OR fd.entity_data->>'mobilePhone' = '')
      )
    )
    
    -- Personal LinkedIn (check BOTH linkedin AND linkedinUrl)
    AND (p_has_linkedin IS NULL OR 
      (p_has_linkedin = TRUE AND (
        (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != '') OR
        (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '')
      )) OR
      (p_has_linkedin = FALSE AND 
        (fd.entity_data->>'linkedin' IS NULL OR fd.entity_data->>'linkedin' = '') AND
        (fd.entity_data->>'linkedinUrl' IS NULL OR fd.entity_data->>'linkedinUrl' = '')
      )
    )
    
    -- Personal Facebook (check multiple field variants)
    AND (p_has_facebook IS NULL OR 
      (p_has_facebook = TRUE AND (
        (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '') OR
        (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != '')
      )) OR
      (p_has_facebook = FALSE AND 
        (fd.entity_data->>'facebookUrl' IS NULL OR fd.entity_data->>'facebookUrl' = '') AND
        (fd.entity_data->>'facebook' IS NULL OR fd.entity_data->>'facebook' = '')
      )
    )
    
    -- Personal Twitter (check multiple field variants)
    AND (p_has_twitter IS NULL OR 
      (p_has_twitter = TRUE AND (
        (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '') OR
        (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != '')
      )) OR
      (p_has_twitter = FALSE AND 
        (fd.entity_data->>'twitterUrl' IS NULL OR fd.entity_data->>'twitterUrl' = '') AND
        (fd.entity_data->>'twitter' IS NULL OR fd.entity_data->>'twitter' = '')
      )
    )
    
    -- Company phone
    AND (p_has_company_phone IS NULL OR 
      (p_has_company_phone = TRUE AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != '') OR
      (p_has_company_phone = FALSE AND (fd.entity_data->>'companyPhone' IS NULL OR fd.entity_data->>'companyPhone' = ''))
    )
    
    -- Company LinkedIn (check BOTH companyLinkedin AND companyLinkedinUrl)
    AND (p_has_company_linkedin IS NULL OR 
      (p_has_company_linkedin = TRUE AND (
        (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != '') OR
        (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != '')
      )) OR
      (p_has_company_linkedin = FALSE AND 
        (fd.entity_data->>'companyLinkedin' IS NULL OR fd.entity_data->>'companyLinkedin' = '') AND
        (fd.entity_data->>'companyLinkedinUrl' IS NULL OR fd.entity_data->>'companyLinkedinUrl' = '')
      )
    )
    
    -- Company Facebook (check multiple field variants)
    AND (p_has_company_facebook IS NULL OR 
      (p_has_company_facebook = TRUE AND (
        (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != '') OR
        (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' != '')
      )) OR
      (p_has_company_facebook = FALSE AND 
        (fd.entity_data->>'companyFacebookUrl' IS NULL OR fd.entity_data->>'companyFacebookUrl' = '') AND
        (fd.entity_data->>'companyFacebook' IS NULL OR fd.entity_data->>'companyFacebook' = '')
      )
    )
    
    -- Company Twitter (check multiple field variants)
    AND (p_has_company_twitter IS NULL OR 
      (p_has_company_twitter = TRUE AND (
        (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != '') OR
        (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' != '')
      )) OR
      (p_has_company_twitter = FALSE AND 
        (fd.entity_data->>'companyTwitterUrl' IS NULL OR fd.entity_data->>'companyTwitterUrl' = '') AND
        (fd.entity_data->>'companyTwitter' IS NULL OR fd.entity_data->>'companyTwitter' = '')
      )
    )
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;