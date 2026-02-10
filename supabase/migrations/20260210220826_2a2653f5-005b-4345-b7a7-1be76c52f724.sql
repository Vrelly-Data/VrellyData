
-- ============================================================
-- DNC (Do Not Include) Exclusion Parameters
-- Adds 8 exclusion parameters to search_free_data_builder
-- All default to NULL so existing behavior is unchanged
-- ============================================================

-- Step 1: Drop existing function (guarded pattern)
DROP FUNCTION IF EXISTS public.search_free_data_builder(
  entity_type, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer
);

-- Step 2: Recreate with 37 parameters (29 existing + 8 exclusion)
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type entity_type DEFAULT 'person',
  p_keywords text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_size_ranges text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  -- NEW: Exclusion parameters (all NULL by default)
  p_exclude_keywords text[] DEFAULT NULL,
  p_exclude_job_titles text[] DEFAULT NULL,
  p_exclude_industries text[] DEFAULT NULL,
  p_exclude_cities text[] DEFAULT NULL,
  p_exclude_countries text[] DEFAULT NULL,
  p_exclude_technologies text[] DEFAULT NULL,
  p_exclude_person_skills text[] DEFAULT NULL,
  p_exclude_person_interests text[] DEFAULT NULL
)
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM public.free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter (UNCHANGED)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    -- Industries filter (UNCHANGED)
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         LOWER(fd.entity_data->>'industry') = ANY(SELECT LOWER(unnest(p_industries))))
    -- Cities filter (UNCHANGED)
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'city', fd.entity_data->>'personCity', fd.entity_data->>'companyCity', '')) = ANY(SELECT LOWER(unnest(p_cities))))
    -- Countries filter (UNCHANGED)
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'country', fd.entity_data->>'personCountry', fd.entity_data->>'companyCountry', '')) = ANY(SELECT LOWER(unnest(p_countries))))
    -- Job titles filter (UNCHANGED)
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE LOWER(fd.entity_data->>'title') ILIKE '%' || LOWER(jt) || '%'
    ))
    -- SENIORITY FILTER (UNCHANGED)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE CASE LOWER(sl)
        WHEN 'c-level' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(c-level|c-suite|csuite|c level|c suite|cxo|chief|founder)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '^(ceo|cfo|cto|coo|cmo|cio|cpo|chief)'
        WHEN 'president' THEN
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'president'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* 'president'
        WHEN 'vp' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(vp|vice president|v\.p\.)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^vp|vice president)'
        WHEN 'head of' THEN
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'head'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '^head of'
        WHEN 'director' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'director'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* 'director'
        WHEN 'manager' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'manager'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* 'manager'
        WHEN 'senior' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'senior'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^sr\.|^senior)'
        WHEN 'individual contributor' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(staff|individual|contributor|ic)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^staff |individual contributor)'
        WHEN 'entry' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(entry|junior|associate|intern)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^junior|^associate|^intern|^entry)'
        ELSE 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%' || sl || '%'
      END
    ))
    -- DEPARTMENT FILTER (UNCHANGED)
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE CASE LOWER(dept)
        WHEN 'c-suite / leadership' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(c-suite|executive|leadership|founder|owner)'
        WHEN 'engineering' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(engineering|technical|development|software|it)'
        WHEN 'sales' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'sales'
        WHEN 'marketing' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'marketing'
        WHEN 'finance' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(finance|accounting)'
        WHEN 'hr' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(human resources|hr|people|talent)'
        WHEN 'operations' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'operations'
        WHEN 'legal' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'legal'
        WHEN 'it' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(it|information technology)'
        WHEN 'community and social services' THEN
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(community|social services|nonprofit|ngo)'
        WHEN 'customer success' THEN
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(customer success|customer service|support|client)'
        WHEN 'product' THEN
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(product|product management|pm)'
        ELSE 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ILIKE '%' || dept || '%'
      END
    ))
    -- COMPANY SIZE FILTER (UNCHANGED)
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE CASE csr
        WHEN '1-10' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1 AND 10
        WHEN '11-50' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 11 AND 50
        WHEN '51-200' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 51 AND 200
        WHEN '201-500' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 201 AND 500
        WHEN '501-1000' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 5001 AND 10000
        WHEN '10000+' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) > 10000
        ELSE false
      END
    ))
    -- Company revenue filter (UNCHANGED)
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE CASE LOWER(cr)
        WHEN 'under $1m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) > 0
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 1000000
        WHEN '$1m - $10m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 1000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 10000000
        WHEN '$10m - $50m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 10000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 50000000
        WHEN '$50m - $100m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 50000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 100000000
        WHEN '$100m - $500m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 100000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 500000000
        WHEN '$500m - $1b' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 500000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 1000000000
        WHEN '$1b+' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 1000000000
        ELSE false
      END
    ))
    -- Technologies filter (UNCHANGED)
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    -- Gender filter (UNCHANGED)
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         LOWER(fd.entity_data->>'gender') = ANY(SELECT LOWER(unnest(p_gender))))
    -- Income filter (UNCHANGED)
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR (
      fd.entity_data->>'incomeRange' IS NOT NULL 
      AND fd.entity_data->>'incomeRange' != ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_income) inc
        WHERE CASE LOWER(inc)
          WHEN 'under $50k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
          WHEN '$50k - $100k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 50 AND 100
          WHEN '$100k - $200k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 101 AND 200
          WHEN '$200k - $500k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 201 AND 500
          WHEN '$500k - $1m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 501 AND 1000
          WHEN '$1m+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) > 1000
          ELSE false
        END
      )
    ))
    -- Net worth filter (UNCHANGED)
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR (
      fd.entity_data->>'netWorth' IS NOT NULL 
      AND fd.entity_data->>'netWorth' != ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw
        WHERE CASE LOWER(nw)
          WHEN 'under $100k' THEN 
            COALESCE(
              CASE 
                WHEN fd.entity_data->>'netWorth' LIKE '-%' THEN 
                  -1 * NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
                ELSE 
                  NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
              END, 0) < 100
          WHEN '$100k - $500k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 100 AND 500
          WHEN '$500k - $1m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 501 AND 1000
          WHEN '$1m - $5m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 1001 AND 5000
          WHEN '$5m - $10m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 5001 AND 10000
          WHEN '$10m+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) > 10000
          ELSE false
        END
      )
    ))
    -- Person skills filter (UNCHANGED)
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) sk
      WHERE fd.entity_data->>'skills' ILIKE '%' || sk || '%'
    ))
    -- Person interests filter (UNCHANGED)
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
    -- Prospect data filters (ALL UNCHANGED)
    AND (p_has_email IS NULL OR p_has_email = false OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
    -- ============================================================
    -- NEW: EXCLUSION FILTERS (DNC)
    -- Each one negates the same logic as its include counterpart
    -- ============================================================
    -- Exclude keywords
    AND (p_exclude_keywords IS NULL OR array_length(p_exclude_keywords, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    -- Exclude job titles
    AND (p_exclude_job_titles IS NULL OR array_length(p_exclude_job_titles, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_job_titles) jt
      WHERE LOWER(fd.entity_data->>'title') ILIKE '%' || LOWER(jt) || '%'
    ))
    -- Exclude industries
    AND (p_exclude_industries IS NULL OR array_length(p_exclude_industries, 1) IS NULL OR 
         LOWER(fd.entity_data->>'industry') != ALL(SELECT LOWER(unnest(p_exclude_industries))))
    -- Exclude cities
    AND (p_exclude_cities IS NULL OR array_length(p_exclude_cities, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'city', fd.entity_data->>'personCity', fd.entity_data->>'companyCity', '')) != ALL(SELECT LOWER(unnest(p_exclude_cities))))
    -- Exclude countries
    AND (p_exclude_countries IS NULL OR array_length(p_exclude_countries, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'country', fd.entity_data->>'personCountry', fd.entity_data->>'companyCountry', '')) != ALL(SELECT LOWER(unnest(p_exclude_countries))))
    -- Exclude technologies
    AND (p_exclude_technologies IS NULL OR array_length(p_exclude_technologies, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    -- Exclude person skills
    AND (p_exclude_person_skills IS NULL OR array_length(p_exclude_person_skills, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_person_skills) sk
      WHERE fd.entity_data->>'skills' ILIKE '%' || sk || '%'
    ))
    -- Exclude person interests
    AND (p_exclude_person_interests IS NULL OR array_length(p_exclude_person_interests, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM public.free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter (UNCHANGED)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    -- Industries filter (UNCHANGED)
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         LOWER(fd.entity_data->>'industry') = ANY(SELECT LOWER(unnest(p_industries))))
    -- Cities filter (UNCHANGED)
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'city', fd.entity_data->>'personCity', fd.entity_data->>'companyCity', '')) = ANY(SELECT LOWER(unnest(p_cities))))
    -- Countries filter (UNCHANGED)
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'country', fd.entity_data->>'personCountry', fd.entity_data->>'companyCountry', '')) = ANY(SELECT LOWER(unnest(p_countries))))
    -- Job titles filter (UNCHANGED)
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE LOWER(fd.entity_data->>'title') ILIKE '%' || LOWER(jt) || '%'
    ))
    -- SENIORITY FILTER (UNCHANGED)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE CASE LOWER(sl)
        WHEN 'c-level' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(c-level|c-suite|csuite|c level|c suite|cxo|chief|founder)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '^(ceo|cfo|cto|coo|cmo|cio|cpo|chief)'
        WHEN 'president' THEN
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'president'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* 'president'
        WHEN 'vp' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(vp|vice president|v\.p\.)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^vp|vice president)'
        WHEN 'head of' THEN
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'head'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '^head of'
        WHEN 'director' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'director'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* 'director'
        WHEN 'manager' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'manager'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* 'manager'
        WHEN 'senior' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* 'senior'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^sr\.|^senior)'
        WHEN 'individual contributor' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(staff|individual|contributor|ic)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^staff |individual contributor)'
        WHEN 'entry' THEN 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ~* '(entry|junior|associate|intern)'
          OR LOWER(COALESCE(fd.entity_data->>'title', '')) ~* '(^junior|^associate|^intern|^entry)'
        ELSE 
          LOWER(COALESCE(fd.entity_data->>'seniority', '')) ILIKE '%' || sl || '%'
      END
    ))
    -- DEPARTMENT FILTER (UNCHANGED)
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE CASE LOWER(dept)
        WHEN 'c-suite / leadership' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(c-suite|executive|leadership|founder|owner)'
        WHEN 'engineering' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(engineering|technical|development|software|it)'
        WHEN 'sales' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'sales'
        WHEN 'marketing' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'marketing'
        WHEN 'finance' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(finance|accounting)'
        WHEN 'hr' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(human resources|hr|people|talent)'
        WHEN 'operations' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'operations'
        WHEN 'legal' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* 'legal'
        WHEN 'it' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(it|information technology)'
        WHEN 'community and social services' THEN
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(community|social services|nonprofit|ngo)'
        WHEN 'customer success' THEN
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(customer success|customer service|support|client)'
        WHEN 'product' THEN
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(product|product management|pm)'
        ELSE 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ILIKE '%' || dept || '%'
      END
    ))
    -- COMPANY SIZE FILTER (UNCHANGED)
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE CASE csr
        WHEN '1-10' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1 AND 10
        WHEN '11-50' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 11 AND 50
        WHEN '51-200' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 51 AND 200
        WHEN '201-500' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 201 AND 500
        WHEN '501-1000' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) BETWEEN 5001 AND 10000
        WHEN '10000+' THEN 
          COALESCE(public.parse_employee_count_upper(fd.entity_data->>'companySize'), 0) > 10000
        ELSE false
      END
    ))
    -- Company revenue filter (UNCHANGED)
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE CASE LOWER(cr)
        WHEN 'under $1m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) > 0
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 1000000
        WHEN '$1m - $10m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 1000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 10000000
        WHEN '$10m - $50m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 10000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 50000000
        WHEN '$50m - $100m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 50000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 100000000
        WHEN '$100m - $500m' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 100000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 500000000
        WHEN '$500m - $1b' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 500000000
          AND COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) < 1000000000
        WHEN '$1b+' THEN 
          COALESCE(public.parse_revenue_to_numeric(COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue')), 0) >= 1000000000
        ELSE false
      END
    ))
    -- Technologies filter (UNCHANGED)
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    -- Gender filter (UNCHANGED)
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         LOWER(fd.entity_data->>'gender') = ANY(SELECT LOWER(unnest(p_gender))))
    -- Income filter (UNCHANGED)
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR (
      fd.entity_data->>'incomeRange' IS NOT NULL 
      AND fd.entity_data->>'incomeRange' != ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_income) inc
        WHERE CASE LOWER(inc)
          WHEN 'under $50k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
          WHEN '$50k - $100k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 50 AND 100
          WHEN '$100k - $200k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 101 AND 200
          WHEN '$200k - $500k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 201 AND 500
          WHEN '$500k - $1m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 501 AND 1000
          WHEN '$1m+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) > 1000
          ELSE false
        END
      )
    ))
    -- Net worth filter (UNCHANGED)
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR (
      fd.entity_data->>'netWorth' IS NOT NULL 
      AND fd.entity_data->>'netWorth' != ''
      AND EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw
        WHERE CASE LOWER(nw)
          WHEN 'under $100k' THEN 
            COALESCE(
              CASE 
                WHEN fd.entity_data->>'netWorth' LIKE '-%' THEN 
                  -1 * NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
                ELSE 
                  NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
              END, 0) < 100
          WHEN '$100k - $500k' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 100 AND 500
          WHEN '$500k - $1m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 501 AND 1000
          WHEN '$1m - $5m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 1001 AND 5000
          WHEN '$5m - $10m' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 5001 AND 10000
          WHEN '$10m+' THEN 
            COALESCE(NULLIF(REGEXP_REPLACE(fd.entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int, 0) > 10000
          ELSE false
        END
      )
    ))
    -- Person skills filter (UNCHANGED)
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) sk
      WHERE fd.entity_data->>'skills' ILIKE '%' || sk || '%'
    ))
    -- Person interests filter (UNCHANGED)
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
    -- Prospect data filters (ALL UNCHANGED)
    AND (p_has_email IS NULL OR p_has_email = false OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
    -- ============================================================
    -- NEW: EXCLUSION FILTERS (DNC) - duplicated for RETURN QUERY
    -- ============================================================
    AND (p_exclude_keywords IS NULL OR array_length(p_exclude_keywords, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_keywords) kw
      WHERE 
        fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'companyName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
    ))
    AND (p_exclude_job_titles IS NULL OR array_length(p_exclude_job_titles, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_job_titles) jt
      WHERE LOWER(fd.entity_data->>'title') ILIKE '%' || LOWER(jt) || '%'
    ))
    AND (p_exclude_industries IS NULL OR array_length(p_exclude_industries, 1) IS NULL OR 
         LOWER(fd.entity_data->>'industry') != ALL(SELECT LOWER(unnest(p_exclude_industries))))
    AND (p_exclude_cities IS NULL OR array_length(p_exclude_cities, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'city', fd.entity_data->>'personCity', fd.entity_data->>'companyCity', '')) != ALL(SELECT LOWER(unnest(p_exclude_cities))))
    AND (p_exclude_countries IS NULL OR array_length(p_exclude_countries, 1) IS NULL OR 
         LOWER(COALESCE(fd.entity_data->>'country', fd.entity_data->>'personCountry', fd.entity_data->>'companyCountry', '')) != ALL(SELECT LOWER(unnest(p_exclude_countries))))
    AND (p_exclude_technologies IS NULL OR array_length(p_exclude_technologies, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_technologies) tech
      WHERE fd.entity_data->>'technologies' ILIKE '%' || tech || '%'
    ))
    AND (p_exclude_person_skills IS NULL OR array_length(p_exclude_person_skills, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_person_skills) sk
      WHERE fd.entity_data->>'skills' ILIKE '%' || sk || '%'
    ))
    AND (p_exclude_person_interests IS NULL OR array_length(p_exclude_person_interests, 1) IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p_exclude_person_interests) interest
      WHERE fd.entity_data->>'interests' ILIKE '%' || interest || '%'
    ))
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Step 3: Assert exactly 1 function with 37 parameters
DO $$
DECLARE
  func_count integer;
  param_count integer;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder';
  
  IF func_count != 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Expected 1 search_free_data_builder, found %', func_count;
  END IF;
  
  SELECT pronargs INTO param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder';
  
  IF param_count != 37 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Expected 37 parameters, found %', param_count;
  END IF;
  
  RAISE NOTICE '✅ DNC migration complete: 1 function, 37 parameters';
END $$;
