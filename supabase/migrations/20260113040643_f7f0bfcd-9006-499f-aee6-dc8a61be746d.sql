-- Update search_free_data_builder to fix seniority mapping and prospect data field names
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
  p_industries text[] DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_states text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_gender text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_company_size text DEFAULT NULL,
  p_revenue_ranges text[] DEFAULT NULL,
  p_has_business_email boolean DEFAULT NULL,
  p_has_personal_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_company_linkedin boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_company_facebook boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_company_twitter boolean DEFAULT NULL,
  p_keywords text[] DEFAULT NULL,
  p_income text[] DEFAULT NULL,
  p_net_worth text[] DEFAULT NULL,
  p_person_interests text[] DEFAULT NULL,
  p_person_skills text[] DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_min_employees integer;
  v_max_employees integer;
  v_departments_expanded text[];
  v_seniority_expanded text[];
BEGIN
  -- Parse company size range
  IF p_company_size IS NOT NULL AND p_company_size <> '' THEN
    IF p_company_size = '10000+' THEN
      v_min_employees := 10000;
      v_max_employees := 999999999;
    ELSE
      v_min_employees := split_part(p_company_size, '-', 1)::integer;
      v_max_employees := split_part(p_company_size, '-', 2)::integer;
    END IF;
  END IF;

  -- Department equivalence mapping
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN
    v_departments_expanded := p_departments;
    IF 'Engineering' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Engineering & Technical', 'Information Technology', 'IT', 'Technology', 'Software', 'Development', 'Tech']);
    END IF;
    IF 'Sales' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Business Development', 'Revenue', 'Commercial']);
    END IF;
    IF 'Marketing' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Growth', 'Digital Marketing', 'Brand', 'Communications']);
    END IF;
    IF 'Finance' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Accounting', 'Financial', 'Treasury', 'FP&A']);
    END IF;
    IF 'Human Resources' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['HR', 'People', 'People Operations', 'Talent', 'Recruiting']);
    END IF;
    IF 'Operations' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Ops', 'Business Operations', 'Strategy & Operations']);
    END IF;
    IF 'Legal' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Legal & Compliance', 'Compliance', 'General Counsel']);
    END IF;
    IF 'Customer Success' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Customer Service', 'Support', 'Client Success', 'Customer Experience']);
    END IF;
    IF 'Product' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Product Management', 'Product Development']);
    END IF;
    IF 'Design' = ANY(p_departments) THEN
      v_departments_expanded := array_cat(v_departments_expanded, ARRAY['Creative', 'UX', 'UI', 'User Experience']);
    END IF;
  ELSE
    v_departments_expanded := NULL;
  END IF;

  -- Seniority equivalence mapping
  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) > 0 THEN
    v_seniority_expanded := p_seniority_levels;
    IF 'C-Level' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['C suite', 'C-Suite', 'CXO', 'Chief', 'CEO', 'CFO', 'CTO', 'COO', 'CMO', 'CIO', 'CISO', 'CPO', 'CRO']);
    END IF;
    IF 'VP' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Vice President', 'SVP', 'EVP', 'Senior Vice President', 'Executive Vice President']);
    END IF;
    IF 'Director' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Senior Director', 'Managing Director', 'Executive Director', 'Associate Director']);
    END IF;
    IF 'Manager' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Senior Manager', 'Team Lead', 'Team Leader', 'Group Manager']);
    END IF;
    IF 'Senior' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Sr.', 'Sr', 'Lead', 'Principal', 'Staff']);
    END IF;
    IF 'Entry' = ANY(p_seniority_levels) THEN
      v_seniority_expanded := array_cat(v_seniority_expanded, ARRAY['Junior', 'Jr.', 'Jr', 'Associate', 'Intern', 'Trainee']);
    END IF;
  ELSE
    v_seniority_expanded := NULL;
  END IF;

  -- Get total count
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
    AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
         fd.entity_data->>'state' ILIKE ANY(SELECT '%' || unnest(p_states) || '%'))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
    AND (v_seniority_expanded IS NULL OR array_length(v_seniority_expanded, 1) IS NULL OR 
         fd.entity_data->>'seniority' ILIKE ANY(SELECT '%' || unnest(v_seniority_expanded) || '%'))
    AND (v_departments_expanded IS NULL OR array_length(v_departments_expanded, 1) IS NULL OR 
         fd.entity_data->>'department' ILIKE ANY(SELECT '%' || unnest(v_departments_expanded) || '%'))
    AND (p_company_size IS NULL OR p_company_size = '' OR (
         COALESCE(NULLIF(regexp_replace(fd.entity_data->>'employees', '[^0-9]', '', 'g'), ''), '0')::integer >= v_min_employees
         AND COALESCE(NULLIF(regexp_replace(fd.entity_data->>'employees', '[^0-9]', '', 'g'), ''), '0')::integer <= v_max_employees
    ))
    AND (p_revenue_ranges IS NULL OR array_length(p_revenue_ranges, 1) IS NULL OR 
         fd.entity_data->>'annualRevenue' ILIKE ANY(SELECT '%' || unnest(p_revenue_ranges) || '%') OR
         fd.entity_data->>'revenue' ILIKE ANY(SELECT '%' || unnest(p_revenue_ranges) || '%'))
    -- Prospect data filters
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> '' AND fd.entity_data->>'email' NOT LIKE '%gmail%' AND fd.entity_data->>'email' NOT LIKE '%yahoo%' AND fd.entity_data->>'email' NOT LIKE '%hotmail%'))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '') OR
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '') OR
         (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> '') OR
         (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> '') OR
         (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> '') OR
         (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> '') OR
         (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> ''))
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR 
         fd.entity_data::text ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%'))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR 
         fd.entity_data->>'income' = ANY(p_income))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR 
         fd.entity_data->>'netWorth' = ANY(p_net_worth))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR 
         fd.entity_data->>'interests' ILIKE ANY(SELECT '%' || unnest(p_person_interests) || '%'))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR 
         fd.entity_data->>'skills' ILIKE ANY(SELECT '%' || unnest(p_person_skills) || '%'));

  -- Return results with total count
  RETURN QUERY
  SELECT fd.entity_external_id, fd.entity_data, v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
    AND (p_states IS NULL OR array_length(p_states, 1) IS NULL OR 
         fd.entity_data->>'state' ILIKE ANY(SELECT '%' || unnest(p_states) || '%'))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
    AND (v_seniority_expanded IS NULL OR array_length(v_seniority_expanded, 1) IS NULL OR 
         fd.entity_data->>'seniority' ILIKE ANY(SELECT '%' || unnest(v_seniority_expanded) || '%'))
    AND (v_departments_expanded IS NULL OR array_length(v_departments_expanded, 1) IS NULL OR 
         fd.entity_data->>'department' ILIKE ANY(SELECT '%' || unnest(v_departments_expanded) || '%'))
    AND (p_company_size IS NULL OR p_company_size = '' OR (
         COALESCE(NULLIF(regexp_replace(fd.entity_data->>'employees', '[^0-9]', '', 'g'), ''), '0')::integer >= v_min_employees
         AND COALESCE(NULLIF(regexp_replace(fd.entity_data->>'employees', '[^0-9]', '', 'g'), ''), '0')::integer <= v_max_employees
    ))
    AND (p_revenue_ranges IS NULL OR array_length(p_revenue_ranges, 1) IS NULL OR 
         fd.entity_data->>'annualRevenue' ILIKE ANY(SELECT '%' || unnest(p_revenue_ranges) || '%') OR
         fd.entity_data->>'revenue' ILIKE ANY(SELECT '%' || unnest(p_revenue_ranges) || '%'))
    -- Prospect data filters
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> '' AND fd.entity_data->>'email' NOT LIKE '%gmail%' AND fd.entity_data->>'email' NOT LIKE '%yahoo%' AND fd.entity_data->>'email' NOT LIKE '%hotmail%'))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '') OR
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> '') OR
         (fd.entity_data->>'companyLinkedinUrl' IS NOT NULL AND fd.entity_data->>'companyLinkedinUrl' <> ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> '') OR
         (fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' <> ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> '') OR
         (fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' <> ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> '') OR
         (fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' <> ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> '') OR
         (fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' <> ''))
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR 
         fd.entity_data::text ILIKE ANY(SELECT '%' || unnest(p_keywords) || '%'))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR 
         fd.entity_data->>'income' = ANY(p_income))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR 
         fd.entity_data->>'netWorth' = ANY(p_net_worth))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR 
         fd.entity_data->>'interests' ILIKE ANY(SELECT '%' || unnest(p_person_interests) || '%'))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR 
         fd.entity_data->>'skills' ILIKE ANY(SELECT '%' || unnest(p_person_skills) || '%'))
  ORDER BY fd.entity_external_id
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;