-- First drop the existing function
DROP FUNCTION IF EXISTS public.search_free_data_builder(text,text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],text[],boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer);

-- Fix Person Interests, Skills, Net Worth, and Income filters
-- Issues: 
-- 1. Interests/Skills expect JSON arrays but data is comma-separated strings
-- 2. Net Worth and Income have no filter logic implemented

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type TEXT DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_seniority_levels TEXT[] DEFAULT NULL,
  p_departments TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_technologies TEXT[] DEFAULT NULL,
  p_company_size_ranges TEXT[] DEFAULT NULL,
  p_company_revenue TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_gender TEXT[] DEFAULT NULL,
  p_net_worth TEXT[] DEFAULT NULL,
  p_income TEXT[] DEFAULT NULL,
  p_person_interests TEXT[] DEFAULT NULL,
  p_person_skills TEXT[] DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_personal_email BOOLEAN DEFAULT NULL,
  p_has_business_email BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_facebook BOOLEAN DEFAULT NULL,
  p_has_twitter BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  entity_data JSONB,
  entity_external_id TEXT,
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
    
    -- SENIORITY: Using title_matches_seniority helper function
    AND (p_seniority_levels IS NULL OR 
      title_matches_seniority(
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
        p_seniority_levels
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
    
    -- NET WORTH: Parse dollar amounts and match ranges (values like $150, $750 mean $150K, $750K)
    AND (p_net_worth IS NULL OR EXISTS (
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
    ))
    
    -- INCOME: Parse dollar amounts and match ranges (values like $100, $200 mean $100K, $200K)
    AND (p_income IS NULL OR EXISTS (
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
    AND (p_seniority_levels IS NULL OR 
      title_matches_seniority(
        coalesce(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
        p_seniority_levels
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
    AND (p_net_worth IS NULL OR EXISTS (
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
    ))
    AND (p_income IS NULL OR EXISTS (
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
$$;