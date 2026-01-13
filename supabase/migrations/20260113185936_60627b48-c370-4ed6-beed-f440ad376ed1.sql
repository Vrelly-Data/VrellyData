-- Drop all existing overloads of search_free_data_builder
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, jsonb, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, jsonb, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, text, text);

-- Recreate the TABLE-returning function with proper type cast
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text DEFAULT NULL,
  p_filters jsonb DEFAULT NULL,
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
  p_has_company_name boolean DEFAULT NULL,
  p_has_company_website boolean DEFAULT NULL,
  p_has_company_industry boolean DEFAULT NULL,
  p_has_company_size boolean DEFAULT NULL,
  p_has_company_revenue boolean DEFAULT NULL,
  p_has_company_location boolean DEFAULT NULL,
  p_has_job_title boolean DEFAULT NULL,
  p_has_seniority boolean DEFAULT NULL,
  p_has_department boolean DEFAULT NULL,
  p_has_skills boolean DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25,
  p_sort_field text DEFAULT NULL,
  p_sort_direction text DEFAULT 'asc',
  p_search_query text DEFAULT NULL
)
RETURNS TABLE(entity_external_id text, entity_data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
  v_offset integer;
BEGIN
  v_offset := (p_page - 1) * p_per_page;

  -- Get total count
  SELECT COUNT(*) INTO v_total_count
  FROM free_data fd
  WHERE
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    AND (p_search_query IS NULL OR fd.data::text ILIKE '%' || p_search_query || '%')
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR 
         (fd.data->>'personalEmail' IS NOT NULL AND fd.data->>'personalEmail' != '') OR
         (fd.data->'personalEmails' IS NOT NULL AND jsonb_array_length(fd.data->'personalEmails') > 0))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR 
         (fd.data->>'businessEmail' IS NOT NULL AND fd.data->>'businessEmail' != '') OR
         (fd.data->'businessEmails' IS NOT NULL AND jsonb_array_length(fd.data->'businessEmails') > 0))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR 
         (fd.data->>'phone' IS NOT NULL AND fd.data->>'phone' != '') OR
         (fd.data->'phones' IS NOT NULL AND jsonb_array_length(fd.data->'phones') > 0))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR 
         (fd.data->>'linkedin' IS NOT NULL AND fd.data->>'linkedin' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR 
         (fd.data->>'facebook' IS NOT NULL AND fd.data->>'facebook' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR 
         (fd.data->>'twitter' IS NOT NULL AND fd.data->>'twitter' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR 
         (fd.data->>'companyPhone' IS NOT NULL AND fd.data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR 
         (fd.data->>'companyLinkedin' IS NOT NULL AND fd.data->>'companyLinkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR 
         (fd.data->>'companyFacebook' IS NOT NULL AND fd.data->>'companyFacebook' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR 
         (fd.data->>'companyTwitter' IS NOT NULL AND fd.data->>'companyTwitter' != ''))
    AND (p_has_company_name IS NULL OR p_has_company_name = FALSE OR 
         (fd.data->>'companyName' IS NOT NULL AND fd.data->>'companyName' != ''))
    AND (p_has_company_website IS NULL OR p_has_company_website = FALSE OR 
         (fd.data->>'companyWebsite' IS NOT NULL AND fd.data->>'companyWebsite' != ''))
    AND (p_has_company_industry IS NULL OR p_has_company_industry = FALSE OR 
         (fd.data->>'companyIndustry' IS NOT NULL AND fd.data->>'companyIndustry' != ''))
    AND (p_has_company_size IS NULL OR p_has_company_size = FALSE OR 
         (fd.data->>'companySize' IS NOT NULL AND fd.data->>'companySize' != ''))
    AND (p_has_company_revenue IS NULL OR p_has_company_revenue = FALSE OR 
         (fd.data->>'companyRevenue' IS NOT NULL AND fd.data->>'companyRevenue' != ''))
    AND (p_has_company_location IS NULL OR p_has_company_location = FALSE OR 
         (fd.data->>'companyLocation' IS NOT NULL AND fd.data->>'companyLocation' != ''))
    AND (p_has_job_title IS NULL OR p_has_job_title = FALSE OR 
         (fd.data->>'jobTitle' IS NOT NULL AND fd.data->>'jobTitle' != ''))
    AND (p_has_seniority IS NULL OR p_has_seniority = FALSE OR 
         (fd.data->>'seniority' IS NOT NULL AND fd.data->>'seniority' != ''))
    AND (p_has_department IS NULL OR p_has_department = FALSE OR 
         (fd.data->>'department' IS NOT NULL AND fd.data->>'department' != ''))
    AND (p_has_skills IS NULL OR p_has_skills = FALSE OR 
         (fd.data->'skills' IS NOT NULL AND jsonb_array_length(fd.data->'skills') > 0));

  -- Return results with total count
  RETURN QUERY
  SELECT 
    fd.external_id as entity_external_id,
    fd.data as entity_data,
    v_total_count as total_count
  FROM free_data fd
  WHERE
    (p_entity_type IS NULL OR fd.entity_type = p_entity_type::entity_type)
    AND (p_search_query IS NULL OR fd.data::text ILIKE '%' || p_search_query || '%')
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR 
         (fd.data->>'personalEmail' IS NOT NULL AND fd.data->>'personalEmail' != '') OR
         (fd.data->'personalEmails' IS NOT NULL AND jsonb_array_length(fd.data->'personalEmails') > 0))
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR 
         (fd.data->>'businessEmail' IS NOT NULL AND fd.data->>'businessEmail' != '') OR
         (fd.data->'businessEmails' IS NOT NULL AND jsonb_array_length(fd.data->'businessEmails') > 0))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR 
         (fd.data->>'phone' IS NOT NULL AND fd.data->>'phone' != '') OR
         (fd.data->'phones' IS NOT NULL AND jsonb_array_length(fd.data->'phones') > 0))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR 
         (fd.data->>'linkedin' IS NOT NULL AND fd.data->>'linkedin' != ''))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR 
         (fd.data->>'facebook' IS NOT NULL AND fd.data->>'facebook' != ''))
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR 
         (fd.data->>'twitter' IS NOT NULL AND fd.data->>'twitter' != ''))
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR 
         (fd.data->>'companyPhone' IS NOT NULL AND fd.data->>'companyPhone' != ''))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR 
         (fd.data->>'companyLinkedin' IS NOT NULL AND fd.data->>'companyLinkedin' != ''))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR 
         (fd.data->>'companyFacebook' IS NOT NULL AND fd.data->>'companyFacebook' != ''))
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR 
         (fd.data->>'companyTwitter' IS NOT NULL AND fd.data->>'companyTwitter' != ''))
    AND (p_has_company_name IS NULL OR p_has_company_name = FALSE OR 
         (fd.data->>'companyName' IS NOT NULL AND fd.data->>'companyName' != ''))
    AND (p_has_company_website IS NULL OR p_has_company_website = FALSE OR 
         (fd.data->>'companyWebsite' IS NOT NULL AND fd.data->>'companyWebsite' != ''))
    AND (p_has_company_industry IS NULL OR p_has_company_industry = FALSE OR 
         (fd.data->>'companyIndustry' IS NOT NULL AND fd.data->>'companyIndustry' != ''))
    AND (p_has_company_size IS NULL OR p_has_company_size = FALSE OR 
         (fd.data->>'companySize' IS NOT NULL AND fd.data->>'companySize' != ''))
    AND (p_has_company_revenue IS NULL OR p_has_company_revenue = FALSE OR 
         (fd.data->>'companyRevenue' IS NOT NULL AND fd.data->>'companyRevenue' != ''))
    AND (p_has_company_location IS NULL OR p_has_company_location = FALSE OR 
         (fd.data->>'companyLocation' IS NOT NULL AND fd.data->>'companyLocation' != ''))
    AND (p_has_job_title IS NULL OR p_has_job_title = FALSE OR 
         (fd.data->>'jobTitle' IS NOT NULL AND fd.data->>'jobTitle' != ''))
    AND (p_has_seniority IS NULL OR p_has_seniority = FALSE OR 
         (fd.data->>'seniority' IS NOT NULL AND fd.data->>'seniority' != ''))
    AND (p_has_department IS NULL OR p_has_department = FALSE OR 
         (fd.data->>'department' IS NOT NULL AND fd.data->>'department' != ''))
    AND (p_has_skills IS NULL OR p_has_skills = FALSE OR 
         (fd.data->'skills' IS NOT NULL AND jsonb_array_length(fd.data->'skills') > 0))
  ORDER BY 
    CASE WHEN p_sort_direction = 'asc' THEN fd.data->>COALESCE(p_sort_field, 'created_at') END ASC,
    CASE WHEN p_sort_direction = 'desc' THEN fd.data->>COALESCE(p_sort_field, 'created_at') END DESC
  LIMIT p_per_page
  OFFSET v_offset;
END;
$$;