-- Drop the existing function completely
DROP FUNCTION IF EXISTS public.search_free_data_builder;

-- Recreate with the EXACT same signature but fixed internal logic
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT NULL,
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
  v_total bigint;
BEGIN
  -- Count total matching records
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE
    -- Entity type filter
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type)
    
    -- Keywords filter (search in full_name, job_title, company_name)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'full_name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'job_title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company_name' ILIKE '%' || kw || '%'
    ))
    
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'job_title' ILIKE '%' || jt || '%'
    ))
    
    -- FIXED: Seniority filter with comprehensive pattern matching
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE 
        CASE lower(trim(sl))
          WHEN 'c-level' THEN 
            lower(fd.entity_data->>'seniority') ~ '(c suite|c-suite|chief|ceo|cfo|cto|coo|cmo|cpo|cro|cio)'
            OR lower(fd.entity_data->>'job_title') ~ '(^c[a-z]o$|^c[a-z]o |chief)'
          WHEN 'vp' THEN 
            lower(fd.entity_data->>'seniority') ~ '(^vp$|vice president|v\.p\.)'
            OR lower(fd.entity_data->>'job_title') ~ '(^vp |vice president)'
          WHEN 'director' THEN 
            lower(fd.entity_data->>'seniority') ~ 'director'
            OR lower(fd.entity_data->>'job_title') ~ 'director'
          WHEN 'manager' THEN 
            lower(fd.entity_data->>'seniority') ~ 'manager'
            OR lower(fd.entity_data->>'job_title') ~ 'manager'
          WHEN 'senior' THEN 
            lower(fd.entity_data->>'seniority') ~ '(senior|sr\.?)'
            OR lower(fd.entity_data->>'job_title') ~ '(senior|^sr\.? )'
          WHEN 'entry level' THEN 
            lower(fd.entity_data->>'seniority') ~ '(entry|junior|associate|jr\.?)'
            OR lower(fd.entity_data->>'job_title') ~ '(entry|junior|associate|^jr\.? )'
          WHEN 'intern' THEN 
            lower(fd.entity_data->>'seniority') ~ 'intern'
            OR lower(fd.entity_data->>'job_title') ~ 'intern'
          WHEN 'founder' THEN 
            lower(fd.entity_data->>'seniority') ~ '(founder|owner|co-founder|cofounder)'
            OR lower(fd.entity_data->>'job_title') ~ '(founder|owner|co-founder|cofounder)'
          WHEN 'president' THEN 
            (lower(fd.entity_data->>'seniority') ~ 'president' AND lower(fd.entity_data->>'seniority') !~ 'vice')
            OR (lower(fd.entity_data->>'job_title') ~ 'president' AND lower(fd.entity_data->>'job_title') !~ 'vice')
          WHEN 'head' THEN 
            lower(fd.entity_data->>'seniority') ~ '(head of|head,)'
            OR lower(fd.entity_data->>'job_title') ~ '(^head of|^head )'
          ELSE 
            lower(fd.entity_data->>'seniority') ILIKE '%' || sl || '%'
        END
    ))
    
    -- FIXED: Departments filter with comprehensive pattern matching
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        CASE lower(trim(dept))
          WHEN 'executive' THEN 
            lower(fd.entity_data->>'department') ~ '(c-suite|executive|leadership|management)'
          WHEN 'engineering' THEN 
            lower(fd.entity_data->>'department') ~ '(engineering|technical|development|software|technology|r&d|research)'
          WHEN 'sales' THEN 
            lower(fd.entity_data->>'department') ~ '(sales|business development|revenue|account)'
          WHEN 'marketing' THEN 
            lower(fd.entity_data->>'department') ~ '(marketing|growth|brand|communications|content)'
          WHEN 'product' THEN 
            lower(fd.entity_data->>'department') ~ '(product|ux|ui|design)'
          WHEN 'finance' THEN 
            lower(fd.entity_data->>'department') ~ '(finance|accounting|fiscal|treasury)'
          WHEN 'hr' THEN 
            lower(fd.entity_data->>'department') ~ '(hr|human resources|people|talent|recruiting)'
          WHEN 'human resources' THEN 
            lower(fd.entity_data->>'department') ~ '(hr|human resources|people|talent|recruiting)'
          WHEN 'operations' THEN 
            lower(fd.entity_data->>'department') ~ '(operations|ops|supply chain|logistics)'
          WHEN 'legal' THEN 
            lower(fd.entity_data->>'department') ~ '(legal|compliance|regulatory)'
          WHEN 'it' THEN 
            lower(fd.entity_data->>'department') ~ '(^it$|^it |information technology|infrastructure|systems)'
          WHEN 'customer success' THEN 
            lower(fd.entity_data->>'department') ~ '(customer success|cs|client success)'
          WHEN 'support' THEN 
            lower(fd.entity_data->>'department') ~ '(support|customer service|helpdesk)'
          ELSE 
            lower(fd.entity_data->>'department') ILIKE '%' || dept || '%'
        END
    ))
    
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) cs
      WHERE 
        CASE cs
          WHEN '1-10' THEN (fd.entity_data->>'employee_count')::int BETWEEN 1 AND 10
          WHEN '11-50' THEN (fd.entity_data->>'employee_count')::int BETWEEN 11 AND 50
          WHEN '51-200' THEN (fd.entity_data->>'employee_count')::int BETWEEN 51 AND 200
          WHEN '201-500' THEN (fd.entity_data->>'employee_count')::int BETWEEN 201 AND 500
          WHEN '501-1000' THEN (fd.entity_data->>'employee_count')::int BETWEEN 501 AND 1000
          WHEN '1001-5000' THEN (fd.entity_data->>'employee_count')::int BETWEEN 1001 AND 5000
          WHEN '5001-10000' THEN (fd.entity_data->>'employee_count')::int BETWEEN 5001 AND 10000
          WHEN '10001+' THEN (fd.entity_data->>'employee_count')::int > 10000
          ELSE false
        END
    ))
    
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ctry
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || ctry || '%'
        OR fd.entity_data->>'person_country' ILIKE '%' || ctry || '%'
        OR fd.entity_data->>'company_country' ILIKE '%' || ctry || '%'
    ))
    
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) cty
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'person_city' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'company_city' ILIKE '%' || cty || '%'
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE 
        upper(fd.entity_data->>'gender') = upper(g)
        OR (upper(g) = 'M' AND lower(fd.entity_data->>'gender') IN ('m', 'male'))
        OR (upper(g) = 'F' AND lower(fd.entity_data->>'gender') IN ('f', 'female'))
    ))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'net_worth' ILIKE '%' || nw || '%'
    ))
    
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE fd.entity_data->>'company_revenue' ILIKE '%' || cr || '%'
    ))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
    
    -- FIXED: Prospect data filters with multiple key checks
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      coalesce(fd.entity_data->>'personal_email', '') <> ''
    ))
    
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      coalesce(fd.entity_data->>'business_email', '') <> ''
      OR coalesce(fd.entity_data->>'work_email', '') <> ''
      OR coalesce(fd.entity_data->>'email', '') <> ''
    ))
    
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'direct_phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobile_phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobile', '') <> ''
    ))
    
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      coalesce(fd.entity_data->>'linkedin', '') <> ''
      OR coalesce(fd.entity_data->>'linkedin_url', '') <> ''
      OR coalesce(fd.entity_data->>'personal_linkedin', '') <> ''
    ))
    
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      coalesce(fd.entity_data->>'facebook', '') <> ''
      OR coalesce(fd.entity_data->>'facebook_url', '') <> ''
      OR coalesce(fd.entity_data->>'personal_facebook', '') <> ''
    ))
    
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      coalesce(fd.entity_data->>'twitter', '') <> ''
      OR coalesce(fd.entity_data->>'twitter_url', '') <> ''
      OR coalesce(fd.entity_data->>'personal_twitter', '') <> ''
    ))
    
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      coalesce(fd.entity_data->>'company_phone', '') <> ''
    ))
    
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      coalesce(fd.entity_data->>'company_linkedin', '') <> ''
      OR coalesce(fd.entity_data->>'company_linkedin_url', '') <> ''
    ))
    
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      coalesce(fd.entity_data->>'company_facebook', '') <> ''
      OR coalesce(fd.entity_data->>'company_facebook_url', '') <> ''
    ))
    
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      coalesce(fd.entity_data->>'company_twitter', '') <> ''
      OR coalesce(fd.entity_data->>'company_twitter_url', '') <> ''
    ));

  -- Return matching records with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id::text,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE
    -- Entity type filter
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type)
    
    -- Keywords filter
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) kw
      WHERE 
        fd.entity_data->>'full_name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'job_title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company_name' ILIKE '%' || kw || '%'
    ))
    
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE fd.entity_data->>'job_title' ILIKE '%' || jt || '%'
    ))
    
    -- FIXED: Seniority filter
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) sl
      WHERE 
        CASE lower(trim(sl))
          WHEN 'c-level' THEN 
            lower(fd.entity_data->>'seniority') ~ '(c suite|c-suite|chief|ceo|cfo|cto|coo|cmo|cpo|cro|cio)'
            OR lower(fd.entity_data->>'job_title') ~ '(^c[a-z]o$|^c[a-z]o |chief)'
          WHEN 'vp' THEN 
            lower(fd.entity_data->>'seniority') ~ '(^vp$|vice president|v\.p\.)'
            OR lower(fd.entity_data->>'job_title') ~ '(^vp |vice president)'
          WHEN 'director' THEN 
            lower(fd.entity_data->>'seniority') ~ 'director'
            OR lower(fd.entity_data->>'job_title') ~ 'director'
          WHEN 'manager' THEN 
            lower(fd.entity_data->>'seniority') ~ 'manager'
            OR lower(fd.entity_data->>'job_title') ~ 'manager'
          WHEN 'senior' THEN 
            lower(fd.entity_data->>'seniority') ~ '(senior|sr\.?)'
            OR lower(fd.entity_data->>'job_title') ~ '(senior|^sr\.? )'
          WHEN 'entry level' THEN 
            lower(fd.entity_data->>'seniority') ~ '(entry|junior|associate|jr\.?)'
            OR lower(fd.entity_data->>'job_title') ~ '(entry|junior|associate|^jr\.? )'
          WHEN 'intern' THEN 
            lower(fd.entity_data->>'seniority') ~ 'intern'
            OR lower(fd.entity_data->>'job_title') ~ 'intern'
          WHEN 'founder' THEN 
            lower(fd.entity_data->>'seniority') ~ '(founder|owner|co-founder|cofounder)'
            OR lower(fd.entity_data->>'job_title') ~ '(founder|owner|co-founder|cofounder)'
          WHEN 'president' THEN 
            (lower(fd.entity_data->>'seniority') ~ 'president' AND lower(fd.entity_data->>'seniority') !~ 'vice')
            OR (lower(fd.entity_data->>'job_title') ~ 'president' AND lower(fd.entity_data->>'job_title') !~ 'vice')
          WHEN 'head' THEN 
            lower(fd.entity_data->>'seniority') ~ '(head of|head,)'
            OR lower(fd.entity_data->>'job_title') ~ '(^head of|^head )'
          ELSE 
            lower(fd.entity_data->>'seniority') ILIKE '%' || sl || '%'
        END
    ))
    
    -- FIXED: Departments filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) dept
      WHERE 
        CASE lower(trim(dept))
          WHEN 'executive' THEN 
            lower(fd.entity_data->>'department') ~ '(c-suite|executive|leadership|management)'
          WHEN 'engineering' THEN 
            lower(fd.entity_data->>'department') ~ '(engineering|technical|development|software|technology|r&d|research)'
          WHEN 'sales' THEN 
            lower(fd.entity_data->>'department') ~ '(sales|business development|revenue|account)'
          WHEN 'marketing' THEN 
            lower(fd.entity_data->>'department') ~ '(marketing|growth|brand|communications|content)'
          WHEN 'product' THEN 
            lower(fd.entity_data->>'department') ~ '(product|ux|ui|design)'
          WHEN 'finance' THEN 
            lower(fd.entity_data->>'department') ~ '(finance|accounting|fiscal|treasury)'
          WHEN 'hr' THEN 
            lower(fd.entity_data->>'department') ~ '(hr|human resources|people|talent|recruiting)'
          WHEN 'human resources' THEN 
            lower(fd.entity_data->>'department') ~ '(hr|human resources|people|talent|recruiting)'
          WHEN 'operations' THEN 
            lower(fd.entity_data->>'department') ~ '(operations|ops|supply chain|logistics)'
          WHEN 'legal' THEN 
            lower(fd.entity_data->>'department') ~ '(legal|compliance|regulatory)'
          WHEN 'it' THEN 
            lower(fd.entity_data->>'department') ~ '(^it$|^it |information technology|infrastructure|systems)'
          WHEN 'customer success' THEN 
            lower(fd.entity_data->>'department') ~ '(customer success|cs|client success)'
          WHEN 'support' THEN 
            lower(fd.entity_data->>'department') ~ '(support|customer service|helpdesk)'
          ELSE 
            lower(fd.entity_data->>'department') ILIKE '%' || dept || '%'
        END
    ))
    
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_size_ranges) cs
      WHERE 
        CASE cs
          WHEN '1-10' THEN (fd.entity_data->>'employee_count')::int BETWEEN 1 AND 10
          WHEN '11-50' THEN (fd.entity_data->>'employee_count')::int BETWEEN 11 AND 50
          WHEN '51-200' THEN (fd.entity_data->>'employee_count')::int BETWEEN 51 AND 200
          WHEN '201-500' THEN (fd.entity_data->>'employee_count')::int BETWEEN 201 AND 500
          WHEN '501-1000' THEN (fd.entity_data->>'employee_count')::int BETWEEN 501 AND 1000
          WHEN '1001-5000' THEN (fd.entity_data->>'employee_count')::int BETWEEN 1001 AND 5000
          WHEN '5001-10000' THEN (fd.entity_data->>'employee_count')::int BETWEEN 5001 AND 10000
          WHEN '10001+' THEN (fd.entity_data->>'employee_count')::int > 10000
          ELSE false
        END
    ))
    
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_industries) ind
      WHERE fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_countries) ctry
      WHERE 
        fd.entity_data->>'country' ILIKE '%' || ctry || '%'
        OR fd.entity_data->>'person_country' ILIKE '%' || ctry || '%'
        OR fd.entity_data->>'company_country' ILIKE '%' || ctry || '%'
    ))
    
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_cities) cty
      WHERE 
        fd.entity_data->>'city' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'person_city' ILIKE '%' || cty || '%'
        OR fd.entity_data->>'company_city' ILIKE '%' || cty || '%'
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_gender) g
      WHERE 
        upper(fd.entity_data->>'gender') = upper(g)
        OR (upper(g) = 'M' AND lower(fd.entity_data->>'gender') IN ('m', 'male'))
        OR (upper(g) = 'F' AND lower(fd.entity_data->>'gender') IN ('f', 'female'))
    ))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_net_worth) nw
      WHERE fd.entity_data->>'net_worth' ILIKE '%' || nw || '%'
    ))
    
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_income) inc
      WHERE fd.entity_data->>'income' ILIKE '%' || inc || '%'
    ))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_revenue) cr
      WHERE fd.entity_data->>'company_revenue' ILIKE '%' || cr || '%'
    ))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_interests) pi
      WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_person_skills) ps
      WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
    ))
    
    -- FIXED: Prospect data filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR (
      coalesce(fd.entity_data->>'personal_email', '') <> ''
    ))
    
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR (
      coalesce(fd.entity_data->>'business_email', '') <> ''
      OR coalesce(fd.entity_data->>'work_email', '') <> ''
      OR coalesce(fd.entity_data->>'email', '') <> ''
    ))
    
    AND (p_has_phone IS NULL OR p_has_phone = false OR (
      coalesce(fd.entity_data->>'phone', '') <> ''
      OR coalesce(fd.entity_data->>'direct_phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobile_phone', '') <> ''
      OR coalesce(fd.entity_data->>'mobile', '') <> ''
    ))
    
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR (
      coalesce(fd.entity_data->>'linkedin', '') <> ''
      OR coalesce(fd.entity_data->>'linkedin_url', '') <> ''
      OR coalesce(fd.entity_data->>'personal_linkedin', '') <> ''
    ))
    
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR (
      coalesce(fd.entity_data->>'facebook', '') <> ''
      OR coalesce(fd.entity_data->>'facebook_url', '') <> ''
      OR coalesce(fd.entity_data->>'personal_facebook', '') <> ''
    ))
    
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR (
      coalesce(fd.entity_data->>'twitter', '') <> ''
      OR coalesce(fd.entity_data->>'twitter_url', '') <> ''
      OR coalesce(fd.entity_data->>'personal_twitter', '') <> ''
    ))
    
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR (
      coalesce(fd.entity_data->>'company_phone', '') <> ''
    ))
    
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR (
      coalesce(fd.entity_data->>'company_linkedin', '') <> ''
      OR coalesce(fd.entity_data->>'company_linkedin_url', '') <> ''
    ))
    
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR (
      coalesce(fd.entity_data->>'company_facebook', '') <> ''
      OR coalesce(fd.entity_data->>'company_facebook_url', '') <> ''
    ))
    
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR (
      coalesce(fd.entity_data->>'company_twitter', '') <> ''
      OR coalesce(fd.entity_data->>'company_twitter_url', '') <> ''
    ))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';