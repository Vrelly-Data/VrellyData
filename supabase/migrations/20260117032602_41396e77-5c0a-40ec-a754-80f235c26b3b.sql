-- v2.5 Migration: Fix 6 broken filters
-- Using EXACT parameter order from existing function OID 129485

-- Step 1: Drop the existing function with EXACT signature
DROP FUNCTION IF EXISTS public.search_free_data_builder(
  p_entity_type entity_type,
  p_keywords text[],
  p_industries text[],
  p_cities text[],
  p_countries text[],
  p_job_titles text[],
  p_seniority_levels text[],
  p_departments text[],
  p_company_size_ranges text[],
  p_company_revenue text[],
  p_technologies text[],
  p_gender text[],
  p_income text[],
  p_net_worth text[],
  p_person_skills text[],
  p_person_interests text[],
  p_has_email boolean,
  p_has_phone boolean,
  p_has_linkedin boolean,
  p_has_facebook boolean,
  p_has_twitter boolean,
  p_has_personal_email boolean,
  p_has_business_email boolean,
  p_has_company_phone boolean,
  p_has_company_linkedin boolean,
  p_has_company_facebook boolean,
  p_has_company_twitter boolean,
  p_limit integer,
  p_offset integer
);

-- Step 2: Create the corrected function with SAME parameter order + fixes
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type entity_type DEFAULT 'person'::entity_type,
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
  p_offset integer DEFAULT 0
)
RETURNS TABLE(entity_data jsonb, entity_external_id text, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        LOWER(COALESCE(fd.entity_data->>'firstName', '') || ' ' || COALESCE(fd.entity_data->>'lastName', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'jobTitle', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'company', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'companyName', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'industry', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'bio', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'summary', '')) LIKE '%' || LOWER(kw) || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE LOWER(COALESCE(fd.entity_data->>'industry', '')) LIKE '%' || LOWER(ind) || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE LOWER(COALESCE(fd.entity_data->>'city', fd.entity_data->>'location', '')) LIKE '%' || LOWER(c) || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ctry
      WHERE LOWER(COALESCE(fd.entity_data->>'country', fd.entity_data->>'location', '')) LIKE '%' || LOWER(ctry) || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE LOWER(COALESCE(fd.entity_data->>'jobTitle', '')) LIKE '%' || LOWER(jt) || '%'
    ))
    -- Seniority levels filter
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE public.title_matches_seniority(ARRAY[sl], fd.entity_data->>'seniority', COALESCE(fd.entity_data->>'jobTitle', ''))
    ))
    -- Departments filter with C-SUITE FIX
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE CASE LOWER(dept)
        WHEN 'c-suite' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(c-suite|executive|leadership|founder|owner)'
          OR LOWER(COALESCE(fd.entity_data->>'jobTitle', '')) ~* '(ceo|cto|cfo|coo|cmo|cio|chief|founder|owner|president)'
        WHEN 'engineering' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(engineering|developer|software|technical|it|technology)'
        WHEN 'sales' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(sales|business development|account)'
        WHEN 'marketing' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(marketing|growth|brand|content|digital)'
        WHEN 'operations' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(operations|ops|logistics|supply chain)'
        WHEN 'finance' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(finance|accounting|financial|treasury)'
        WHEN 'hr' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(hr|human resources|people|talent|recruiting)'
        WHEN 'legal' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(legal|compliance|regulatory)'
        WHEN 'product' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(product|ux|design)'
        WHEN 'customer success' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(customer success|support|client|service)'
        ELSE 
          LOWER(COALESCE(fd.entity_data->>'department', '')) LIKE '%' || LOWER(dept) || '%'
      END
    ))
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE CASE csr
        WHEN '1-10' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) <= 10
        WHEN '11-50' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 11 AND 50
        WHEN '51-200' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 51 AND 200
        WHEN '201-500' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 201 AND 500
        WHEN '501-1000' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 5001 AND 10000
        WHEN '10001+' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) > 10000
        ELSE false
      END
    ))
    -- Company revenue filter - FIX: add companyRevenue field
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE CASE cr
        WHEN '$0-$1M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[0-9]{1,6}$|\$?[0-9]+k|under.*1.*m|less.*1.*m|0.*-.*1.*m)'
        WHEN '$1M-$10M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[1-9]m|\$?[1-9],?[0-9]{6}|1.*-.*10.*m|1.*m.*10.*m)'
        WHEN '$10M-$50M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[1-4][0-9]m|\$?50m|10.*-.*50.*m|10.*m.*50.*m)'
        WHEN '$50M-$100M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[5-9][0-9]m|\$?100m|50.*-.*100.*m|50.*m.*100.*m)'
        WHEN '$100M-$500M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[1-4][0-9]{2}m|\$?500m|100.*-.*500.*m|100.*m.*500.*m)'
        WHEN '$500M+' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[5-9][0-9]{2}m|\$?[0-9]+b|billion|500.*m.*\+|over.*500.*m|above.*500.*m)'
        ELSE false
      END
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE LOWER(COALESCE(fd.entity_data->>'technologies', '')) LIKE '%' || LOWER(tech) || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE LOWER(COALESCE(fd.entity_data->>'gender', '')) = LOWER(g)
    ))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE CASE inc
        WHEN '$0-$25k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?0|\$?[1-9]k|\$?[1][0-9]k|\$?2[0-5]k|under.*25|less.*25|0.*-.*25)'
        WHEN '$25k-$50k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?2[5-9]k|\$?[3-4][0-9]k|\$?50k|25.*-.*50|25,?000.*50,?000)'
        WHEN '$50k-$75k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?5[0-9]k|\$?6[0-9]k|\$?7[0-5]k|50.*-.*75|50,?000.*75,?000)'
        WHEN '$75k-$100k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?7[5-9]k|\$?8[0-9]k|\$?9[0-9]k|\$?100k|75.*-.*100|75,?000.*100,?000)'
        WHEN '$100k-$150k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?1[0-4][0-9]k|\$?150k|100.*-.*150|100,?000.*150,?000)'
        WHEN '$150k+' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?1[5-9][0-9]k|\$?[2-9][0-9][0-9]k|\$?[0-9]+m|150.*\+|over.*150|above.*150|150,?000\+|200,?000|250,?000|300,?000)'
        ELSE false
      END
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE CASE nw
        WHEN 'Negative' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(negative|debt|\-\$|\$\-|less.*than.*0|under.*0)'
        WHEN '$0-$50k' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?0|\$?[1-4]?[0-9]k|\$?50k|0.*-.*50|under.*50)'
        WHEN '$50k-$100k' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?5[0-9]k|\$?6[0-9]k|\$?7[0-9]k|\$?8[0-9]k|\$?9[0-9]k|\$?100k|50.*-.*100|50,?000.*100,?000)'
        WHEN '$100k-$500k' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?[1-4][0-9][0-9]k|\$?500k|100.*-.*500|100,?000.*500,?000)'
        WHEN '$500k-$1M' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?[5-9][0-9][0-9]k|\$?1m|\$?1,?000k|500.*-.*1|500,?000.*1,?000,?000)'
        WHEN '$1M+' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?[1-9]m|\$?[0-9]+m|million|1,?000,?000|over.*1.*m|above.*1.*m)'
        ELSE false
      END
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) sk
      WHERE LOWER(COALESCE(fd.entity_data->>'skills', '')) LIKE '%' || LOWER(sk) || '%'
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) intr
      WHERE LOWER(COALESCE(fd.entity_data->>'interests', '')) LIKE '%' || LOWER(intr) || '%'
    ))
    -- Email filter
    AND (p_has_email IS NULL OR p_has_email = false OR (
      p_has_email = true AND (
        fd.entity_data->>'email' IS NOT NULL OR 
        fd.entity_data->>'personalEmail' IS NOT NULL OR 
        fd.entity_data->>'businessEmail' IS NOT NULL
      )
    ))
    -- Phone filter
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      p_has_phone = true AND (
        fd.entity_data->>'phone' IS NOT NULL OR 
        fd.entity_data->>'mobilePhone' IS NOT NULL
      )
    ))
    -- LinkedIn filter
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL
    ))
    -- Personal Facebook filter - FIX: check both facebookUrl and facebook
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      p_has_facebook = true AND 
      COALESCE(NULLIF(fd.entity_data->>'facebookUrl',''), NULLIF(fd.entity_data->>'facebook','')) IS NOT NULL
    ))
    -- Personal Twitter filter - FIX: check both twitterUrl and twitter
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      p_has_twitter = true AND 
      COALESCE(NULLIF(fd.entity_data->>'twitterUrl',''), NULLIF(fd.entity_data->>'twitter','')) IS NOT NULL
    ))
    -- Personal email filter
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      p_has_personal_email = true AND fd.entity_data->>'personalEmail' IS NOT NULL
    ))
    -- Business email filter
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      p_has_business_email = true AND fd.entity_data->>'businessEmail' IS NOT NULL
    ))
    -- Company phone filter
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL
    ))
    -- Company LinkedIn filter
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedinUrl' IS NOT NULL
    ))
    -- Company Facebook filter - FIX: check both companyFacebookUrl and companyFacebook
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      p_has_company_facebook = true AND 
      COALESCE(NULLIF(fd.entity_data->>'companyFacebookUrl',''), NULLIF(fd.entity_data->>'companyFacebook','')) IS NOT NULL
    ))
    -- Company Twitter filter - FIX: check both companyTwitterUrl and companyTwitter
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      p_has_company_twitter = true AND 
      COALESCE(NULLIF(fd.entity_data->>'companyTwitterUrl',''), NULLIF(fd.entity_data->>'companyTwitter','')) IS NOT NULL
    ));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.entity_data,
    fd.entity_external_id,
    v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keywords filter
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        LOWER(COALESCE(fd.entity_data->>'firstName', '') || ' ' || COALESCE(fd.entity_data->>'lastName', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'jobTitle', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'company', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'companyName', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'industry', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'bio', '')) LIKE '%' || LOWER(kw) || '%'
        OR LOWER(COALESCE(fd.entity_data->>'summary', '')) LIKE '%' || LOWER(kw) || '%'
    ))
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE LOWER(COALESCE(fd.entity_data->>'industry', '')) LIKE '%' || LOWER(ind) || '%'
    ))
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) c
      WHERE LOWER(COALESCE(fd.entity_data->>'city', fd.entity_data->>'location', '')) LIKE '%' || LOWER(c) || '%'
    ))
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ctry
      WHERE LOWER(COALESCE(fd.entity_data->>'country', fd.entity_data->>'location', '')) LIKE '%' || LOWER(ctry) || '%'
    ))
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE LOWER(COALESCE(fd.entity_data->>'jobTitle', '')) LIKE '%' || LOWER(jt) || '%'
    ))
    -- Seniority levels filter
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE public.title_matches_seniority(ARRAY[sl], fd.entity_data->>'seniority', COALESCE(fd.entity_data->>'jobTitle', ''))
    ))
    -- Departments filter with C-SUITE FIX
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE CASE LOWER(dept)
        WHEN 'c-suite' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(c-suite|executive|leadership|founder|owner)'
          OR LOWER(COALESCE(fd.entity_data->>'jobTitle', '')) ~* '(ceo|cto|cfo|coo|cmo|cio|chief|founder|owner|president)'
        WHEN 'engineering' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(engineering|developer|software|technical|it|technology)'
        WHEN 'sales' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(sales|business development|account)'
        WHEN 'marketing' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(marketing|growth|brand|content|digital)'
        WHEN 'operations' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(operations|ops|logistics|supply chain)'
        WHEN 'finance' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(finance|accounting|financial|treasury)'
        WHEN 'hr' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(hr|human resources|people|talent|recruiting)'
        WHEN 'legal' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(legal|compliance|regulatory)'
        WHEN 'product' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(product|ux|design)'
        WHEN 'customer success' THEN 
          LOWER(COALESCE(fd.entity_data->>'department', '')) ~* '(customer success|support|client|service)'
        ELSE 
          LOWER(COALESCE(fd.entity_data->>'department', '')) LIKE '%' || LOWER(dept) || '%'
      END
    ))
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) csr
      WHERE CASE csr
        WHEN '1-10' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) <= 10
        WHEN '11-50' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 11 AND 50
        WHEN '51-200' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 51 AND 200
        WHEN '201-500' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 201 AND 500
        WHEN '501-1000' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 501 AND 1000
        WHEN '1001-5000' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 1001 AND 5000
        WHEN '5001-10000' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) BETWEEN 5001 AND 10000
        WHEN '10001+' THEN public.parse_employee_count_upper(COALESCE(fd.entity_data->>'companySize', '')) > 10000
        ELSE false
      END
    ))
    -- Company revenue filter - FIX: add companyRevenue field
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE CASE cr
        WHEN '$0-$1M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[0-9]{1,6}$|\$?[0-9]+k|under.*1.*m|less.*1.*m|0.*-.*1.*m)'
        WHEN '$1M-$10M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[1-9]m|\$?[1-9],?[0-9]{6}|1.*-.*10.*m|1.*m.*10.*m)'
        WHEN '$10M-$50M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[1-4][0-9]m|\$?50m|10.*-.*50.*m|10.*m.*50.*m)'
        WHEN '$50M-$100M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[5-9][0-9]m|\$?100m|50.*-.*100.*m|50.*m.*100.*m)'
        WHEN '$100M-$500M' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[1-4][0-9]{2}m|\$?500m|100.*-.*500.*m|100.*m.*500.*m)'
        WHEN '$500M+' THEN 
          COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '') != '' AND
          (COALESCE(fd.entity_data->>'companyRevenue', fd.entity_data->>'revenue', fd.entity_data->>'annualRevenue', '')) ~* '(\$?[5-9][0-9]{2}m|\$?[0-9]+b|billion|500.*m.*\+|over.*500.*m|above.*500.*m)'
        ELSE false
      END
    ))
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) tech
      WHERE LOWER(COALESCE(fd.entity_data->>'technologies', '')) LIKE '%' || LOWER(tech) || '%'
    ))
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE LOWER(COALESCE(fd.entity_data->>'gender', '')) = LOWER(g)
    ))
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE CASE inc
        WHEN '$0-$25k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?0|\$?[1-9]k|\$?[1][0-9]k|\$?2[0-5]k|under.*25|less.*25|0.*-.*25)'
        WHEN '$25k-$50k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?2[5-9]k|\$?[3-4][0-9]k|\$?50k|25.*-.*50|25,?000.*50,?000)'
        WHEN '$50k-$75k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?5[0-9]k|\$?6[0-9]k|\$?7[0-5]k|50.*-.*75|50,?000.*75,?000)'
        WHEN '$75k-$100k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?7[5-9]k|\$?8[0-9]k|\$?9[0-9]k|\$?100k|75.*-.*100|75,?000.*100,?000)'
        WHEN '$100k-$150k' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?1[0-4][0-9]k|\$?150k|100.*-.*150|100,?000.*150,?000)'
        WHEN '$150k+' THEN 
          COALESCE(fd.entity_data->>'incomeRange', '') != '' AND
          (fd.entity_data->>'incomeRange') ~* '(\$?1[5-9][0-9]k|\$?[2-9][0-9][0-9]k|\$?[0-9]+m|150.*\+|over.*150|above.*150|150,?000\+|200,?000|250,?000|300,?000)'
        ELSE false
      END
    ))
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE CASE nw
        WHEN 'Negative' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(negative|debt|\-\$|\$\-|less.*than.*0|under.*0)'
        WHEN '$0-$50k' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?0|\$?[1-4]?[0-9]k|\$?50k|0.*-.*50|under.*50)'
        WHEN '$50k-$100k' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?5[0-9]k|\$?6[0-9]k|\$?7[0-9]k|\$?8[0-9]k|\$?9[0-9]k|\$?100k|50.*-.*100|50,?000.*100,?000)'
        WHEN '$100k-$500k' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?[1-4][0-9][0-9]k|\$?500k|100.*-.*500|100,?000.*500,?000)'
        WHEN '$500k-$1M' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?[5-9][0-9][0-9]k|\$?1m|\$?1,?000k|500.*-.*1|500,?000.*1,?000,?000)'
        WHEN '$1M+' THEN 
          COALESCE(fd.entity_data->>'netWorth', '') != '' AND
          (fd.entity_data->>'netWorth') ~* '(\$?[1-9]m|\$?[0-9]+m|million|1,?000,?000|over.*1.*m|above.*1.*m)'
        ELSE false
      END
    ))
    -- Skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) sk
      WHERE LOWER(COALESCE(fd.entity_data->>'skills', '')) LIKE '%' || LOWER(sk) || '%'
    ))
    -- Interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) intr
      WHERE LOWER(COALESCE(fd.entity_data->>'interests', '')) LIKE '%' || LOWER(intr) || '%'
    ))
    -- Email filter
    AND (p_has_email IS NULL OR p_has_email = false OR (
      p_has_email = true AND (
        fd.entity_data->>'email' IS NOT NULL OR 
        fd.entity_data->>'personalEmail' IS NOT NULL OR 
        fd.entity_data->>'businessEmail' IS NOT NULL
      )
    ))
    -- Phone filter
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      p_has_phone = true AND (
        fd.entity_data->>'phone' IS NOT NULL OR 
        fd.entity_data->>'mobilePhone' IS NOT NULL
      )
    ))
    -- LinkedIn filter
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL
    ))
    -- Personal Facebook filter - FIX: check both facebookUrl and facebook
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      p_has_facebook = true AND 
      COALESCE(NULLIF(fd.entity_data->>'facebookUrl',''), NULLIF(fd.entity_data->>'facebook','')) IS NOT NULL
    ))
    -- Personal Twitter filter - FIX: check both twitterUrl and twitter
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      p_has_twitter = true AND 
      COALESCE(NULLIF(fd.entity_data->>'twitterUrl',''), NULLIF(fd.entity_data->>'twitter','')) IS NOT NULL
    ))
    -- Personal email filter
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      p_has_personal_email = true AND fd.entity_data->>'personalEmail' IS NOT NULL
    ))
    -- Business email filter
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      p_has_business_email = true AND fd.entity_data->>'businessEmail' IS NOT NULL
    ))
    -- Company phone filter
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL
    ))
    -- Company LinkedIn filter
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedinUrl' IS NOT NULL
    ))
    -- Company Facebook filter - FIX: check both companyFacebookUrl and companyFacebook
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      p_has_company_facebook = true AND 
      COALESCE(NULLIF(fd.entity_data->>'companyFacebookUrl',''), NULLIF(fd.entity_data->>'companyFacebook','')) IS NOT NULL
    ))
    -- Company Twitter filter - FIX: check both companyTwitterUrl and companyTwitter
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      p_has_company_twitter = true AND 
      COALESCE(NULLIF(fd.entity_data->>'companyTwitterUrl',''), NULLIF(fd.entity_data->>'companyTwitter','')) IS NOT NULL
    ))
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Add version comment
COMMENT ON FUNCTION public.search_free_data_builder IS 'v2.5 - Fixed: companyRevenue field, c-suite department, social media field variants';