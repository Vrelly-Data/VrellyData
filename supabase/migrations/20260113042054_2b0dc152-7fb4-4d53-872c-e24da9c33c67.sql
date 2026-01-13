-- Fix: Cast text parameter to entity_type enum
DROP FUNCTION IF EXISTS public.search_free_data_builder(text, text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.search_free_data_builder(
  p_entity_type text,
  p_keywords text[] DEFAULT '{}',
  p_job_titles text[] DEFAULT '{}',
  p_seniority_levels text[] DEFAULT '{}',
  p_company_size_ranges text[] DEFAULT '{}',
  p_industries text[] DEFAULT '{}',
  p_countries text[] DEFAULT '{}',
  p_cities text[] DEFAULT '{}',
  p_gender text[] DEFAULT '{}',
  p_net_worth text[] DEFAULT '{}',
  p_income text[] DEFAULT '{}',
  p_departments text[] DEFAULT '{}',
  p_company_revenue text[] DEFAULT '{}',
  p_person_interests text[] DEFAULT '{}',
  p_person_skills text[] DEFAULT '{}',
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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_count integer;
  v_results jsonb;
  v_expanded_seniority text[];
  v_seniority text;
BEGIN
  -- Expand seniority levels to include variations
  v_expanded_seniority := '{}';
  IF array_length(p_seniority_levels, 1) > 0 THEN
    FOREACH v_seniority IN ARRAY p_seniority_levels
    LOOP
      -- Add the original value
      v_expanded_seniority := array_append(v_expanded_seniority, v_seniority);
      
      -- Add common variations based on the seniority level
      CASE lower(v_seniority)
        WHEN 'c-level' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['C-Level', 'c-level', 'C-level', 'c-Level', 'C Level', 'c level', 'CLevel', 'clevel', 'C-Suite', 'c-suite', 'C Suite', 'c suite', 'CSuite', 'csuite', 'Chief', 'chief', 'CEO', 'ceo', 'CFO', 'cfo', 'CTO', 'cto', 'COO', 'coo', 'CMO', 'cmo', 'CIO', 'cio', 'CHRO', 'chro', 'CLO', 'clo', 'CCO', 'cco', 'CPO', 'cpo', 'CRO', 'cro'];
        WHEN 'vp' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['VP', 'vp', 'Vp', 'V.P.', 'v.p.', 'Vice President', 'vice president', 'Vice-President', 'vice-president', 'VicePresident', 'vicepresident', 'Vice Pres', 'vice pres', 'V P', 'v p', 'SVP', 'svp', 'EVP', 'evp', 'AVP', 'avp', 'GVP', 'gvp', 'Senior Vice President', 'senior vice president', 'Executive Vice President', 'executive vice president', 'Assistant Vice President', 'assistant vice president', 'Group Vice President', 'group vice president'];
        WHEN 'director' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Director', 'director', 'DIRECTOR', 'Dir', 'dir', 'Dir.', 'dir.', 'Senior Director', 'senior director', 'Sr Director', 'sr director', 'Sr. Director', 'sr. director', 'Associate Director', 'associate director', 'Assoc Director', 'assoc director', 'Assistant Director', 'assistant director', 'Asst Director', 'asst director', 'Executive Director', 'executive director', 'Exec Director', 'exec director', 'Managing Director', 'managing director', 'Group Director', 'group director', 'Regional Director', 'regional director'];
        WHEN 'manager' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Manager', 'manager', 'MANAGER', 'Mgr', 'mgr', 'Mgr.', 'mgr.', 'Mngr', 'mngr', 'Senior Manager', 'senior manager', 'Sr Manager', 'sr manager', 'Sr. Manager', 'sr. manager', 'Associate Manager', 'associate manager', 'Assoc Manager', 'assoc manager', 'Assistant Manager', 'assistant manager', 'Asst Manager', 'asst manager', 'General Manager', 'general manager', 'GM', 'gm', 'Deputy Manager', 'deputy manager', 'Branch Manager', 'branch manager', 'Team Manager', 'team manager', 'Project Manager', 'project manager', 'Product Manager', 'product manager', 'Account Manager', 'account manager', 'Operations Manager', 'operations manager'];
        WHEN 'senior' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Senior', 'senior', 'SENIOR', 'Sr', 'sr', 'Sr.', 'sr.', 'Snr', 'snr', 'Snr.', 'snr.', 'Lead', 'lead', 'LEAD', 'Principal', 'principal', 'PRINCIPAL', 'Staff', 'staff', 'STAFF', 'Senior Staff', 'senior staff', 'Senior Lead', 'senior lead', 'Senior Principal', 'senior principal', 'Team Lead', 'team lead', 'Tech Lead', 'tech lead', 'Technical Lead', 'technical lead'];
        WHEN 'entry' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Entry', 'entry', 'ENTRY', 'Entry Level', 'entry level', 'Entry-Level', 'entry-level', 'EntryLevel', 'entrylevel', 'Junior', 'junior', 'JUNIOR', 'Jr', 'jr', 'Jr.', 'jr.', 'Jnr', 'jnr', 'Jnr.', 'jnr.', 'Associate', 'associate', 'ASSOCIATE', 'Assoc', 'assoc', 'Assoc.', 'assoc.', 'Trainee', 'trainee', 'TRAINEE', 'Graduate', 'graduate', 'GRADUATE', 'Grad', 'grad', 'Intern', 'intern', 'INTERN', 'Apprentice', 'apprentice', 'APPRENTICE'];
        WHEN 'training' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Training', 'training', 'TRAINING', 'Trainee', 'trainee', 'TRAINEE', 'In Training', 'in training', 'In-Training', 'in-training', 'InTraining', 'intraining', 'Apprentice', 'apprentice', 'APPRENTICE', 'Intern', 'intern', 'INTERN', 'Internship', 'internship', 'INTERNSHIP', 'Student', 'student', 'STUDENT', 'Learner', 'learner', 'LEARNER', 'Probation', 'probation', 'PROBATION', 'Probationary', 'probationary', 'PROBATIONARY'];
        WHEN 'owner' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Owner', 'owner', 'OWNER', 'Co-Owner', 'co-owner', 'Co Owner', 'co owner', 'CoOwner', 'coowner', 'Founder', 'founder', 'FOUNDER', 'Co-Founder', 'co-founder', 'Co Founder', 'co founder', 'CoFounder', 'cofounder', 'Partner', 'partner', 'PARTNER', 'Proprietor', 'proprietor', 'PROPRIETOR', 'Principal', 'principal', 'PRINCIPAL', 'Shareholder', 'shareholder', 'SHAREHOLDER', 'Stakeholder', 'stakeholder', 'STAKEHOLDER', 'Equity Partner', 'equity partner', 'Managing Partner', 'managing partner', 'General Partner', 'general partner', 'Limited Partner', 'limited partner'];
        WHEN 'unpaid' THEN
          v_expanded_seniority := v_expanded_seniority || ARRAY['Unpaid', 'unpaid', 'UNPAID', 'Volunteer', 'volunteer', 'VOLUNTEER', 'Voluntary', 'voluntary', 'VOLUNTARY', 'Pro Bono', 'pro bono', 'Pro-Bono', 'pro-bono', 'ProBono', 'probono', 'Non-Paid', 'non-paid', 'Non Paid', 'non paid', 'NonPaid', 'nonpaid', 'Honorary', 'honorary', 'HONORARY', 'Charity', 'charity', 'CHARITY', 'Community', 'community', 'COMMUNITY'];
        ELSE
          -- For any other value, just use it as-is (already added above)
          NULL;
      END CASE;
    END LOOP;
  END IF;

  -- Get total count first (with entity_type cast)
  SELECT COUNT(*)
  INTO v_total_count
  FROM free_data fd
  WHERE fd.entity_type = p_entity_type::entity_type
    AND (array_length(p_keywords, 1) IS NULL OR array_length(p_keywords, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(p_keywords) k WHERE 
           fd.full_name ILIKE '%' || k || '%' OR
           fd.job_title ILIKE '%' || k || '%' OR
           fd.company_name ILIKE '%' || k || '%'))
    AND (array_length(p_job_titles, 1) IS NULL OR array_length(p_job_titles, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(p_job_titles) jt WHERE fd.job_title ILIKE '%' || jt || '%'))
    AND (array_length(v_expanded_seniority, 1) IS NULL OR array_length(v_expanded_seniority, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(v_expanded_seniority) sl WHERE fd.seniority ILIKE '%' || sl || '%'))
    AND (array_length(p_company_size_ranges, 1) IS NULL OR array_length(p_company_size_ranges, 1) = 0 OR 
         fd.company_size = ANY(p_company_size_ranges))
    AND (array_length(p_industries, 1) IS NULL OR array_length(p_industries, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(p_industries) ind WHERE fd.industry ILIKE '%' || ind || '%'))
    AND (array_length(p_countries, 1) IS NULL OR array_length(p_countries, 1) = 0 OR 
         fd.country = ANY(p_countries))
    AND (array_length(p_cities, 1) IS NULL OR array_length(p_cities, 1) = 0 OR 
         fd.city = ANY(p_cities))
    AND (array_length(p_gender, 1) IS NULL OR array_length(p_gender, 1) = 0 OR 
         fd.gender = ANY(p_gender))
    AND (array_length(p_net_worth, 1) IS NULL OR array_length(p_net_worth, 1) = 0 OR 
         fd.net_worth = ANY(p_net_worth))
    AND (array_length(p_income, 1) IS NULL OR array_length(p_income, 1) = 0 OR 
         fd.income = ANY(p_income))
    AND (array_length(p_departments, 1) IS NULL OR array_length(p_departments, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(p_departments) dept WHERE fd.department ILIKE '%' || dept || '%'))
    AND (array_length(p_company_revenue, 1) IS NULL OR array_length(p_company_revenue, 1) = 0 OR 
         EXISTS (
           SELECT 1 FROM unnest(p_company_revenue) rev_range
           WHERE (
             CASE 
               WHEN rev_range = '$0 - $1M' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) BETWEEN 0 AND 1000000
               WHEN rev_range = '$1M - $10M' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) BETWEEN 1000000 AND 10000000
               WHEN rev_range = '$10M - $50M' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) BETWEEN 10000000 AND 50000000
               WHEN rev_range = '$50M - $100M' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) BETWEEN 50000000 AND 100000000
               WHEN rev_range = '$100M - $500M' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) BETWEEN 100000000 AND 500000000
               WHEN rev_range = '$500M - $1B' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) BETWEEN 500000000 AND 1000000000
               WHEN rev_range = '$1B+' THEN
                 COALESCE(
                   CASE 
                     WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                       CASE 
                         WHEN fd.company_revenue ILIKE '%B' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                         WHEN fd.company_revenue ILIKE '%M' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                         WHEN fd.company_revenue ILIKE '%K' THEN 
                           REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                         ELSE 
                           REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                       END
                     ELSE NULL
                   END, 0
                 ) >= 1000000000
               ELSE fd.company_revenue = rev_range
             END
           )
         ))
    AND (array_length(p_person_interests, 1) IS NULL OR array_length(p_person_interests, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(p_person_interests) pi WHERE fd.person_interests ILIKE '%' || pi || '%'))
    AND (array_length(p_person_skills, 1) IS NULL OR array_length(p_person_skills, 1) = 0 OR 
         EXISTS (SELECT 1 FROM unnest(p_person_skills) ps WHERE fd.person_skills ILIKE '%' || ps || '%'))
    AND (p_has_personal_email IS NULL OR 
         (p_has_personal_email = true AND fd.personal_email IS NOT NULL AND fd.personal_email != '') OR
         (p_has_personal_email = false AND (fd.personal_email IS NULL OR fd.personal_email = '')))
    AND (p_has_business_email IS NULL OR 
         (p_has_business_email = true AND fd.business_email IS NOT NULL AND fd.business_email != '') OR
         (p_has_business_email = false AND (fd.business_email IS NULL OR fd.business_email = '')))
    AND (p_has_phone IS NULL OR 
         (p_has_phone = true AND fd.phone IS NOT NULL AND fd.phone != '') OR
         (p_has_phone = false AND (fd.phone IS NULL OR fd.phone = '')))
    AND (p_has_linkedin IS NULL OR 
         (p_has_linkedin = true AND fd.linkedin_url IS NOT NULL AND fd.linkedin_url != '') OR
         (p_has_linkedin = false AND (fd.linkedin_url IS NULL OR fd.linkedin_url = '')))
    AND (p_has_twitter IS NULL OR 
         (p_has_twitter = true AND fd.twitter_url IS NOT NULL AND fd.twitter_url != '') OR
         (p_has_twitter = false AND (fd.twitter_url IS NULL OR fd.twitter_url = '')))
    AND (p_has_facebook IS NULL OR 
         (p_has_facebook = true AND fd.facebook_url IS NOT NULL AND fd.facebook_url != '') OR
         (p_has_facebook = false AND (fd.facebook_url IS NULL OR fd.facebook_url = '')))
    AND (p_has_company_phone IS NULL OR 
         (p_has_company_phone = true AND fd.company_phone IS NOT NULL AND fd.company_phone != '') OR
         (p_has_company_phone = false AND (fd.company_phone IS NULL OR fd.company_phone = '')))
    AND (p_has_company_linkedin IS NULL OR 
         (p_has_company_linkedin = true AND fd.company_linkedin_url IS NOT NULL AND fd.company_linkedin_url != '') OR
         (p_has_company_linkedin = false AND (fd.company_linkedin_url IS NULL OR fd.company_linkedin_url = '')))
    AND (p_has_company_facebook IS NULL OR 
         (p_has_company_facebook = true AND fd.company_facebook_url IS NOT NULL AND fd.company_facebook_url != '') OR
         (p_has_company_facebook = false AND (fd.company_facebook_url IS NULL OR fd.company_facebook_url = '')))
    AND (p_has_company_twitter IS NULL OR 
         (p_has_company_twitter = true AND fd.company_twitter_url IS NOT NULL AND fd.company_twitter_url != '') OR
         (p_has_company_twitter = false AND (fd.company_twitter_url IS NULL OR fd.company_twitter_url = '')));

  -- Get paginated results with all fields (with entity_type cast)
  SELECT jsonb_agg(row_to_json(t))
  INTO v_results
  FROM (
    SELECT 
      fd.id,
      fd.entity_type,
      fd.full_name,
      fd.job_title,
      fd.seniority,
      fd.department,
      fd.personal_email,
      fd.business_email,
      fd.phone,
      fd.linkedin_url,
      fd.twitter_url,
      fd.facebook_url,
      fd.company_name,
      fd.company_domain,
      fd.company_size,
      fd.industry,
      fd.company_phone,
      fd.company_linkedin_url,
      fd.company_facebook_url,
      fd.company_twitter_url,
      fd.company_revenue,
      fd.country,
      fd.city,
      fd.state,
      fd.gender,
      fd.net_worth,
      fd.income,
      fd.person_interests,
      fd.person_skills,
      fd.created_at
    FROM free_data fd
    WHERE fd.entity_type = p_entity_type::entity_type
      AND (array_length(p_keywords, 1) IS NULL OR array_length(p_keywords, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(p_keywords) k WHERE 
             fd.full_name ILIKE '%' || k || '%' OR
             fd.job_title ILIKE '%' || k || '%' OR
             fd.company_name ILIKE '%' || k || '%'))
      AND (array_length(p_job_titles, 1) IS NULL OR array_length(p_job_titles, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(p_job_titles) jt WHERE fd.job_title ILIKE '%' || jt || '%'))
      AND (array_length(v_expanded_seniority, 1) IS NULL OR array_length(v_expanded_seniority, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(v_expanded_seniority) sl WHERE fd.seniority ILIKE '%' || sl || '%'))
      AND (array_length(p_company_size_ranges, 1) IS NULL OR array_length(p_company_size_ranges, 1) = 0 OR 
           fd.company_size = ANY(p_company_size_ranges))
      AND (array_length(p_industries, 1) IS NULL OR array_length(p_industries, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(p_industries) ind WHERE fd.industry ILIKE '%' || ind || '%'))
      AND (array_length(p_countries, 1) IS NULL OR array_length(p_countries, 1) = 0 OR 
           fd.country = ANY(p_countries))
      AND (array_length(p_cities, 1) IS NULL OR array_length(p_cities, 1) = 0 OR 
           fd.city = ANY(p_cities))
      AND (array_length(p_gender, 1) IS NULL OR array_length(p_gender, 1) = 0 OR 
           fd.gender = ANY(p_gender))
      AND (array_length(p_net_worth, 1) IS NULL OR array_length(p_net_worth, 1) = 0 OR 
           fd.net_worth = ANY(p_net_worth))
      AND (array_length(p_income, 1) IS NULL OR array_length(p_income, 1) = 0 OR 
           fd.income = ANY(p_income))
      AND (array_length(p_departments, 1) IS NULL OR array_length(p_departments, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(p_departments) dept WHERE fd.department ILIKE '%' || dept || '%'))
      AND (array_length(p_company_revenue, 1) IS NULL OR array_length(p_company_revenue, 1) = 0 OR 
           EXISTS (
             SELECT 1 FROM unnest(p_company_revenue) rev_range
             WHERE (
               CASE 
                 WHEN rev_range = '$0 - $1M' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) BETWEEN 0 AND 1000000
                 WHEN rev_range = '$1M - $10M' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) BETWEEN 1000000 AND 10000000
                 WHEN rev_range = '$10M - $50M' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) BETWEEN 10000000 AND 50000000
                 WHEN rev_range = '$50M - $100M' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) BETWEEN 50000000 AND 100000000
                 WHEN rev_range = '$100M - $500M' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) BETWEEN 100000000 AND 500000000
                 WHEN rev_range = '$500M - $1B' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) BETWEEN 500000000 AND 1000000000
                 WHEN rev_range = '$1B+' THEN
                   COALESCE(
                     CASE 
                       WHEN fd.company_revenue ~ '^\$?[\d,]+(\.\d+)?[KMB]?$' THEN
                         CASE 
                           WHEN fd.company_revenue ILIKE '%B' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'B', '')::numeric * 1000000000
                           WHEN fd.company_revenue ILIKE '%M' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'M', '')::numeric * 1000000
                           WHEN fd.company_revenue ILIKE '%K' THEN 
                             REPLACE(REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', ''), 'K', '')::numeric * 1000
                           ELSE 
                             REPLACE(REPLACE(fd.company_revenue, '$', ''), ',', '')::numeric
                         END
                       ELSE NULL
                     END, 0
                   ) >= 1000000000
                 ELSE fd.company_revenue = rev_range
               END
             )
           ))
      AND (array_length(p_person_interests, 1) IS NULL OR array_length(p_person_interests, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(p_person_interests) pi WHERE fd.person_interests ILIKE '%' || pi || '%'))
      AND (array_length(p_person_skills, 1) IS NULL OR array_length(p_person_skills, 1) = 0 OR 
           EXISTS (SELECT 1 FROM unnest(p_person_skills) ps WHERE fd.person_skills ILIKE '%' || ps || '%'))
      AND (p_has_personal_email IS NULL OR 
           (p_has_personal_email = true AND fd.personal_email IS NOT NULL AND fd.personal_email != '') OR
           (p_has_personal_email = false AND (fd.personal_email IS NULL OR fd.personal_email = '')))
      AND (p_has_business_email IS NULL OR 
           (p_has_business_email = true AND fd.business_email IS NOT NULL AND fd.business_email != '') OR
           (p_has_business_email = false AND (fd.business_email IS NULL OR fd.business_email = '')))
      AND (p_has_phone IS NULL OR 
           (p_has_phone = true AND fd.phone IS NOT NULL AND fd.phone != '') OR
           (p_has_phone = false AND (fd.phone IS NULL OR fd.phone = '')))
      AND (p_has_linkedin IS NULL OR 
           (p_has_linkedin = true AND fd.linkedin_url IS NOT NULL AND fd.linkedin_url != '') OR
           (p_has_linkedin = false AND (fd.linkedin_url IS NULL OR fd.linkedin_url = '')))
      AND (p_has_twitter IS NULL OR 
           (p_has_twitter = true AND fd.twitter_url IS NOT NULL AND fd.twitter_url != '') OR
           (p_has_twitter = false AND (fd.twitter_url IS NULL OR fd.twitter_url = '')))
      AND (p_has_facebook IS NULL OR 
           (p_has_facebook = true AND fd.facebook_url IS NOT NULL AND fd.facebook_url != '') OR
           (p_has_facebook = false AND (fd.facebook_url IS NULL OR fd.facebook_url = '')))
      AND (p_has_company_phone IS NULL OR 
           (p_has_company_phone = true AND fd.company_phone IS NOT NULL AND fd.company_phone != '') OR
           (p_has_company_phone = false AND (fd.company_phone IS NULL OR fd.company_phone = '')))
      AND (p_has_company_linkedin IS NULL OR 
           (p_has_company_linkedin = true AND fd.company_linkedin_url IS NOT NULL AND fd.company_linkedin_url != '') OR
           (p_has_company_linkedin = false AND (fd.company_linkedin_url IS NULL OR fd.company_linkedin_url = '')))
      AND (p_has_company_facebook IS NULL OR 
           (p_has_company_facebook = true AND fd.company_facebook_url IS NOT NULL AND fd.company_facebook_url != '') OR
           (p_has_company_facebook = false AND (fd.company_facebook_url IS NULL OR fd.company_facebook_url = '')))
      AND (p_has_company_twitter IS NULL OR 
           (p_has_company_twitter = true AND fd.company_twitter_url IS NOT NULL AND fd.company_twitter_url != '') OR
           (p_has_company_twitter = false AND (fd.company_twitter_url IS NULL OR fd.company_twitter_url = '')))
    ORDER BY fd.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'items', COALESCE(v_results, '[]'::jsonb),
    'total_estimate', v_total_count,
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;

COMMENT ON FUNCTION public.search_free_data_builder IS 'Canonical search function for free_data. DO NOT create overloads - modify this function instead.';