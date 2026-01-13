-- First, drop ALL existing versions of the function to resolve PGRST203 conflict
DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  public.entity_type, text[], text[], text[], text[], text[], text[], text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text[], text[], text[], text[], integer, integer
);

DROP FUNCTION IF EXISTS public.search_free_data_with_filters_v2(
  public.entity_type, text[], text[], text[], text, text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, integer, integer
);

-- Create the single correct version with company size range matching
CREATE OR REPLACE FUNCTION public.search_free_data_with_filters_v2(
  p_entity_type public.entity_type,
  p_keywords text[] DEFAULT NULL,
  p_job_titles text[] DEFAULT NULL,
  p_seniority_levels text[] DEFAULT NULL,
  p_departments text[] DEFAULT NULL,
  p_industries text[] DEFAULT NULL,
  p_company_types text[] DEFAULT NULL,
  p_company_hq_country text DEFAULT NULL,
  p_company_hq_states text[] DEFAULT NULL,
  p_company_hq_cities text[] DEFAULT NULL,
  p_person_countries text[] DEFAULT NULL,
  p_person_states text[] DEFAULT NULL,
  p_person_cities text[] DEFAULT NULL,
  p_company_size text[] DEFAULT NULL,
  p_has_email boolean DEFAULT NULL,
  p_has_phone boolean DEFAULT NULL,
  p_has_linkedin boolean DEFAULT NULL,
  p_has_twitter boolean DEFAULT NULL,
  p_has_facebook boolean DEFAULT NULL,
  p_has_company_phone boolean DEFAULT NULL,
  p_has_company_email boolean DEFAULT NULL,
  p_is_hiring boolean DEFAULT NULL,
  p_recently_funded boolean DEFAULT NULL,
  p_company_names text[] DEFAULT NULL,
  p_company_domains text[] DEFAULT NULL,
  p_technologies text[] DEFAULT NULL,
  p_company_revenue text[] DEFAULT NULL,
  p_page_number integer DEFAULT 1,
  p_items_per_page integer DEFAULT 25
)
RETURNS TABLE(
  id uuid,
  entity_type public.entity_type,
  entity_data jsonb,
  created_at timestamp with time zone,
  total_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer;
  v_total bigint;
BEGIN
  v_offset := (p_page_number - 1) * p_items_per_page;
  
  -- Get total count first
  SELECT COUNT(*) INTO v_total
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) k
      WHERE fd.entity_data::text ILIKE '%' || k || '%'
    ))
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE lower(fd.entity_data->>'jobTitle') ILIKE '%' || lower(jt) || '%'
    ))
    AND (p_seniority_levels IS NULL OR fd.entity_data->>'seniorityLevel' = ANY(p_seniority_levels))
    AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    AND (p_company_types IS NULL OR fd.entity_data->>'companyType' = ANY(p_company_types))
    AND (p_company_hq_country IS NULL OR fd.entity_data->>'companyHqCountry' = p_company_hq_country)
    AND (p_company_hq_states IS NULL OR fd.entity_data->>'companyHqState' = ANY(p_company_hq_states))
    AND (p_company_hq_cities IS NULL OR fd.entity_data->>'companyHqCity' = ANY(p_company_hq_cities))
    AND (p_person_countries IS NULL OR fd.entity_data->>'country' = ANY(p_person_countries))
    AND (p_person_states IS NULL OR fd.entity_data->>'state' = ANY(p_person_states))
    AND (p_person_cities IS NULL OR fd.entity_data->>'city' = ANY(p_person_cities))
    AND (p_company_size IS NULL OR (
      SELECT bool_or(
        CASE cs
          WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
          WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
          WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
          WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
          WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
          WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
          WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
          WHEN '10000+' THEN (fd.entity_data->>'companySize')::int >= 10001
          ELSE false
        END
      ) FROM unnest(p_company_size) cs
    ))
    AND (p_has_email IS NULL OR (p_has_email = true AND fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_twitter IS NULL OR (p_has_twitter = true AND fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_facebook IS NULL OR (p_has_facebook = true AND fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_email IS NULL OR (p_has_company_email = true AND fd.entity_data->>'companyEmail' IS NOT NULL AND fd.entity_data->>'companyEmail' != ''))
    AND (p_is_hiring IS NULL OR (p_is_hiring = true AND (fd.entity_data->>'isHiring')::boolean = true))
    AND (p_recently_funded IS NULL OR (p_recently_funded = true AND (fd.entity_data->>'recentlyFunded')::boolean = true))
    AND (p_company_names IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_names) cn
      WHERE lower(fd.entity_data->>'companyName') ILIKE '%' || lower(cn) || '%'
    ))
    AND (p_company_domains IS NULL OR fd.entity_data->>'companyDomain' = ANY(p_company_domains))
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) t
      WHERE fd.entity_data->'technologies' ? t
    ))
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.id,
    fd.entity_type,
    fd.entity_data,
    fd.created_at,
    v_total as total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type
    AND (p_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_keywords) k
      WHERE fd.entity_data::text ILIKE '%' || k || '%'
    ))
    AND (p_job_titles IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_job_titles) jt
      WHERE lower(fd.entity_data->>'jobTitle') ILIKE '%' || lower(jt) || '%'
    ))
    AND (p_seniority_levels IS NULL OR fd.entity_data->>'seniorityLevel' = ANY(p_seniority_levels))
    AND (p_departments IS NULL OR fd.entity_data->>'department' = ANY(p_departments))
    AND (p_industries IS NULL OR fd.entity_data->>'industry' = ANY(p_industries))
    AND (p_company_types IS NULL OR fd.entity_data->>'companyType' = ANY(p_company_types))
    AND (p_company_hq_country IS NULL OR fd.entity_data->>'companyHqCountry' = p_company_hq_country)
    AND (p_company_hq_states IS NULL OR fd.entity_data->>'companyHqState' = ANY(p_company_hq_states))
    AND (p_company_hq_cities IS NULL OR fd.entity_data->>'companyHqCity' = ANY(p_company_hq_cities))
    AND (p_person_countries IS NULL OR fd.entity_data->>'country' = ANY(p_person_countries))
    AND (p_person_states IS NULL OR fd.entity_data->>'state' = ANY(p_person_states))
    AND (p_person_cities IS NULL OR fd.entity_data->>'city' = ANY(p_person_cities))
    AND (p_company_size IS NULL OR (
      SELECT bool_or(
        CASE cs
          WHEN '1-10' THEN (fd.entity_data->>'companySize')::int BETWEEN 1 AND 10
          WHEN '11-50' THEN (fd.entity_data->>'companySize')::int BETWEEN 11 AND 50
          WHEN '51-200' THEN (fd.entity_data->>'companySize')::int BETWEEN 51 AND 200
          WHEN '201-500' THEN (fd.entity_data->>'companySize')::int BETWEEN 201 AND 500
          WHEN '501-1000' THEN (fd.entity_data->>'companySize')::int BETWEEN 501 AND 1000
          WHEN '1001-5000' THEN (fd.entity_data->>'companySize')::int BETWEEN 1001 AND 5000
          WHEN '5001-10000' THEN (fd.entity_data->>'companySize')::int BETWEEN 5001 AND 10000
          WHEN '10000+' THEN (fd.entity_data->>'companySize')::int >= 10001
          ELSE false
        END
      ) FROM unnest(p_company_size) cs
    ))
    AND (p_has_email IS NULL OR (p_has_email = true AND fd.entity_data->>'email' IS NOT NULL AND fd.entity_data->>'email' != ''))
    AND (p_has_phone IS NULL OR (p_has_phone = true AND fd.entity_data->>'phone' IS NOT NULL AND fd.entity_data->>'phone' != ''))
    AND (p_has_linkedin IS NULL OR (p_has_linkedin = true AND fd.entity_data->>'linkedinUrl' IS NOT NULL AND fd.entity_data->>'linkedinUrl' != ''))
    AND (p_has_twitter IS NULL OR (p_has_twitter = true AND fd.entity_data->>'twitterUrl' IS NOT NULL AND fd.entity_data->>'twitterUrl' != ''))
    AND (p_has_facebook IS NULL OR (p_has_facebook = true AND fd.entity_data->>'facebookUrl' IS NOT NULL AND fd.entity_data->>'facebookUrl' != ''))
    AND (p_has_company_phone IS NULL OR (p_has_company_phone = true AND fd.entity_data->>'companyPhone' IS NOT NULL AND fd.entity_data->>'companyPhone' != ''))
    AND (p_has_company_email IS NULL OR (p_has_company_email = true AND fd.entity_data->>'companyEmail' IS NOT NULL AND fd.entity_data->>'companyEmail' != ''))
    AND (p_is_hiring IS NULL OR (p_is_hiring = true AND (fd.entity_data->>'isHiring')::boolean = true))
    AND (p_recently_funded IS NULL OR (p_recently_funded = true AND (fd.entity_data->>'recentlyFunded')::boolean = true))
    AND (p_company_names IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_company_names) cn
      WHERE lower(fd.entity_data->>'companyName') ILIKE '%' || lower(cn) || '%'
    ))
    AND (p_company_domains IS NULL OR fd.entity_data->>'companyDomain' = ANY(p_company_domains))
    AND (p_technologies IS NULL OR EXISTS (
      SELECT 1 FROM unnest(p_technologies) t
      WHERE fd.entity_data->'technologies' ? t
    ))
    AND (p_company_revenue IS NULL OR fd.entity_data->>'companyRevenue' = ANY(p_company_revenue))
  ORDER BY fd.created_at DESC
  LIMIT p_items_per_page
  OFFSET v_offset;
END;
$$;