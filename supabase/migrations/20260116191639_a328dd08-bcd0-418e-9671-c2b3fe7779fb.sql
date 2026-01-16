-- EMERGENCY FIX: Remove all overloaded versions and create ONE canonical search_free_data_builder
-- This restores v2.0 checkpoint stability

-- Step 1: Drop ALL existing overloads of search_free_data_builder
DO $$
DECLARE
    func_oid oid;
BEGIN
    FOR func_oid IN 
        SELECT p.oid 
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname = 'search_free_data_builder'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', func_oid::regprocedure);
    END LOOP;
END $$;

-- Step 2: Create ONE canonical function matching frontend parameters exactly
CREATE OR REPLACE FUNCTION public.search_free_data_builder(
    p_entity_type TEXT DEFAULT 'person',
    p_keywords TEXT[] DEFAULT NULL,
    p_industries TEXT[] DEFAULT NULL,
    p_cities TEXT[] DEFAULT NULL,
    p_countries TEXT[] DEFAULT NULL,
    p_gender TEXT[] DEFAULT NULL,
    p_job_titles TEXT[] DEFAULT NULL,
    p_seniority_levels TEXT[] DEFAULT NULL,
    p_departments TEXT[] DEFAULT NULL,
    p_company_size_ranges TEXT[] DEFAULT NULL,
    p_company_revenue TEXT[] DEFAULT NULL,
    p_technologies TEXT[] DEFAULT NULL,
    p_has_linkedin BOOLEAN DEFAULT NULL,
    p_has_email BOOLEAN DEFAULT NULL,
    p_has_phone BOOLEAN DEFAULT NULL,
    p_has_facebook BOOLEAN DEFAULT NULL,
    p_has_twitter BOOLEAN DEFAULT NULL,
    p_has_personal_email BOOLEAN DEFAULT NULL,
    p_has_business_email BOOLEAN DEFAULT NULL,
    p_has_company_phone BOOLEAN DEFAULT NULL,
    p_has_company_linkedin BOOLEAN DEFAULT NULL,
    p_has_company_facebook BOOLEAN DEFAULT NULL,
    p_has_company_twitter BOOLEAN DEFAULT NULL,
    p_person_interests TEXT[] DEFAULT NULL,
    p_person_skills TEXT[] DEFAULT NULL,
    p_net_worth TEXT[] DEFAULT NULL,
    p_income TEXT[] DEFAULT NULL,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS TABLE(
    entity_data JSONB,
    entity_external_id TEXT,
    total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total BIGINT;
BEGIN
    -- Count total matching records
    SELECT COUNT(*) INTO v_total
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type
    
    -- Keywords search (searches across multiple fields)
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw WHERE
            fd.entity_data->>'firstName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'lastName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'fullName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'title' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'company' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'companyName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'industry' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'headline' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'summary' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'bio' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'description' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'city' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'state' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'country' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'location' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'skills' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'interests' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'technologies' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'department' ILIKE '%' || kw || '%'
    ))
    
    -- Industries filter
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_industries) ind WHERE
            fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    
    -- Cities filter
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_cities) ct WHERE
            fd.entity_data->>'city' ILIKE '%' || ct || '%' OR
            fd.entity_data->>'location' ILIKE '%' || ct || '%'
    ))
    
    -- Countries filter
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_countries) ctr WHERE
            fd.entity_data->>'country' ILIKE '%' || ctr || '%' OR
            fd.entity_data->>'location' ILIKE '%' || ctr || '%'
    ))
    
    -- Gender filter
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
        fd.entity_data->>'gender' = ANY(p_gender))
    
    -- Job titles filter
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) jt WHERE
            fd.entity_data->>'title' ILIKE '%' || jt || '%' OR
            fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
    ))
    
    -- Seniority levels filter (uses helper function)
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR
        public.title_matches_seniority(
            COALESCE(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
            p_seniority_levels,
            fd.entity_data->>'seniority'
        ))
    
    -- Departments filter
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_departments) dept WHERE
            fd.entity_data->>'department' ILIKE '%' || dept || '%' OR
            fd.entity_data->>'title' ILIKE '%' || dept || '%' OR
            fd.entity_data->>'jobTitle' ILIKE '%' || dept || '%' OR
            -- C-Suite special handling
            (dept ILIKE '%c-suite%' AND (
                fd.entity_data->>'title' ~* '(^|[^a-z])(CEO|CFO|COO|CTO|CMO|CIO|CISO|CPO|CRO|Chief)[^a-z]' OR
                fd.entity_data->>'jobTitle' ~* '(^|[^a-z])(CEO|CFO|COO|CTO|CMO|CIO|CISO|CPO|CRO|Chief)[^a-z]'
            ))
    ))
    
    -- Company size filter
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_company_size_ranges) sz WHERE
            fd.entity_data->>'employeeCount' ILIKE '%' || sz || '%' OR
            fd.entity_data->>'companySize' ILIKE '%' || sz || '%' OR
            fd.entity_data->>'employees' ILIKE '%' || sz || '%' OR
            public.parse_employee_count_upper(COALESCE(
                fd.entity_data->>'employeeCount',
                fd.entity_data->>'companySize',
                fd.entity_data->>'employees',
                ''
            )) <= public.parse_employee_count_upper(sz)
    ))
    
    -- Company revenue filter
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_company_revenue) rev WHERE
            fd.entity_data->>'revenue' ILIKE '%' || rev || '%' OR
            fd.entity_data->>'annualRevenue' ILIKE '%' || rev || '%'
    ))
    
    -- Technologies filter
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_technologies) tech WHERE
            fd.entity_data->>'technologies' ILIKE '%' || tech || '%' OR
            fd.entity_data->>'techStack' ILIKE '%' || tech || '%'
    ))
    
    -- Has LinkedIn (check multiple field variants)
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
        COALESCE(fd.entity_data->>'linkedin', '') <> '' OR
        COALESCE(fd.entity_data->>'linkedinUrl', '') <> '' OR
        COALESCE(fd.entity_data->>'linkedIn', '') <> ''
    ))
    
    -- Has Email (personal or business)
    AND (p_has_email IS NULL OR p_has_email = FALSE OR (
        COALESCE(fd.entity_data->>'email', '') <> '' OR
        COALESCE(fd.entity_data->>'personalEmail', '') <> '' OR
        COALESCE(fd.entity_data->>'businessEmail', '') <> ''
    ))
    
    -- Has Phone
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
        COALESCE(fd.entity_data->>'phone', '') <> '' OR
        COALESCE(fd.entity_data->>'directNumber', '') <> '' OR
        COALESCE(fd.entity_data->>'mobilePhone', '') <> ''
    ))
    
    -- Has Facebook
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR
        COALESCE(fd.entity_data->>'facebook', '') <> '')
    
    -- Has Twitter
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
        COALESCE(fd.entity_data->>'twitter', '') <> '' OR
        COALESCE(fd.entity_data->>'twitterUrl', '') <> ''
    ))
    
    -- Has Personal Email
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR
        COALESCE(fd.entity_data->>'personalEmail', '') <> '')
    
    -- Has Business Email
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR
        COALESCE(fd.entity_data->>'businessEmail', '') <> '')
    
    -- Has Company Phone
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
        COALESCE(fd.entity_data->>'companyPhone', '') <> '' OR
        COALESCE(fd.entity_data->>'companyDirectNumber', '') <> ''
    ))
    
    -- Has Company LinkedIn
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
        COALESCE(fd.entity_data->>'companyLinkedin', '') <> '' OR
        COALESCE(fd.entity_data->>'companyLinkedinUrl', '') <> ''
    ))
    
    -- Has Company Facebook
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR
        COALESCE(fd.entity_data->>'companyFacebook', '') <> '')
    
    -- Has Company Twitter
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
        COALESCE(fd.entity_data->>'companyTwitter', '') <> '' OR
        COALESCE(fd.entity_data->>'companyTwitterUrl', '') <> ''
    ))
    
    -- Person interests filter
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_person_interests) int WHERE
            fd.entity_data->>'interests' ILIKE '%' || int || '%'
    ))
    
    -- Person skills filter
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_person_skills) sk WHERE
            fd.entity_data->>'skills' ILIKE '%' || sk || '%'
    ))
    
    -- Net worth filter
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw WHERE
            fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    
    -- Income filter
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_income) inc WHERE
            fd.entity_data->>'income' ILIKE '%' || inc || '%' OR
            fd.entity_data->>'incomeRange' ILIKE '%' || inc || '%'
    ));

    -- Return results with pagination
    RETURN QUERY
    SELECT 
        fd.entity_data,
        fd.entity_external_id,
        v_total
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type
    
    -- Same filters as count query above
    AND (p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw WHERE
            fd.entity_data->>'firstName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'lastName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'fullName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'title' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'jobTitle' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'company' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'companyName' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'industry' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'headline' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'summary' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'bio' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'description' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'city' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'state' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'country' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'location' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'skills' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'interests' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'technologies' ILIKE '%' || kw || '%' OR
            fd.entity_data->>'department' ILIKE '%' || kw || '%'
    ))
    AND (p_industries IS NULL OR array_length(p_industries, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_industries) ind WHERE
            fd.entity_data->>'industry' ILIKE '%' || ind || '%'
    ))
    AND (p_cities IS NULL OR array_length(p_cities, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_cities) ct WHERE
            fd.entity_data->>'city' ILIKE '%' || ct || '%' OR
            fd.entity_data->>'location' ILIKE '%' || ct || '%'
    ))
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_countries) ctr WHERE
            fd.entity_data->>'country' ILIKE '%' || ctr || '%' OR
            fd.entity_data->>'location' ILIKE '%' || ctr || '%'
    ))
    AND (p_gender IS NULL OR array_length(p_gender, 1) IS NULL OR 
        fd.entity_data->>'gender' = ANY(p_gender))
    AND (p_job_titles IS NULL OR array_length(p_job_titles, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_job_titles) jt WHERE
            fd.entity_data->>'title' ILIKE '%' || jt || '%' OR
            fd.entity_data->>'jobTitle' ILIKE '%' || jt || '%'
    ))
    AND (p_seniority_levels IS NULL OR array_length(p_seniority_levels, 1) IS NULL OR
        public.title_matches_seniority(
            COALESCE(fd.entity_data->>'title', fd.entity_data->>'jobTitle', ''),
            p_seniority_levels,
            fd.entity_data->>'seniority'
        ))
    AND (p_departments IS NULL OR array_length(p_departments, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_departments) dept WHERE
            fd.entity_data->>'department' ILIKE '%' || dept || '%' OR
            fd.entity_data->>'title' ILIKE '%' || dept || '%' OR
            fd.entity_data->>'jobTitle' ILIKE '%' || dept || '%' OR
            (dept ILIKE '%c-suite%' AND (
                fd.entity_data->>'title' ~* '(^|[^a-z])(CEO|CFO|COO|CTO|CMO|CIO|CISO|CPO|CRO|Chief)[^a-z]' OR
                fd.entity_data->>'jobTitle' ~* '(^|[^a-z])(CEO|CFO|COO|CTO|CMO|CIO|CISO|CPO|CRO|Chief)[^a-z]'
            ))
    ))
    AND (p_company_size_ranges IS NULL OR array_length(p_company_size_ranges, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_company_size_ranges) sz WHERE
            fd.entity_data->>'employeeCount' ILIKE '%' || sz || '%' OR
            fd.entity_data->>'companySize' ILIKE '%' || sz || '%' OR
            fd.entity_data->>'employees' ILIKE '%' || sz || '%' OR
            public.parse_employee_count_upper(COALESCE(
                fd.entity_data->>'employeeCount',
                fd.entity_data->>'companySize',
                fd.entity_data->>'employees',
                ''
            )) <= public.parse_employee_count_upper(sz)
    ))
    AND (p_company_revenue IS NULL OR array_length(p_company_revenue, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_company_revenue) rev WHERE
            fd.entity_data->>'revenue' ILIKE '%' || rev || '%' OR
            fd.entity_data->>'annualRevenue' ILIKE '%' || rev || '%'
    ))
    AND (p_technologies IS NULL OR array_length(p_technologies, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_technologies) tech WHERE
            fd.entity_data->>'technologies' ILIKE '%' || tech || '%' OR
            fd.entity_data->>'techStack' ILIKE '%' || tech || '%'
    ))
    AND (p_has_linkedin IS NULL OR p_has_linkedin = FALSE OR (
        COALESCE(fd.entity_data->>'linkedin', '') <> '' OR
        COALESCE(fd.entity_data->>'linkedinUrl', '') <> '' OR
        COALESCE(fd.entity_data->>'linkedIn', '') <> ''
    ))
    AND (p_has_email IS NULL OR p_has_email = FALSE OR (
        COALESCE(fd.entity_data->>'email', '') <> '' OR
        COALESCE(fd.entity_data->>'personalEmail', '') <> '' OR
        COALESCE(fd.entity_data->>'businessEmail', '') <> ''
    ))
    AND (p_has_phone IS NULL OR p_has_phone = FALSE OR (
        COALESCE(fd.entity_data->>'phone', '') <> '' OR
        COALESCE(fd.entity_data->>'directNumber', '') <> '' OR
        COALESCE(fd.entity_data->>'mobilePhone', '') <> ''
    ))
    AND (p_has_facebook IS NULL OR p_has_facebook = FALSE OR
        COALESCE(fd.entity_data->>'facebook', '') <> '')
    AND (p_has_twitter IS NULL OR p_has_twitter = FALSE OR (
        COALESCE(fd.entity_data->>'twitter', '') <> '' OR
        COALESCE(fd.entity_data->>'twitterUrl', '') <> ''
    ))
    AND (p_has_personal_email IS NULL OR p_has_personal_email = FALSE OR
        COALESCE(fd.entity_data->>'personalEmail', '') <> '')
    AND (p_has_business_email IS NULL OR p_has_business_email = FALSE OR
        COALESCE(fd.entity_data->>'businessEmail', '') <> '')
    AND (p_has_company_phone IS NULL OR p_has_company_phone = FALSE OR (
        COALESCE(fd.entity_data->>'companyPhone', '') <> '' OR
        COALESCE(fd.entity_data->>'companyDirectNumber', '') <> ''
    ))
    AND (p_has_company_linkedin IS NULL OR p_has_company_linkedin = FALSE OR (
        COALESCE(fd.entity_data->>'companyLinkedin', '') <> '' OR
        COALESCE(fd.entity_data->>'companyLinkedinUrl', '') <> ''
    ))
    AND (p_has_company_facebook IS NULL OR p_has_company_facebook = FALSE OR
        COALESCE(fd.entity_data->>'companyFacebook', '') <> '')
    AND (p_has_company_twitter IS NULL OR p_has_company_twitter = FALSE OR (
        COALESCE(fd.entity_data->>'companyTwitter', '') <> '' OR
        COALESCE(fd.entity_data->>'companyTwitterUrl', '') <> ''
    ))
    AND (p_person_interests IS NULL OR array_length(p_person_interests, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_person_interests) int WHERE
            fd.entity_data->>'interests' ILIKE '%' || int || '%'
    ))
    AND (p_person_skills IS NULL OR array_length(p_person_skills, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_person_skills) sk WHERE
            fd.entity_data->>'skills' ILIKE '%' || sk || '%'
    ))
    AND (p_net_worth IS NULL OR array_length(p_net_worth, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_net_worth) nw WHERE
            fd.entity_data->>'netWorth' ILIKE '%' || nw || '%'
    ))
    AND (p_income IS NULL OR array_length(p_income, 1) IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_income) inc WHERE
            fd.entity_data->>'income' ILIKE '%' || inc || '%' OR
            fd.entity_data->>'incomeRange' ILIKE '%' || inc || '%'
    ))
    ORDER BY fd.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;