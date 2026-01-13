-- ============================================
-- CLEANUP: Remove all duplicate search functions
-- Keep ONLY the canonical search_free_data_builder
-- ============================================

-- Remove the unused JSONB overload (source of confusion)
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, jsonb, integer, integer);

-- Remove legacy functions no longer used by the UI
DROP FUNCTION IF EXISTS public.search_free_data_keywords(entity_type, text[], integer, integer);
DROP FUNCTION IF EXISTS public.search_free_data_with_filters(entity_type, text[], text[], text[], text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, text[], text[], text[], text[], text[], text[], text[], integer, integer);
DROP FUNCTION IF EXISTS public.search_free_data_with_filters(text, text[], text[], text[], text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, integer, integer);

-- ============================================
-- FIX: Replace the canonical function with type cast fix
-- This is the ONLY search_free_data_builder function
-- ============================================

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
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
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_dept_expanded text[];
BEGIN
  -- Department equivalence mapping
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN
    v_dept_expanded := p_departments;
    IF 'Executive' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['C-Suite', 'C-Level', 'Chief']);
    END IF;
    IF 'Engineering' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Engineering & Technical', 'Technical', 'Technology']);
    END IF;
    IF 'IT' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Information Technology', 'Tech', 'Technology']);
    END IF;
    IF 'Sales' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Sales & Business Development', 'Business Development']);
    END IF;
    IF 'Marketing' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Marketing & Communications', 'Communications']);
    END IF;
    IF 'Finance' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Finance & Accounting', 'Accounting']);
    END IF;
    IF 'HR' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Human Resources', 'People Operations', 'People']);
    END IF;
    IF 'Operations' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Operations & Logistics', 'Logistics']);
    END IF;
    IF 'Legal' = ANY(p_departments) THEN
      v_dept_expanded := array_cat(v_dept_expanded, ARRAY['Legal & Compliance', 'Compliance']);
    END IF;
  ELSE
    v_dept_expanded := NULL;
  END IF;

  -- Get total count
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR 
         EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE fd.entity_data::text ILIKE '%' || kw || '%'))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%') OR
         fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR 
         fd.entity_data->>'seniority' ILIKE ANY(SELECT '%' || unnest(p_seniority_levels) || '%') OR
         fd.entity_data->>'seniorityLevel' ILIKE ANY(SELECT '%' || unnest(p_seniority_levels) || '%'))
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR 
         fd.entity_data->>'employeeCount' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'companySize' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'employees' = ANY(p_company_size_ranges))
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%') OR
         fd.entity_data->>'companyCountry' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%') OR
         fd.entity_data->>'companyCity' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR 
         fd.entity_data->>'netWorth' = ANY(p_net_worth))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR 
         fd.entity_data->>'income' = ANY(p_income))
    AND (v_dept_expanded IS NULL OR 
         fd.entity_data->>'department' ILIKE ANY(SELECT '%' || unnest(v_dept_expanded) || '%'))
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR 
         fd.entity_data->>'companyRevenue' = ANY(p_company_revenue) OR
         fd.entity_data->>'revenue' = ANY(p_company_revenue) OR
         fd.entity_data->>'annualRevenue' = ANY(p_company_revenue))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR 
         fd.entity_data->>'interests' ILIKE ANY(SELECT '%' || unnest(p_person_interests) || '%'))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR 
         fd.entity_data->>'skills' ILIKE ANY(SELECT '%' || unnest(p_person_skills) || '%'))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '') OR
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '') OR
         (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' <> ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '') OR
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> ''));

  -- Return paginated results with total count
  RETURN QUERY
  SELECT 
    fd.entity_external_id,
    fd.entity_data,
    v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR 
         EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE fd.entity_data::text ILIKE '%' || kw || '%'))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR 
         fd.entity_data->>'title' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%') OR
         fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR 
         fd.entity_data->>'seniority' ILIKE ANY(SELECT '%' || unnest(p_seniority_levels) || '%') OR
         fd.entity_data->>'seniorityLevel' ILIKE ANY(SELECT '%' || unnest(p_seniority_levels) || '%'))
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR 
         fd.entity_data->>'employeeCount' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'companySize' = ANY(p_company_size_ranges) OR
         fd.entity_data->>'employees' = ANY(p_company_size_ranges))
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR 
         fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR 
         fd.entity_data->>'country' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%') OR
         fd.entity_data->>'companyCountry' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR 
         fd.entity_data->>'city' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%') OR
         fd.entity_data->>'companyCity' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
         fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR 
         fd.entity_data->>'netWorth' = ANY(p_net_worth))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR 
         fd.entity_data->>'income' = ANY(p_income))
    AND (v_dept_expanded IS NULL OR 
         fd.entity_data->>'department' ILIKE ANY(SELECT '%' || unnest(v_dept_expanded) || '%'))
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR 
         fd.entity_data->>'companyRevenue' = ANY(p_company_revenue) OR
         fd.entity_data->>'revenue' = ANY(p_company_revenue) OR
         fd.entity_data->>'annualRevenue' = ANY(p_company_revenue))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR 
         fd.entity_data->>'interests' ILIKE ANY(SELECT '%' || unnest(p_person_interests) || '%'))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR 
         fd.entity_data->>'skills' ILIKE ANY(SELECT '%' || unnest(p_person_skills) || '%'))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = false OR 
         (fd.entity_data->>'personalEmail' IS NOT NULL AND fd.entity_data->>'personalEmail' <> ''))
    AND (p_has_business_email IS NULL OR p_has_business_email = false OR 
         (fd.entity_data->>'businessEmail' IS NOT NULL AND fd.entity_data->>'businessEmail' <> '') OR
         (fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' <> ''))
    AND (p_has_phone IS NULL OR p_has_phone = false OR 
         (fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' <> '') OR
         (fd.entity_data->>'mobilePhone' IS NOT NULL AND fd.entity_data->>'mobilePhone' <> ''))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = false OR 
         (fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' <> '') OR
         (fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' <> ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = false OR 
         (fd.entity_data->>'facebook' IS NOT NULL AND fd.entity_data->>'facebook' <> ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = false OR 
         (fd.entity_data->>'twitter' IS NOT NULL AND fd.entity_data->>'twitter' <> ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = false OR 
         (fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' <> ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = false OR 
         (fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' <> ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = false OR 
         (fd.entity_data->>'companyFacebook' IS NOT NULL AND fd.entity_data->>'companyFacebook' <> ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = false OR 
         (fd.entity_data->>'companyTwitter' IS NOT NULL AND fd.entity_data->>'companyTwitter' <> ''))
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Add comment to prevent future confusion
COMMENT ON FUNCTION public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer) IS 'CANONICAL Builder search function. DO NOT create overloads - use different function names if different behavior is needed.';