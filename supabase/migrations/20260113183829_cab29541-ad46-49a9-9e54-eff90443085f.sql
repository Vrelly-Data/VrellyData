-- Drop the 27-parameter function (the one the frontend actually uses)
DROP FUNCTION IF EXISTS public.search_free_data_builder(
  text, text[], text[], text[], text[], text[], text[], text[], 
  text[], text[], text[], text[], text[], text[], text[],
  boolean, boolean, boolean, boolean, boolean, boolean, 
  boolean, boolean, boolean, boolean, integer, integer
);

-- Drop the 19-parameter function (unused, causes confusion)
DROP FUNCTION IF EXISTS public.search_free_data_builder(
  text, text[], text[], text[], text[], text[], text[], text[],
  text[], text[], text[], text[], text[], boolean, boolean,
  boolean, boolean, integer, integer
);

-- Recreate the 27-parameter function with ALL fixes
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
  v_total_count bigint;
BEGIN
  -- Count total matching records
  SELECT COUNT(*) INTO v_total_count
  FROM free_data fd
  WHERE
    -- Entity type filter (FIXED: added ::entity_type cast)
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- Keywords search (FIXED: correct camelCase field names + keywords array)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) AS kw
      WHERE 
        fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(fd.entity_data->'keywords') = 'array' 
            THEN fd.entity_data->'keywords' ELSE '[]'::jsonb END
          ) AS k WHERE k ILIKE '%' || kw || '%'
        )
    ))
    
    -- Job titles filter (FIXED: correct camelCase field names)
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) AS jt
      WHERE 
        fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority levels filter (pattern matching on jobTitle field)
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) AS sl
      WHERE 
        CASE sl
          WHEN 'C-Level' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(CEO|CFO|COO|CTO|CMO|CIO|CISO|CPO|CRO|Chief)(\s|$)'
          WHEN 'VP' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(VP|Vice President|V\.P\.)(\s|$)'
          WHEN 'Director' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Director|Dir\.)(\s|$)'
          WHEN 'Manager' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Manager|Mgr\.)(\s|$)'
          WHEN 'Senior' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Senior|Sr\.|Lead|Principal)(\s|$)'
          WHEN 'Entry' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Junior|Jr\.|Associate|Assistant|Entry|Intern)(\s|$)'
          ELSE 
            fd.entity_data->>'jobTitle' ILIKE '%' || sl || '%'
        END
    ))
    
    -- Departments filter (pattern matching on jobTitle field)
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) AS dept
      WHERE 
        CASE dept
          WHEN 'Sales' THEN 
            fd.entity_data->>'jobTitle' ~* '(Sales|Account Executive|Business Development|BDR|SDR|Revenue)'
          WHEN 'Marketing' THEN 
            fd.entity_data->>'jobTitle' ~* '(Marketing|Brand|Growth|Content|Digital|SEO|SEM|Communications)'
          WHEN 'Engineering' THEN 
            fd.entity_data->>'jobTitle' ~* '(Engineer|Developer|Software|DevOps|SRE|Architect|Programming)'
          WHEN 'Product' THEN 
            fd.entity_data->>'jobTitle' ~* '(Product Manager|Product Owner|PM|Product Lead|Product Director)'
          WHEN 'Design' THEN 
            fd.entity_data->>'jobTitle' ~* '(Design|UX|UI|Creative|Art Director|Graphic)'
          WHEN 'Finance' THEN 
            fd.entity_data->>'jobTitle' ~* '(Finance|Financial|Accounting|Controller|Treasury|FP&A)'
          WHEN 'HR' THEN 
            fd.entity_data->>'jobTitle' ~* '(HR|Human Resources|People|Talent|Recruiting|Recruiter)'
          WHEN 'Operations' THEN 
            fd.entity_data->>'jobTitle' ~* '(Operations|Ops|Supply Chain|Logistics|Procurement)'
          WHEN 'Legal' THEN 
            fd.entity_data->>'jobTitle' ~* '(Legal|Counsel|Attorney|Lawyer|Compliance|Paralegal)'
          WHEN 'IT' THEN 
            fd.entity_data->>'jobTitle' ~* '(IT|Information Technology|Systems|Network|Infrastructure|Support)'
          WHEN 'Customer Success' THEN 
            fd.entity_data->>'jobTitle' ~* '(Customer Success|CSM|Client Success|Account Manager|Customer Experience)'
          WHEN 'Support' THEN 
            fd.entity_data->>'jobTitle' ~* '(Support|Help Desk|Technical Support|Customer Service)'
          ELSE 
            fd.entity_data->>'jobTitle' ILIKE '%' || dept || '%'
        END
    ))
    
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges))
    
    -- Industries filter
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    
    -- Countries filter
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries))
    
    -- Cities filter
    AND (p_cities IS NULL OR fd.entity_data->>'city' ILIKE ANY(
      SELECT '%' || c || '%' FROM unnest(p_cities) AS c
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    
    -- Income filter
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR fd.entity_data->>'revenue' = ANY(p_company_revenue))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(fd.entity_data->'interests') = 'array' 
        THEN fd.entity_data->'interests' ELSE '[]'::jsonb END
      ) AS interest
      WHERE interest = ANY(p_person_interests)
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(fd.entity_data->'skills') = 'array' 
        THEN fd.entity_data->'skills' ELSE '[]'::jsonb END
      ) AS skill
      WHERE skill = ANY(p_person_skills)
    ))
    
    -- Prospect data availability filters (correct camelCase fields)
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''));

  -- Return matching records with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total_count AS total_count
  FROM free_data fd
  WHERE
    -- Entity type filter (FIXED: added ::entity_type cast)
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    
    -- Keywords search (FIXED: correct camelCase field names + keywords array)
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) AS kw
      WHERE 
        fd.entity_data->>'name' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'firstName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'lastName' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'title' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'company' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'industry' ILIKE '%' || kw || '%'
        OR fd.entity_data->>'technologies' ILIKE '%' || kw || '%'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(fd.entity_data->'keywords') = 'array' 
            THEN fd.entity_data->'keywords' ELSE '[]'::jsonb END
          ) AS k WHERE k ILIKE '%' || kw || '%'
        )
    ))
    
    -- Job titles filter (FIXED: correct camelCase field names)
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) AS jt
      WHERE 
        fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
        OR fd.entity_data->>'title' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority levels filter (pattern matching on jobTitle field)
    AND (p_seniority_levels IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_seniority_levels) AS sl
      WHERE 
        CASE sl
          WHEN 'C-Level' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(CEO|CFO|COO|CTO|CMO|CIO|CISO|CPO|CRO|Chief)(\s|$)'
          WHEN 'VP' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(VP|Vice President|V\.P\.)(\s|$)'
          WHEN 'Director' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Director|Dir\.)(\s|$)'
          WHEN 'Manager' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Manager|Mgr\.)(\s|$)'
          WHEN 'Senior' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Senior|Sr\.|Lead|Principal)(\s|$)'
          WHEN 'Entry' THEN 
            fd.entity_data->>'jobTitle' ~* '(^|\s)(Junior|Jr\.|Associate|Assistant|Entry|Intern)(\s|$)'
          ELSE 
            fd.entity_data->>'jobTitle' ILIKE '%' || sl || '%'
        END
    ))
    
    -- Departments filter (pattern matching on jobTitle field)
    AND (p_departments IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_departments) AS dept
      WHERE 
        CASE dept
          WHEN 'Sales' THEN 
            fd.entity_data->>'jobTitle' ~* '(Sales|Account Executive|Business Development|BDR|SDR|Revenue)'
          WHEN 'Marketing' THEN 
            fd.entity_data->>'jobTitle' ~* '(Marketing|Brand|Growth|Content|Digital|SEO|SEM|Communications)'
          WHEN 'Engineering' THEN 
            fd.entity_data->>'jobTitle' ~* '(Engineer|Developer|Software|DevOps|SRE|Architect|Programming)'
          WHEN 'Product' THEN 
            fd.entity_data->>'jobTitle' ~* '(Product Manager|Product Owner|PM|Product Lead|Product Director)'
          WHEN 'Design' THEN 
            fd.entity_data->>'jobTitle' ~* '(Design|UX|UI|Creative|Art Director|Graphic)'
          WHEN 'Finance' THEN 
            fd.entity_data->>'jobTitle' ~* '(Finance|Financial|Accounting|Controller|Treasury|FP&A)'
          WHEN 'HR' THEN 
            fd.entity_data->>'jobTitle' ~* '(HR|Human Resources|People|Talent|Recruiting|Recruiter)'
          WHEN 'Operations' THEN 
            fd.entity_data->>'jobTitle' ~* '(Operations|Ops|Supply Chain|Logistics|Procurement)'
          WHEN 'Legal' THEN 
            fd.entity_data->>'jobTitle' ~* '(Legal|Counsel|Attorney|Lawyer|Compliance|Paralegal)'
          WHEN 'IT' THEN 
            fd.entity_data->>'jobTitle' ~* '(IT|Information Technology|Systems|Network|Infrastructure|Support)'
          WHEN 'Customer Success' THEN 
            fd.entity_data->>'jobTitle' ~* '(Customer Success|CSM|Client Success|Account Manager|Customer Experience)'
          WHEN 'Support' THEN 
            fd.entity_data->>'jobTitle' ~* '(Support|Help Desk|Technical Support|Customer Service)'
          ELSE 
            fd.entity_data->>'jobTitle' ILIKE '%' || dept || '%'
        END
    ))
    
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges))
    
    -- Industries filter
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    
    -- Countries filter
    AND (p_countries IS NULL OR fd.entity_data->>'country' = ANY(p_countries))
    
    -- Cities filter
    AND (p_cities IS NULL OR fd.entity_data->>'city' ILIKE ANY(
      SELECT '%' || c || '%' FROM unnest(p_cities) AS c
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR fd.entity_data->>'gender' = ANY(p_gender))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR fd.entity_data->>'netWorth' = ANY(p_net_worth))
    
    -- Income filter
    AND (p_income IS NULL OR fd.entity_data->>'income' = ANY(p_income))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR fd.entity_data->>'revenue' = ANY(p_company_revenue))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(fd.entity_data->'interests') = 'array' 
        THEN fd.entity_data->'interests' ELSE '[]'::jsonb END
      ) AS interest
      WHERE interest = ANY(p_person_interests)
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(fd.entity_data->'skills') = 'array' 
        THEN fd.entity_data->'skills' ELSE '[]'::jsonb END
      ) AS skill
      WHERE skill = ANY(p_person_skills)
    ))
    
    -- Prospect data availability filters (correct camelCase fields)
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;