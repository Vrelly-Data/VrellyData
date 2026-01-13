-- Drop both existing overloads of search_free_data_builder
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text, text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text[], text[], text[], text[], text[], integer, integer);

DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer);

-- Create ONE canonical search_free_data_builder function with ALL fixes
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT 'person',
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
  p_has_twitter boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  entity_external_id text,
  entity_data jsonb,
  total_estimate bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_seniority_expanded text[];
  v_departments_expanded text[];
BEGIN
  -- Expand seniority levels to include common variations
  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) > 0 THEN
    v_seniority_expanded := p_seniority_levels;
    
    -- C-Level variations
    IF 'C-Level' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['C suite', 'C-Suite', 'CXO', 'Chief', 'CEO', 'CFO', 'COO', 'CTO', 'CMO', 'CIO', 'CHRO', 'CPO', 'CCO', 'CSO', 'CDO']);
    END IF;
    
    -- VP variations
    IF 'VP' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Vice President', 'SVP', 'EVP', 'Senior Vice President', 'Executive Vice President', 'AVP', 'Assistant Vice President']);
    END IF;
    
    -- Director variations
    IF 'Director' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Senior Director', 'Managing Director', 'Executive Director', 'Associate Director', 'Regional Director', 'Global Director']);
    END IF;
    
    -- Manager variations
    IF 'Manager' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Senior Manager', 'Team Lead', 'Team Leader', 'Group Manager', 'Department Manager', 'General Manager', 'Assistant Manager', 'Associate Manager']);
    END IF;
    
    -- Senior variations
    IF 'Senior' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Sr.', 'Sr', 'Lead', 'Principal', 'Staff']);
    END IF;
    
    -- Entry variations
    IF 'Entry' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Junior', 'Jr.', 'Jr', 'Associate', 'Trainee', 'Intern', 'Graduate', 'Entry Level', 'Entry-Level']);
    END IF;
  ELSE
    v_seniority_expanded := NULL;
  END IF;

  -- Expand departments to include variations
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN
    v_departments_expanded := p_departments;
    
    IF 'Engineering' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Engineering & Technical', 'Technical', 'Technology', 'Software', 'IT', 'Information Technology', 'R&D', 'Research & Development', 'Product Development']);
    END IF;
    
    IF 'Sales' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Sales & Marketing', 'Business Development', 'Account Management', 'Revenue', 'Commercial']);
    END IF;
    
    IF 'Marketing' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Sales & Marketing', 'Growth', 'Brand', 'Communications', 'Digital Marketing', 'Content']);
    END IF;
    
    IF 'Finance' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Finance & Accounting', 'Accounting', 'Financial', 'Treasury', 'FP&A', 'Financial Planning']);
    END IF;
    
    IF 'Human Resources' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['HR', 'People', 'People Operations', 'Talent', 'Talent Acquisition', 'Recruiting', 'People & Culture']);
    END IF;
    
    IF 'Operations' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Ops', 'Business Operations', 'Strategy & Operations', 'Supply Chain', 'Logistics', 'Procurement']);
    END IF;
    
    IF 'Legal' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Legal & Compliance', 'Compliance', 'Regulatory', 'General Counsel', 'Corporate Legal']);
    END IF;
    
    IF 'Customer Success' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Customer Service', 'Customer Support', 'Client Success', 'Client Services', 'Support', 'Customer Experience', 'CX']);
    END IF;
    
    IF 'Product' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Product Management', 'Product Development', 'Product Design', 'UX', 'User Experience', 'Design']);
    END IF;
    
    IF 'Data' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Data Science', 'Data Engineering', 'Analytics', 'Business Intelligence', 'BI', 'Data & Analytics']);
    END IF;
  ELSE
    v_departments_expanded := NULL;
  END IF;

  -- Get total count estimate
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keyword search
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_keywords) k 
           WHERE fd.entity_data::text ILIKE '%' || k || '%'
         ))
    -- Job titles
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_job_titles) jt 
           WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
              OR fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
         ))
    -- Seniority levels with expanded variations
    AND (v_seniority_expanded IS NULL OR array_length(v_seniority_expanded, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(v_seniority_expanded) sl 
           WHERE fd.entity_data->>'seniority' ILIKE '%' || sl || '%'
              OR fd.entity_data->>'seniorityLevel' ILIKE '%' || sl || '%'
              OR fd.entity_data->>'title' ILIKE '%' || sl || '%'
              OR fd.entity_data->>'jobTitle' ILIKE '%' || sl || '%'
         ))
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR 
         fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'companySize' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'employeeCount' = ANY(p_company_size_ranges))
    -- Industries
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' = ANY(p_industries) OR
         fd.entity_data->>'companyIndustry' = ANY(p_industries))
    -- Countries
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' = ANY(p_countries) OR
         fd.entity_data->>'location_country' = ANY(p_countries) OR
         fd.entity_data->>'companyCountry' = ANY(p_countries))
    -- Cities
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' = ANY(p_cities) OR
         fd.entity_data->>'location_city' = ANY(p_cities) OR
         fd.entity_data->>'companyCity' = ANY(p_cities))
    -- Gender
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    -- Net worth
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR 
         fd.entity_data->>'netWorth' = ANY(p_net_worth) OR
         fd.entity_data->>'netWorthRange' = ANY(p_net_worth))
    -- Income
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR 
         fd.entity_data->>'income' = ANY(p_income) OR
         fd.entity_data->>'incomeRange' = ANY(p_income))
    -- Departments with expanded variations
    AND (v_departments_expanded IS NULL OR array_length(v_departments_expanded, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(v_departments_expanded) d 
           WHERE fd.entity_data->>'department' ILIKE '%' || d || '%'
              OR fd.entity_data->>'jobDepartment' ILIKE '%' || d || '%'
              OR fd.entity_data->>'title' ILIKE '%' || d || '%'
         ))
    -- Company revenue - numeric range parsing
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR 
         (
           -- Check if companyRevenue is a valid number
           fd.entity_data->>'companyRevenue' ~ '^[0-9]+(\.[0-9]+)?$'
           AND (
             ('Under $1M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric < 1000000) OR
             ('$1M - $10M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric >= 1000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 10000000) OR
             ('$10M - $50M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 10000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 50000000) OR
             ('$50M - $100M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 50000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 100000000) OR
             ('$100M - $500M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 100000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 500000000) OR
             ('$500M - $1B' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 500000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 1000000000) OR
             ('$1B+' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 1000000000)
           )
         ))
    -- Person interests
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_person_interests) pi 
           WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
              OR fd.entity_data->>'personInterests' ILIKE '%' || pi || '%'
         ))
    -- Person skills
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_person_skills) ps 
           WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
              OR fd.entity_data->>'personSkills' ILIKE '%' || ps || '%'
         ))
    -- Prospect data availability filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '') OR
         (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
         (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
         (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != '') OR
         (fd.entity_data->>'personalPhone' IS NOT NULL AND fd.entity_data->>'personalPhone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '') OR
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '') OR
         (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '') OR
         (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != '') OR
         (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' != '') OR
         (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' != '') OR
         (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''));

  -- Return results with total
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    -- Keyword search
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_keywords) k 
           WHERE fd.entity_data::text ILIKE '%' || k || '%'
         ))
    -- Job titles
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_job_titles) jt 
           WHERE fd.entity_data->>'title' ILIKE '%' || jt || '%'
              OR fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
         ))
    -- Seniority levels with expanded variations
    AND (v_seniority_expanded IS NULL OR array_length(v_seniority_expanded, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(v_seniority_expanded) sl 
           WHERE fd.entity_data->>'seniority' ILIKE '%' || sl || '%'
              OR fd.entity_data->>'seniorityLevel' ILIKE '%' || sl || '%'
              OR fd.entity_data->>'title' ILIKE '%' || sl || '%'
              OR fd.entity_data->>'jobTitle' ILIKE '%' || sl || '%'
         ))
    -- Company size ranges
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR 
         fd.entity_data->>'employeeCountRange' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'companySize' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'employeeCount' = ANY(p_company_size_ranges))
    -- Industries
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' = ANY(p_industries) OR
         fd.entity_data->>'companyIndustry' = ANY(p_industries))
    -- Countries
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' = ANY(p_countries) OR
         fd.entity_data->>'location_country' = ANY(p_countries) OR
         fd.entity_data->>'companyCountry' = ANY(p_countries))
    -- Cities
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' = ANY(p_cities) OR
         fd.entity_data->>'location_city' = ANY(p_cities) OR
         fd.entity_data->>'companyCity' = ANY(p_cities))
    -- Gender
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    -- Net worth
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR 
         fd.entity_data->>'netWorth' = ANY(p_net_worth) OR
         fd.entity_data->>'netWorthRange' = ANY(p_net_worth))
    -- Income
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR 
         fd.entity_data->>'income' = ANY(p_income) OR
         fd.entity_data->>'incomeRange' = ANY(p_income))
    -- Departments with expanded variations
    AND (v_departments_expanded IS NULL OR array_length(v_departments_expanded, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(v_departments_expanded) d 
           WHERE fd.entity_data->>'department' ILIKE '%' || d || '%'
              OR fd.entity_data->>'jobDepartment' ILIKE '%' || d || '%'
              OR fd.entity_data->>'title' ILIKE '%' || d || '%'
         ))
    -- Company revenue - numeric range parsing
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR 
         (
           fd.entity_data->>'companyRevenue' ~ '^[0-9]+(\.[0-9]+)?$'
           AND (
             ('Under $1M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric < 1000000) OR
             ('$1M - $10M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric >= 1000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 10000000) OR
             ('$10M - $50M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 10000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 50000000) OR
             ('$50M - $100M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 50000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 100000000) OR
             ('$100M - $500M' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 100000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 500000000) OR
             ('$500M - $1B' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 500000000 AND (fd.entity_data->>'companyRevenue')::numeric <= 1000000000) OR
             ('$1B+' = ANY(p_company_revenue) AND (fd.entity_data->>'companyRevenue')::numeric > 1000000000)
           )
         ))
    -- Person interests
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_person_interests) pi 
           WHERE fd.entity_data->>'interests' ILIKE '%' || pi || '%'
              OR fd.entity_data->>'personInterests' ILIKE '%' || pi || '%'
         ))
    -- Person skills
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR 
         EXISTS (
           SELECT 1 FROM unnest(p_person_skills) ps 
           WHERE fd.entity_data->>'skills' ILIKE '%' || ps || '%'
              OR fd.entity_data->>'personSkills' ILIKE '%' || ps || '%'
         ))
    -- Prospect data availability filters
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' != ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != '') OR
         (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' != '') OR
         (fd.entity_data->>'workEmail' IS NOT NULL AND fd.entity_data->>'workEmail' != ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != '') OR
         (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' != '') OR
         (fd.entity_data->>'personalPhone' IS NOT NULL AND fd.entity_data->>'personalPhone' != ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != '') OR
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != '') OR
         (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != '') OR
         (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != '') OR
         (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' != '') OR
         (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' != '') OR
         (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
  ORDER BY fd.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;