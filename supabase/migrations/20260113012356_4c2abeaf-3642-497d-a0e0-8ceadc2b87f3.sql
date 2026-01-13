-- Fix: Change p_entity_type from TEXT back to entity_type ENUM
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters(
  p_entity_type entity_type,
  p_keywords TEXT[] DEFAULT NULL,
  p_job_titles TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_company_sizes TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_cities TEXT[] DEFAULT NULL,
  p_company_names TEXT[] DEFAULT NULL,
  p_seniority_levels TEXT[] DEFAULT NULL,
  p_departments TEXT[] DEFAULT NULL,
  p_revenue_ranges TEXT[] DEFAULT NULL,
  p_founding_years TEXT[] DEFAULT NULL,
  p_has_email BOOLEAN DEFAULT NULL,
  p_has_phone BOOLEAN DEFAULT NULL,
  p_has_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_phone BOOLEAN DEFAULT NULL,
  p_has_company_linkedin BOOLEAN DEFAULT NULL,
  p_has_company_facebook BOOLEAN DEFAULT NULL,
  p_has_company_twitter BOOLEAN DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_per_page INTEGER DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset INTEGER;
  v_total_estimate BIGINT;
  v_results JSON;
BEGIN
  v_offset := (p_page - 1) * p_per_page;

  -- Get total estimate
  SELECT COUNT(*) INTO v_total_estimate
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_keywords IS NULL OR p_keywords = '{}' OR 
         EXISTS (SELECT 1 FROM unnest(p_keywords) k WHERE fd.entity_data::text ILIKE '%' || k || '%'))
    AND (p_job_titles IS NULL OR p_job_titles = '{}' OR 
         fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
    AND (p_industries IS NULL OR p_industries = '{}' OR 
         fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
    AND (p_company_sizes IS NULL OR p_company_sizes = '{}' OR 
         fd.entity_data->>'companySize' = ANY(p_company_sizes))
    AND (p_countries IS NULL OR p_countries = '{}' OR 
         fd.entity_data->>'country' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
    AND (p_cities IS NULL OR p_cities = '{}' OR 
         fd.entity_data->>'city' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
    AND (p_company_names IS NULL OR p_company_names = '{}' OR 
         fd.entity_data->>'companyName' ILIKE ANY(SELECT '%' || unnest(p_company_names) || '%'))
    AND (p_seniority_levels IS NULL OR p_seniority_levels = '{}' OR 
         fd.entity_data->>'seniorityLevel' ILIKE ANY(SELECT '%' || unnest(p_seniority_levels) || '%'))
    AND (p_departments IS NULL OR p_departments = '{}' OR 
         fd.entity_data->>'department' ILIKE ANY(SELECT '%' || unnest(p_departments) || '%'))
    AND (p_revenue_ranges IS NULL OR p_revenue_ranges = '{}' OR 
         fd.entity_data->>'revenueRange' = ANY(p_revenue_ranges))
    AND (p_founding_years IS NULL OR p_founding_years = '{}' OR 
         fd.entity_data->>'foundingYear' = ANY(p_founding_years))
    AND (p_has_email IS NULL OR (p_has_email = true AND fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))
    AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = true AND fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
    AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = true AND fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''));

  -- Get paginated results
  SELECT json_agg(row_to_json(t))
  INTO v_results
  FROM (
    SELECT fd.id, fd.entity_type, fd.entity_data, fd.created_at
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type
      AND (p_keywords IS NULL OR p_keywords = '{}' OR 
           EXISTS (SELECT 1 FROM unnest(p_keywords) k WHERE fd.entity_data::text ILIKE '%' || k || '%'))
      AND (p_job_titles IS NULL OR p_job_titles = '{}' OR 
           fd.entity_data->>'jobTitle' ILIKE ANY(SELECT '%' || unnest(p_job_titles) || '%'))
      AND (p_industries IS NULL OR p_industries = '{}' OR 
           fd.entity_data->>'industry' ILIKE ANY(SELECT '%' || unnest(p_industries) || '%'))
      AND (p_company_sizes IS NULL OR p_company_sizes = '{}' OR 
           fd.entity_data->>'companySize' = ANY(p_company_sizes))
      AND (p_countries IS NULL OR p_countries = '{}' OR 
           fd.entity_data->>'country' ILIKE ANY(SELECT '%' || unnest(p_countries) || '%'))
      AND (p_cities IS NULL OR p_cities = '{}' OR 
           fd.entity_data->>'city' ILIKE ANY(SELECT '%' || unnest(p_cities) || '%'))
      AND (p_company_names IS NULL OR p_company_names = '{}' OR 
           fd.entity_data->>'companyName' ILIKE ANY(SELECT '%' || unnest(p_company_names) || '%'))
      AND (p_seniority_levels IS NULL OR p_seniority_levels = '{}' OR 
           fd.entity_data->>'seniorityLevel' ILIKE ANY(SELECT '%' || unnest(p_seniority_levels) || '%'))
      AND (p_departments IS NULL OR p_departments = '{}' OR 
           fd.entity_data->>'department' ILIKE ANY(SELECT '%' || unnest(p_departments) || '%'))
      AND (p_revenue_ranges IS NULL OR p_revenue_ranges = '{}' OR 
           fd.entity_data->>'revenueRange' = ANY(p_revenue_ranges))
      AND (p_founding_years IS NULL OR p_founding_years = '{}' OR 
           fd.entity_data->>'foundingYear' = ANY(p_founding_years))
      AND (p_has_email IS NULL OR (p_has_email = true AND fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
      AND (p_has_phone IS NULL OR (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
      AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND fd.entity_data->>'linkedin' IS NOT NULL AND fd.entity_data->>'linkedin' != ''))
      AND (p_has_company_phone IS NULL OR (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
      AND (p_has_company_linkedin IS NULL OR (p_has_company_linkedin = true AND fd.entity_data->>'companyLinkedin' IS NOT NULL AND fd.entity_data->>'companyLinkedin' != ''))
      AND (p_has_company_facebook IS NULL OR (p_has_company_facebook = true AND fd.entity_data->>'companyFacebookUrl' IS NOT NULL AND fd.entity_data->>'companyFacebookUrl' != ''))
      AND (p_has_company_twitter IS NULL OR (p_has_company_twitter = true AND fd.entity_data->>'companyTwitterUrl' IS NOT NULL AND fd.entity_data->>'companyTwitterUrl' != ''))
    ORDER BY fd.created_at DESC
    LIMIT p_per_page
    OFFSET v_offset
  ) t;

  RETURN json_build_object(
    'items', COALESCE(v_results, '[]'::json),
    'total_estimate', v_total_estimate,
    'page', p_page,
    'per_page', p_per_page
  );
END;
$$;