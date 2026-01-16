-- Update search_free_data_builder to pass seniority field to title_matches_seniority
-- Using CREATE OR REPLACE with EXACT same signature to update in-place (no duplicates)

CREATE OR REPLACE FUNCTION public.search_free_data_builder(p_entity_type text DEFAULT NULL::text, p_keywords text[] DEFAULT NULL::text[], p_job_titles text[] DEFAULT NULL::text[], p_seniority_levels text[] DEFAULT NULL::text[], p_departments text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_technologies text[] DEFAULT NULL::text[], p_company_size_ranges text[] DEFAULT NULL::text[], p_company_revenue text[] DEFAULT NULL::text[], p_cities text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_gender text[] DEFAULT NULL::text[], p_net_worth text[] DEFAULT NULL::text[], p_income text[] DEFAULT NULL::text[], p_person_interests text[] DEFAULT NULL::text[], p_person_skills text[] DEFAULT NULL::text[], p_has_linkedin boolean DEFAULT NULL::boolean, p_has_personal_email boolean DEFAULT NULL::boolean, p_has_business_email boolean DEFAULT NULL::boolean, p_has_phone boolean DEFAULT NULL::boolean, p_has_facebook boolean DEFAULT NULL::boolean, p_has_twitter boolean DEFAULT NULL::boolean, p_has_company_linkedin boolean DEFAULT NULL::boolean, p_has_company_phone boolean DEFAULT NULL::boolean, p_has_company_facebook boolean DEFAULT NULL::boolean, p_has_company_twitter boolean DEFAULT NULL::boolean, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(entity_data jsonb, entity_external_id text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total BIGINT;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE
    -- Entity type filter
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- KEYWORDS: Search across 20+ fields
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        coalesce(fd.entity_data->>'firstName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'fullName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'title', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'headline', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'company', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'organization', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'industry', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'summary', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'bio', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'city', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'state', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'country', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'location', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'skills', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'interests', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'technologies', '') ILIKE '%' || kw || '%'
    ))
    
    -- JOB TITLES: ILIKE matching
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
        OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    
    -- SENIORITY: Using title_matches_seniority helper function WITH seniority field
    AND (p_seniority_levels IS NULL OR 
      title_matches_seniority(
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
        p_seniority_levels,
        fd.entity_data->>'seniority'
      )
    )
    
    -- DEPARTMENTS: ILIKE matching with C-Suite normalization
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        coalesce(fd.entity_data->>'department', '') ILIKE '%' || dept || '%'
        OR (dept = 'C-Suite' AND (
          coalesce(fd.entity_data->>'title', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
          OR coalesce(fd.entity_data->>'jobTitle', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
        ))
    ))
    
    -- INDUSTRIES: ILIKE matching
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE coalesce(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
    ))
    
    -- TECHNOLOGIES: ILIKE matching (handles both array and string formats)
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE coalesce(fd.entity_data->>'technologies', '') ILIKE '%' || tech || '%'
    ))
    
    -- COMPANY SIZE: Range parsing
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE CASE size_range
        WHEN '1-10' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 1 AND 10
        WHEN '11-50' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 11 AND 50
        WHEN '51-200' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 51 AND 200
        WHEN '201-500' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 201 AND 500
        WHEN '501-1000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 5001 AND 10000
        WHEN '10000+' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) >= 10000
        ELSE FALSE
      END
    ))
    
    -- COMPANY REVENUE: Range parsing
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev_range
      WHERE CASE rev_range
        WHEN 'Under $1M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint < 1000000
        WHEN '$1M - $10M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 1000000 AND 10000000
        WHEN '$10M - $50M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 10000000 AND 50000000
        WHEN '$50M - $100M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 50000000 AND 100000000
        WHEN '$100M - $500M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 100000000 AND 500000000
        WHEN '$500M - $1B' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 500000000 AND 1000000000
        WHEN '$1B+' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint >= 1000000000
        ELSE FALSE
      END
    ))
    
    -- CITIES: ILIKE matching
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE 
        coalesce(fd.entity_data->>'city', '') ILIKE '%' || c || '%'
        OR coalesce(fd.entity_data->>'location', '') ILIKE '%' || c || '%'
        OR coalesce(fd.entity_data->>'personCity', '') ILIKE '%' || c || '%'
        OR coalesce(fd.entity_data->>'companyCity', '') ILIKE '%' || c || '%'
    ))
    
    -- COUNTRIES: ILIKE matching
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) co
      WHERE 
        coalesce(fd.entity_data->>'country', '') ILIKE '%' || co || '%'
        OR coalesce(fd.entity_data->>'personCountry', '') ILIKE '%' || co || '%'
        OR coalesce(fd.entity_data->>'companyCountry', '') ILIKE '%' || co || '%'
    ))
    
    -- GENDER: Exact match (case-insensitive)
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE lower(coalesce(fd.entity_data->>'gender', '')) = lower(g)
    ))
    
    -- NET WORTH: FIXED - Only match records WITH verified net worth data
    AND (p_net_worth IS NULL OR (
      fd.entity_data->>'netWorth' IS NOT NULL 
      AND fd.entity_data->>'netWorth' <> ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_net_worth) r
        WHERE CASE r
          WHEN 'Under $100K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) < 100
          WHEN '$100K - $500K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 100 AND 500
          WHEN '$500K - $1M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 500 AND 1000
          WHEN '$1M - $5M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 1000 AND 5000
          WHEN '$5M - $10M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 5000 AND 10000
          WHEN '$10M - $50M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 10000 AND 50000
          WHEN '$50M+' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= 50000
          ELSE FALSE
        END
      )
    ))
    
    -- INCOME: FIXED - Only match records WITH verified income data
    AND (p_income IS NULL OR (
      fd.entity_data->>'incomeRange' IS NOT NULL 
      AND fd.entity_data->>'incomeRange' <> ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_income) r
        WHERE CASE r
          WHEN 'Under $50K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) < 50
          WHEN '$50K - $100K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 50 AND 100
          WHEN '$100K - $200K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 100 AND 200
          WHEN '$200K - $500K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 200 AND 500
          WHEN '$500K - $1M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 500 AND 1000
          WHEN '$1M+' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= 1000
          ELSE FALSE
        END
      )
    ))
    
    -- PERSON INTERESTS: Handle both JSON array and comma-separated string formats
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) i
      WHERE coalesce(fd.entity_data->>'interests', '') ILIKE '%' || i || '%'
    ))
    
    -- PERSON SKILLS: Handle both JSON array and comma-separated string formats  
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) s
      WHERE coalesce(fd.entity_data->>'skills', '') ILIKE '%' || s || '%'
    ))
    
    -- HAS LINKEDIN: Check linkedin or linkedinUrl fields
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = TRUE AND (
      coalesce(fd.entity_data->>'linkedin', '') <> '' 
      OR coalesce(fd.entity_data->>'linkedinUrl', '') <> ''
    )))
    
    -- HAS PERSONAL EMAIL: Check personalEmail or email fields
    AND (p_has_personal_email IS NULL OR (p_has_personal_email = TRUE AND (
      coalesce(fd.entity_data->>'personalEmail', '') <> ''
      OR coalesce(fd.entity_data->>'email', '') <> ''
    )))
    
    -- HAS BUSINESS EMAIL: Check workEmail or businessEmail fields
    AND (p_has_business_email IS NULL OR (p_has_business_email = TRUE AND (
      coalesce(fd.entity_data->>'workEmail', '') <> ''
      OR coalesce(fd.entity_data->>'businessEmail', '') <> ''
    )))
    
    -- HAS PHONE: Check phone or mobilePhone fields
    AND (p_has_phone IS NULL OR (p_has_phone = TRUE AND (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobilePhone', '') <> ''
    )))
    
    -- HAS FACEBOOK
    AND (p_has_facebook IS NULL OR (p_has_facebook = TRUE AND 
      coalesce(fd.entity_data->>'facebook', '') <> ''
    ))
    
    -- HAS TWITTER
    AND (p_has_twitter IS NULL OR (p_has_twitter = TRUE AND (
      coalesce(fd.entity_data->>'twitter', '') <> ''
      OR coalesce(fd.entity_data->>'twitterUrl', '') <> ''
    )))
    
    -- HAS COMPANY LINKEDIN
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = TRUE AND 
      coalesce(fd.entity_data->>'companyLinkedin', '') <> ''
    ))
    
    -- HAS COMPANY PHONE
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = TRUE AND 
      coalesce(fd.entity_data->>'companyPhone', '') <> ''
    ))
    
    -- HAS COMPANY FACEBOOK
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = TRUE AND 
      coalesce(fd.entity_data->>'companyFacebook', '') <> ''
    ))
    
    -- HAS COMPANY TWITTER
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = TRUE AND 
      coalesce(fd.entity_data->>'companyTwitter', '') <> ''
    ));

  -- Return results with pagination
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    v_total
  FROM free_data fd
  WHERE
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        coalesce(fd.entity_data->>'firstName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'lastName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'fullName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'name', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'title', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'headline', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'company', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'companyName', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'organization', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'industry', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'summary', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'bio', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'description', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'city', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'state', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'country', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'location', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'skills', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'interests', '') ILIKE '%' || kw || '%'
        OR coalesce(fd.entity_data->>'technologies', '') ILIKE '%' || kw || '%'
    ))
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE 
        coalesce(fd.entity_data->>'title', '') ILIKE '%' || jt || '%'
        OR coalesce(fd.entity_data->>'jobTitle', '') ILIKE '%' || jt || '%'
    ))
    -- SENIORITY: Using title_matches_seniority helper function WITH seniority field
    AND (p_seniority_levels IS NULL OR 
      title_matches_seniority(
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
        p_seniority_levels,
        fd.entity_data->>'seniority'
      )
    )
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        coalesce(fd.entity_data->>'department', '') ILIKE '%' || dept || '%'
        OR (dept = 'C-Suite' AND (
          coalesce(fd.entity_data->>'title', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
          OR coalesce(fd.entity_data->>'jobTitle', '') ~* '^(C[A-Z]O|Chief|CEO|CFO|CTO|COO|CMO|CIO|CPO|CRO)'
        ))
    ))
    AND (p_industries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE coalesce(fd.entity_data->>'industry', '') ILIKE '%' || ind || '%'
    ))
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE coalesce(fd.entity_data->>'technologies', '') ILIKE '%' || tech || '%'
    ))
    AND (p_company_size_ranges IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) size_range
      WHERE CASE size_range
        WHEN '1-10' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 1 AND 10
        WHEN '11-50' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 11 AND 50
        WHEN '51-200' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 51 AND 200
        WHEN '201-500' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 201 AND 500
        WHEN '501-1000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) BETWEEN 5001 AND 10000
        WHEN '10000+' THEN parse_employee_count_upper(coalesce(fd.entity_data->>'employeeCount', fd.entity_data->>'employees', fd.entity_data->>'company_size', '0')) >= 10000
        ELSE FALSE
      END
    ))
    AND (p_company_revenue IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) rev_range
      WHERE CASE rev_range
        WHEN 'Under $1M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint < 1000000
        WHEN '$1M - $10M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 1000000 AND 10000000
        WHEN '$10M - $50M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 10000000 AND 50000000
        WHEN '$50M - $100M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 50000000 AND 100000000
        WHEN '$100M - $500M' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 100000000 AND 500000000
        WHEN '$500M - $1B' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint BETWEEN 500000000 AND 1000000000
        WHEN '$1B+' THEN 
          NULLIF(regexp_replace(coalesce(fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '0'), '[^0-9]', '', 'g'), '')::bigint >= 1000000000
        ELSE FALSE
      END
    ))
    AND (p_cities IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE 
        coalesce(fd.entity_data->>'city', '') ILIKE '%' || c || '%'
        OR coalesce(fd.entity_data->>'location', '') ILIKE '%' || c || '%'
        OR coalesce(fd.entity_data->>'personCity', '') ILIKE '%' || c || '%'
        OR coalesce(fd.entity_data->>'companyCity', '') ILIKE '%' || c || '%'
    ))
    AND (p_countries IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) co
      WHERE 
        coalesce(fd.entity_data->>'country', '') ILIKE '%' || co || '%'
        OR coalesce(fd.entity_data->>'personCountry', '') ILIKE '%' || co || '%'
        OR coalesce(fd.entity_data->>'companyCountry', '') ILIKE '%' || co || '%'
    ))
    AND (p_gender IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE lower(coalesce(fd.entity_data->>'gender', '')) = lower(g)
    ))
    -- NET WORTH: FIXED - Only match records WITH verified net worth data
    AND (p_net_worth IS NULL OR (
      fd.entity_data->>'netWorth' IS NOT NULL 
      AND fd.entity_data->>'netWorth' <> ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_net_worth) r
        WHERE CASE r
          WHEN 'Under $100K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) < 100
          WHEN '$100K - $500K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 100 AND 500
          WHEN '$500K - $1M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 500 AND 1000
          WHEN '$1M - $5M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 1000 AND 5000
          WHEN '$5M - $10M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 5000 AND 10000
          WHEN '$10M - $50M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 10000 AND 50000
          WHEN '$50M+' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'netWorth', ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= 50000
          ELSE FALSE
        END
      )
    ))
    -- INCOME: FIXED - Only match records WITH verified income data
    AND (p_income IS NULL OR (
      fd.entity_data->>'incomeRange' IS NOT NULL 
      AND fd.entity_data->>'incomeRange' <> ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_income) r
        WHERE CASE r
          WHEN 'Under $50K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) < 50
          WHEN '$50K - $100K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 50 AND 100
          WHEN '$100K - $200K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 100 AND 200
          WHEN '$200K - $500K' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 200 AND 500
          WHEN '$500K - $1M' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) BETWEEN 500 AND 1000
          WHEN '$1M+' THEN 
            COALESCE(NULLIF(regexp_replace(coalesce(fd.entity_data->>'incomeRange', ''), '[^0-9]', '', 'g'), '')::bigint, 0) >= 1000
          ELSE FALSE
        END
      )
    ))
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) i
      WHERE coalesce(fd.entity_data->>'interests', '') ILIKE '%' || i || '%'
    ))
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) s
      WHERE coalesce(fd.entity_data->>'skills', '') ILIKE '%' || s || '%'
    ))
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = TRUE AND (
      coalesce(fd.entity_data->>'linkedin', '') <> '' 
      OR coalesce(fd.entity_data->>'linkedinUrl', '') <> ''
    )))
    AND (p_has_personal_email IS NULL OR (p_has_personal_email = TRUE AND (
      coalesce(fd.entity_data->>'personalEmail', '') <> ''
      OR coalesce(fd.entity_data->>'email', '') <> ''
    )))
    AND (p_has_business_email IS NULL OR (p_has_business_email = TRUE AND (
      coalesce(fd.entity_data->>'workEmail', '') <> ''
      OR coalesce(fd.entity_data->>'businessEmail', '') <> ''
    )))
    AND (p_has_phone IS NULL OR (p_has_phone = TRUE AND (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobilePhone', '') <> ''
    )))
    AND (p_has_facebook IS NULL OR (p_has_facebook = TRUE AND 
      coalesce(fd.entity_data->>'facebook', '') <> ''
    ))
    AND (p_has_twitter IS NULL OR (p_has_twitter = TRUE AND (
      coalesce(fd.entity_data->>'twitter', '') <> ''
      OR coalesce(fd.entity_data->>'twitterUrl', '') <> ''
    )))
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = TRUE AND 
      coalesce(fd.entity_data->>'companyLinkedin', '') <> ''
    ))
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = TRUE AND 
      coalesce(fd.entity_data->>'companyPhone', '') <> ''
    ))
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = TRUE AND 
      coalesce(fd.entity_data->>'companyFacebook', '') <> ''
    ))
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = TRUE AND 
      coalesce(fd.entity_data->>'companyTwitter', '') <> ''
    ))
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;