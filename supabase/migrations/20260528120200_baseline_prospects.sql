-- Migration: baseline prospects + filter-trigger + search/filter functions
-- (catch out-of-band prod state under version control)
-- Source: pg_dump of prod on 2026-05-28. Reconcile schema_migrations on prod separately.
--
-- Depends on: filter_counts + public.update_filter_counts() (previous migration),
-- pg_trgm extension (gin_trgm_ops indexes) — already prod-installed.
--
-- Note: 41 indexes are extracted verbatim from prod. Several appear duplicative
-- (e.g. idx_prospects_city and idx_prospects_city_lower both index lower(city);
-- idx_prospects_industry_lower duplicates idx_prospects_company_industry). These
-- were not pruned — exact extraction. Worth a cleanup pass in a later migration.

-- Table

CREATE TABLE public.prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    first_name text,
    last_name text,
    created_at timestamp with time zone DEFAULT now(),
    source_uuid text,
    full_name text,
    gender text,
    age_range text,
    business_email text,
    personal_email text,
    phone text,
    linkedin_url text,
    facebook_url text,
    twitter_url text,
    address text,
    city text,
    state text,
    zip_code text,
    country text,
    job_title text,
    seniority text,
    department text,
    skills text,
    interests text,
    education_history text,
    net_worth text,
    income_range text,
    homeowner text,
    married text,
    children text,
    company_name text,
    company_domain text,
    company_size text,
    company_revenue text,
    company_phone text,
    company_linkedin text,
    company_facebook_url text,
    company_twitter_url text,
    company_address text,
    company_city text,
    company_state text,
    company_zip text,
    company_country text,
    company_industry text,
    company_sic text,
    company_naics text,
    company_description text,
    technologies text,
    keywords text,
    total_funding text,
    latest_funding text,
    subsidiary_of text,
    company_size_range text
);


-- Constraints

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


-- Indexes (41, including UNIQUE idx_prospects_source_uuid_unique)
CREATE INDEX idx_prospects_business_email ON public.prospects USING btree (business_email);
CREATE INDEX idx_prospects_children ON public.prospects USING btree (lower(children));
CREATE INDEX idx_prospects_city ON public.prospects USING btree (lower(city));
CREATE INDEX idx_prospects_city_lower ON public.prospects USING btree (lower(city));
CREATE INDEX idx_prospects_city_trgm ON public.prospects USING gin (city public.gin_trgm_ops);
CREATE INDEX idx_prospects_company_city_trgm ON public.prospects USING gin (company_city public.gin_trgm_ops);
CREATE INDEX idx_prospects_company_facebook ON public.prospects USING btree (company_facebook_url) WHERE ((company_facebook_url IS NOT NULL) AND (company_facebook_url <> ''::text));
CREATE INDEX idx_prospects_company_industry ON public.prospects USING btree (lower(company_industry));
CREATE INDEX idx_prospects_company_industry_trgm ON public.prospects USING gin (company_industry public.gin_trgm_ops);
CREATE INDEX idx_prospects_company_linkedin ON public.prospects USING btree (company_linkedin) WHERE ((company_linkedin IS NOT NULL) AND (company_linkedin <> ''::text));
CREATE INDEX idx_prospects_company_name_trgm ON public.prospects USING gin (company_name public.gin_trgm_ops);
CREATE INDEX idx_prospects_company_phone ON public.prospects USING btree (company_phone) WHERE ((company_phone IS NOT NULL) AND (company_phone <> ''::text));
CREATE INDEX idx_prospects_company_twitter ON public.prospects USING btree (company_twitter_url) WHERE ((company_twitter_url IS NOT NULL) AND (company_twitter_url <> ''::text));
CREATE INDEX idx_prospects_country_lower ON public.prospects USING btree (lower(country));
CREATE INDEX idx_prospects_created_at ON public.prospects USING btree (created_at);
CREATE INDEX idx_prospects_department_trgm ON public.prospects USING gin (department public.gin_trgm_ops);
CREATE INDEX idx_prospects_facebook_url ON public.prospects USING btree (facebook_url) WHERE ((facebook_url IS NOT NULL) AND (facebook_url <> ''::text));
CREATE INDEX idx_prospects_gender ON public.prospects USING btree (lower(gender));
CREATE INDEX idx_prospects_homeowner ON public.prospects USING btree (lower(homeowner));
CREATE INDEX idx_prospects_income_range_trgm ON public.prospects USING gin (income_range public.gin_trgm_ops);
CREATE INDEX idx_prospects_industry_lower ON public.prospects USING btree (lower(company_industry));
CREATE INDEX idx_prospects_interests_trgm ON public.prospects USING gin (interests public.gin_trgm_ops);
CREATE INDEX idx_prospects_job_title ON public.prospects USING btree (lower(job_title));
CREATE INDEX idx_prospects_job_title_lower ON public.prospects USING btree (lower(job_title));
CREATE INDEX idx_prospects_job_title_trgm ON public.prospects USING gin (job_title public.gin_trgm_ops);
CREATE INDEX idx_prospects_keyword_fts ON public.prospects USING gin (to_tsvector('english'::regconfig, ((((((COALESCE(job_title, ''::text) || ' '::text) || COALESCE(company_name, ''::text)) || ' '::text) || COALESCE(company_industry, ''::text)) || ' '::text) || COALESCE(company_description, ''::text))));
CREATE INDEX idx_prospects_linkedin_url ON public.prospects USING btree (linkedin_url);
CREATE INDEX idx_prospects_married ON public.prospects USING btree (lower(married));
CREATE INDEX idx_prospects_net_worth_trgm ON public.prospects USING gin (net_worth public.gin_trgm_ops);
CREATE INDEX idx_prospects_personal_email ON public.prospects USING btree (personal_email) WHERE ((personal_email IS NOT NULL) AND (personal_email <> ''::text));
CREATE INDEX idx_prospects_phone ON public.prospects USING btree (phone) WHERE ((phone IS NOT NULL) AND (phone <> ''::text));
CREATE INDEX idx_prospects_seniority_btree ON public.prospects USING btree (lower(seniority));
CREATE INDEX idx_prospects_seniority_trgm ON public.prospects USING gin (seniority public.gin_trgm_ops);
CREATE INDEX idx_prospects_skills_trgm ON public.prospects USING gin (skills public.gin_trgm_ops);
CREATE INDEX idx_prospects_source ON public.prospects USING btree (source);
CREATE UNIQUE INDEX idx_prospects_source_uuid_unique ON public.prospects USING btree (source_uuid) WHERE (source_uuid IS NOT NULL);
CREATE INDEX idx_prospects_state ON public.prospects USING btree (lower(state));
CREATE INDEX idx_prospects_state_lower ON public.prospects USING btree (lower(state));
CREATE INDEX idx_prospects_technologies_trgm ON public.prospects USING gin (technologies public.gin_trgm_ops);
CREATE INDEX idx_prospects_twitter_url ON public.prospects USING btree (twitter_url) WHERE ((twitter_url IS NOT NULL) AND (twitter_url <> ''::text));
CREATE INDEX idx_prospects_zip_code ON public.prospects USING btree (zip_code);

-- Trigger (calls public.update_filter_counts() from previous migration)
CREATE TRIGGER prospects_filter_counts_trigger AFTER INSERT ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.update_filter_counts();

-- Row Level Security
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can read prospects" ON public.prospects FOR SELECT USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Service role full access" ON public.prospects USING ((auth.role() = 'service_role'::text));

-- Search/filter functions
-- get_filter_counts: SQL language, reads filter_counts (from previous migration)

CREATE FUNCTION public.get_filter_counts(p_field text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100) RETURNS TABLE(value text, count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET statement_timeout TO '2s'
    AS $$
  SELECT field_value, record_count
  FROM public.filter_counts
  WHERE field_name = p_field
    AND (p_search IS NULL OR field_value ILIKE '%' || p_search || '%')
  ORDER BY record_count DESC
  LIMIT p_limit;
$$;


-- search_prospects_count: plpgsql

CREATE FUNCTION public.search_prospects_count(p_keywords text[] DEFAULT NULL::text[], p_job_titles text[] DEFAULT NULL::text[], p_seniority_levels text[] DEFAULT NULL::text[], p_company_size_ranges text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_cities text[] DEFAULT NULL::text[], p_gender text[] DEFAULT NULL::text[], p_net_worth text[] DEFAULT NULL::text[], p_income text[] DEFAULT NULL::text[], p_departments text[] DEFAULT NULL::text[], p_company_revenue text[] DEFAULT NULL::text[], p_person_interests text[] DEFAULT NULL::text[], p_person_skills text[] DEFAULT NULL::text[], p_technologies text[] DEFAULT NULL::text[], p_has_personal_email boolean DEFAULT NULL::boolean, p_has_business_email boolean DEFAULT NULL::boolean, p_has_phone boolean DEFAULT NULL::boolean, p_has_linkedin boolean DEFAULT NULL::boolean, p_has_facebook boolean DEFAULT NULL::boolean, p_has_twitter boolean DEFAULT NULL::boolean, p_has_company_phone boolean DEFAULT NULL::boolean, p_has_company_linkedin boolean DEFAULT NULL::boolean, p_has_company_facebook boolean DEFAULT NULL::boolean, p_has_company_twitter boolean DEFAULT NULL::boolean, p_exclude_keywords text[] DEFAULT NULL::text[], p_exclude_job_titles text[] DEFAULT NULL::text[], p_exclude_industries text[] DEFAULT NULL::text[], p_exclude_cities text[] DEFAULT NULL::text[], p_exclude_countries text[] DEFAULT NULL::text[], p_exclude_technologies text[] DEFAULT NULL::text[], p_exclude_person_skills text[] DEFAULT NULL::text[], p_exclude_person_interests text[] DEFAULT NULL::text[], p_zip_code text DEFAULT NULL::text, p_children text[] DEFAULT NULL::text[], p_homeowner boolean DEFAULT NULL::boolean, p_married boolean DEFAULT NULL::boolean, p_education text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_age_max integer DEFAULT NULL::integer, p_company_names text[] DEFAULT NULL::text[], p_added_on_days_ago integer DEFAULT NULL::integer) RETURNS TABLE(total_count bigint, is_estimate boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET statement_timeout TO '5s'
    AS $$
DECLARE
  v_total bigint;
  v_selectivity float := 1.0;
  v_base_count bigint;
  v_filter_count bigint;
  v_active_filters integer := 0;
  i integer;
BEGIN
  EXECUTE 'SET LOCAL work_mem = ''256MB''';

  IF p_job_titles IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_seniority_levels IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_industries IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_cities IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_countries IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_departments IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_keywords IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_gender IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_personal_email IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_business_email IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_phone IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_linkedin IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_facebook IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_company_twitter IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_has_company_facebook IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_person_skills IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_person_interests IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_technologies IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_net_worth IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_income IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_company_size_ranges IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_company_revenue IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;
  IF p_company_names IS NOT NULL THEN v_active_filters := v_active_filters + 1; END IF;

  IF v_active_filters = 0 THEN
    RETURN QUERY SELECT 0::bigint, false::boolean;
    RETURN;
  END IF;

  SELECT SUM(record_count) INTO v_base_count
  FROM public.filter_counts
  WHERE field_name = 'seniority';
  IF v_base_count IS NULL OR v_base_count = 0 THEN v_base_count := 4200000; END IF;

  IF v_active_filters = 1 THEN
    IF p_industries IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'company_industry' AND field_value ILIKE '%' || p_industries[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_cities IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'city' AND field_value ILIKE '%' || p_cities[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_keywords IS NOT NULL THEN
      RETURN QUERY SELECT LEAST((v_base_count * 0.10)::bigint, 100000::bigint), true::boolean; RETURN;
    END IF;
    IF p_job_titles IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'job_title' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_job_titles) x);
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_company_size_ranges IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count
      FROM public.filter_counts
      WHERE field_name = 'company_size'
      AND field_value = ANY(
        SELECT unnest(CASE r
          WHEN '1-10' THEN ARRAY['1 to 10']
          WHEN '11-50' THEN ARRAY['26 to 50']
          WHEN '51-200' THEN ARRAY['51 to 100', '101 to 250']
          WHEN '201-500' THEN ARRAY['251 to 500']
          WHEN '501-1000' THEN ARRAY['501 to 1000']
          WHEN '1001-5000' THEN ARRAY['1001 to 5000']
          WHEN '5001-10000' THEN ARRAY['5001 to 10000']
          WHEN '10000+' THEN ARRAY['10000+']
          ELSE ARRAY[r]
        END)
        FROM unnest(p_company_size_ranges) r
      );
      RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN;
    END IF;
    IF p_seniority_levels IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'seniority' AND LOWER(field_value) = ANY(SELECT LOWER(x) FROM unnest(p_seniority_levels) x);
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_person_skills IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'skills' AND field_value ILIKE '%' || p_person_skills[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_person_interests IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'interests' AND field_value ILIKE '%' || p_person_interests[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_departments IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'department' AND field_value ILIKE '%' || p_departments[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_gender IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'gender' AND LOWER(field_value) = ANY(SELECT LOWER(x) FROM unnest(p_gender) x);
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_income IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'income_range' AND field_value ILIKE '%' || p_income[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_net_worth IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'net_worth' AND field_value ILIKE '%' || p_net_worth[1] || '%';
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_technologies IS NOT NULL THEN
      SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'technologies' AND LOWER(field_value) = LOWER(p_technologies[1]);
      IF v_filter_count > 0 THEN RETURN QUERY SELECT LEAST(v_filter_count, 100000::bigint), false::boolean; RETURN; END IF;
    END IF;
    IF p_has_facebook IS NOT NULL AND p_has_facebook THEN
      SELECT record_count INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'has_facebook' AND field_value = 'true';
      RETURN QUERY SELECT LEAST(COALESCE(v_filter_count, 0), 100000::bigint), false::boolean; RETURN;
    END IF;
    IF p_has_company_twitter IS NOT NULL AND p_has_company_twitter THEN
      SELECT record_count INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'has_company_twitter' AND field_value = 'true';
      RETURN QUERY SELECT LEAST(COALESCE(v_filter_count, 0), 100000::bigint), false::boolean; RETURN;
    END IF;
    IF p_has_company_facebook IS NOT NULL AND p_has_company_facebook THEN
      SELECT record_count INTO v_filter_count FROM public.filter_counts
      WHERE field_name = 'has_company_facebook' AND field_value = 'true';
      RETURN QUERY SELECT LEAST(COALESCE(v_filter_count, 0), 100000::bigint), false::boolean; RETURN;
    END IF;
    IF p_has_personal_email IS NOT NULL AND p_has_personal_email THEN
      RETURN QUERY SELECT 100000::bigint, false::boolean; RETURN;
    END IF;
    IF p_has_business_email IS NOT NULL AND p_has_business_email THEN
      RETURN QUERY SELECT 100000::bigint, false::boolean; RETURN;
    END IF;
    IF p_has_phone IS NOT NULL AND p_has_phone THEN
      RETURN QUERY SELECT 100000::bigint, false::boolean; RETURN;
    END IF;
    IF p_has_linkedin IS NOT NULL AND p_has_linkedin THEN
      RETURN QUERY SELECT 100000::bigint, false::boolean; RETURN;
    END IF;
  END IF;

  IF p_industries IS NOT NULL AND array_length(p_industries, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'company_industry' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_industries) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_cities IS NOT NULL AND array_length(p_cities, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'city' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_cities) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'seniority' AND LOWER(field_value) = ANY(SELECT LOWER(x) FROM unnest(p_seniority_levels) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'department' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_departments) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_person_skills IS NOT NULL AND array_length(p_person_skills, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'skills' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_person_skills) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_person_interests IS NOT NULL AND array_length(p_person_interests, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'interests' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_person_interests) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_technologies IS NOT NULL AND array_length(p_technologies, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'technologies' AND LOWER(field_value) = ANY(SELECT LOWER(x) FROM unnest(p_technologies) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_gender IS NOT NULL AND array_length(p_gender, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'gender' AND LOWER(field_value) = ANY(SELECT LOWER(x) FROM unnest(p_gender) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_income IS NOT NULL AND array_length(p_income, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'income_range' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_income) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_net_worth IS NOT NULL AND array_length(p_net_worth, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'net_worth' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_net_worth) x);
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_company_size_ranges IS NOT NULL AND array_length(p_company_size_ranges, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count
    FROM public.filter_counts
    WHERE field_name = 'company_size'
    AND field_value = ANY(
      SELECT unnest(CASE r
        WHEN '1-10' THEN ARRAY['1 to 10']
        WHEN '11-50' THEN ARRAY['26 to 50']
        WHEN '51-200' THEN ARRAY['51 to 100', '101 to 250']
        WHEN '201-500' THEN ARRAY['251 to 500']
        WHEN '501-1000' THEN ARRAY['501 to 1000']
        WHEN '1001-5000' THEN ARRAY['1001 to 5000']
        WHEN '5001-10000' THEN ARRAY['5001 to 10000']
        WHEN '10000+' THEN ARRAY['10000+']
        ELSE ARRAY[r]
      END)
      FROM unnest(p_company_size_ranges) r
    );
    v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
  END IF;
  IF p_job_titles IS NOT NULL AND array_length(p_job_titles, 1) > 0 THEN
    SELECT COALESCE(SUM(record_count), 0) INTO v_filter_count FROM public.filter_counts
    WHERE field_name = 'job_title' AND field_value ILIKE ANY(SELECT '%' || x || '%' FROM unnest(p_job_titles) x);
    IF v_filter_count > 0 THEN
      v_selectivity := v_selectivity * (v_filter_count::float / v_base_count::float);
    ELSE
      v_selectivity := v_selectivity * 0.15;
    END IF;
  END IF;
  IF p_has_personal_email IS NOT NULL AND p_has_personal_email THEN
    v_selectivity := v_selectivity * 0.49;
  END IF;
  IF p_has_business_email IS NOT NULL AND p_has_business_email THEN
    v_selectivity := v_selectivity * 0.879;
  END IF;
  IF p_has_phone IS NOT NULL AND p_has_phone THEN
    v_selectivity := v_selectivity * 0.54;
  END IF;
  IF p_has_linkedin IS NOT NULL AND p_has_linkedin THEN
    v_selectivity := v_selectivity * 0.82;
  END IF;
  IF p_has_facebook IS NOT NULL AND p_has_facebook THEN
    v_selectivity := v_selectivity * 0.056;
  END IF;
  IF p_has_company_twitter IS NOT NULL AND p_has_company_twitter THEN
    v_selectivity := v_selectivity * 0.013;
  END IF;
  IF p_has_company_facebook IS NOT NULL AND p_has_company_facebook THEN
    v_selectivity := v_selectivity * 0.014;
  END IF;
  IF p_keywords IS NOT NULL AND array_length(p_keywords, 1) > 0 THEN
    v_selectivity := v_selectivity * 0.10;
  END IF;
  IF p_countries IS NOT NULL THEN
    v_selectivity := v_selectivity * 1.0;
  END IF;

  v_total := GREATEST(1, (v_base_count::float * v_selectivity)::bigint);
  RETURN QUERY SELECT LEAST(v_total, 100000::bigint), true::boolean;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- search_prospects_results: plpgsql, RETURNS SETOF public.prospects (return type forces table to exist first)

CREATE FUNCTION public.search_prospects_results(p_keywords text[] DEFAULT NULL::text[], p_job_titles text[] DEFAULT NULL::text[], p_seniority_levels text[] DEFAULT NULL::text[], p_company_size_ranges text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_cities text[] DEFAULT NULL::text[], p_gender text[] DEFAULT NULL::text[], p_net_worth text[] DEFAULT NULL::text[], p_income text[] DEFAULT NULL::text[], p_departments text[] DEFAULT NULL::text[], p_company_revenue text[] DEFAULT NULL::text[], p_person_interests text[] DEFAULT NULL::text[], p_person_skills text[] DEFAULT NULL::text[], p_technologies text[] DEFAULT NULL::text[], p_has_personal_email boolean DEFAULT NULL::boolean, p_has_business_email boolean DEFAULT NULL::boolean, p_has_phone boolean DEFAULT NULL::boolean, p_has_linkedin boolean DEFAULT NULL::boolean, p_has_facebook boolean DEFAULT NULL::boolean, p_has_twitter boolean DEFAULT NULL::boolean, p_has_company_phone boolean DEFAULT NULL::boolean, p_has_company_linkedin boolean DEFAULT NULL::boolean, p_has_company_facebook boolean DEFAULT NULL::boolean, p_has_company_twitter boolean DEFAULT NULL::boolean, p_exclude_keywords text[] DEFAULT NULL::text[], p_exclude_job_titles text[] DEFAULT NULL::text[], p_exclude_industries text[] DEFAULT NULL::text[], p_exclude_cities text[] DEFAULT NULL::text[], p_exclude_countries text[] DEFAULT NULL::text[], p_exclude_technologies text[] DEFAULT NULL::text[], p_exclude_person_skills text[] DEFAULT NULL::text[], p_exclude_person_interests text[] DEFAULT NULL::text[], p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_zip_code text DEFAULT NULL::text, p_children text[] DEFAULT NULL::text[], p_homeowner boolean DEFAULT NULL::boolean, p_married boolean DEFAULT NULL::boolean, p_education text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_age_max integer DEFAULT NULL::integer, p_company_names text[] DEFAULT NULL::text[], p_added_on_days_ago integer DEFAULT NULL::integer) RETURNS SETOF public.prospects
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '15s'
    SET plan_cache_mode TO 'force_custom_plan'
    AS $_$
DECLARE
  v_sql text;
  v_where text := 'WHERE 1=1';
BEGIN
  EXECUTE 'SET LOCAL work_mem = ''256MB''';

  IF p_job_titles IS NOT NULL AND array_length(p_job_titles, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_job_titles, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.job_title ILIKE ' || quote_literal('%' || p_job_titles[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_seniority_levels IS NOT NULL AND array_length(p_seniority_levels, 1) > 0 THEN v_where := v_where || ' AND lower(p.seniority) = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(lower(x)) FROM unnest(p_seniority_levels) x), ',') || '])'; END IF;
  IF p_industries IS NOT NULL AND array_length(p_industries, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_industries, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.company_industry ILIKE ' || quote_literal('%' || p_industries[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_cities IS NOT NULL AND array_length(p_cities, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_cities, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || '(p.city ILIKE ' || quote_literal('%' || p_cities[i] || '%') || ' OR p.company_city ILIKE ' || quote_literal('%' || p_cities[i] || '%') || ')'; END LOOP; v_where := v_where || ')'; END IF;

  -- COUNTRY BLOCK BEGIN -- v3: state validation + null-state-no-city + foreign TLD check on no-info rows
  IF p_countries IS NOT NULL AND array_length(p_countries, 1) > 0 THEN
    v_where := v_where || ' AND (';
    FOR i IN 1..array_length(p_countries, 1) LOOP
      IF i > 1 THEN v_where := v_where || ' OR '; END IF;
      IF public.normalize_country(p_countries[i]) = 'US' THEN
        -- US filter:
        --   (a) state is a valid US state code, OR
        --   (b) state AND city are both null/empty AND emails are not on a foreign TLD
        v_where := v_where ||
          '(p.country = ''US'' AND (' ||
            'p.state = ANY(ARRAY[' ||
              '''AL'',''AK'',''AZ'',''AR'',''CA'',''CO'',''CT'',''DE'',''FL'',''GA'',' ||
              '''HI'',''ID'',''IL'',''IN'',''IA'',''KS'',''KY'',''LA'',''ME'',''MD'',' ||
              '''MA'',''MI'',''MN'',''MS'',''MO'',''MT'',''NE'',''NV'',''NH'',''NJ'',' ||
              '''NM'',''NY'',''NC'',''ND'',''OH'',''OK'',''OR'',''PA'',''RI'',''SC'',' ||
              '''SD'',''TN'',''TX'',''UT'',''VT'',''VA'',''WA'',''WV'',''WI'',''WY'',' ||
              '''DC'',''PR'',''VI'',''GU'',''AS'',''MP''])' ||
            ' OR (' ||
              '(p.state IS NULL OR p.state = '''')' ||
              ' AND (p.city IS NULL OR p.city = '''')' ||
              ' AND (p.business_email IS NULL OR p.business_email !~* ''\.(uk|in|au|de|fr|it|es|nl|br|mx|za|nz|ie|se|no|dk|ch|at|be|pl|ru|cn|jp|kr|sg|hk|ph|id|ar|cl|pe|il|ae|sa)$'')' ||
              ' AND (p.personal_email IS NULL OR p.personal_email !~* ''\.(uk|in|au|de|fr|it|es|nl|br|mx|za|nz|ie|se|no|dk|ch|at|be|pl|ru|cn|jp|kr|sg|hk|ph|id|ar|cl|pe|il|ae|sa)$'')' ||
            ')' ||
          '))';
      ELSE
        -- Non-US filters: unchanged behavior
        v_where := v_where ||
          '(p.country = ' || quote_literal(public.normalize_country(p_countries[i])) ||
          ' OR p.country ILIKE ' || quote_literal('%' || p_countries[i] || '%') || ')';
      END IF;
    END LOOP;
    v_where := v_where || ')';
  END IF;
  -- COUNTRY BLOCK END

  IF p_gender IS NOT NULL AND array_length(p_gender, 1) > 0 THEN v_where := v_where || ' AND LOWER(p.gender) = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(LOWER(x)) FROM unnest(p_gender) x), ',') || '])'; END IF;
  IF p_departments IS NOT NULL AND array_length(p_departments, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_departments, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.department ILIKE ' || quote_literal('%' || p_departments[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_keywords IS NOT NULL AND array_length(p_keywords, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_keywords, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'to_tsvector(''english'', coalesce(p.job_title,'''') || '' '' || coalesce(p.company_name,'''') || '' '' || coalesce(p.company_industry,'''') || '' '' || coalesce(p.company_description,'''')) @@ plainto_tsquery(''english'', ' || quote_literal(p_keywords[i]) || ')'; END LOOP; v_where := v_where || ')'; END IF;
  IF p_person_skills IS NOT NULL AND array_length(p_person_skills, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_person_skills, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.skills ILIKE ' || quote_literal('%' || p_person_skills[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_person_interests IS NOT NULL AND array_length(p_person_interests, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_person_interests, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.interests ILIKE ' || quote_literal('%' || p_person_interests[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_technologies IS NOT NULL AND array_length(p_technologies, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_technologies, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.technologies ILIKE ' || quote_literal('%' || p_technologies[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_net_worth IS NOT NULL AND array_length(p_net_worth, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_net_worth, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.net_worth ILIKE ' || quote_literal('%' || p_net_worth[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_income IS NOT NULL AND array_length(p_income, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_income, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.income_range ILIKE ' || quote_literal('%' || p_income[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_company_names IS NOT NULL AND array_length(p_company_names, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_company_names, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.company_name ILIKE ' || quote_literal('%' || p_company_names[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_education IS NOT NULL AND array_length(p_education, 1) > 0 THEN v_where := v_where || ' AND ('; FOR i IN 1..array_length(p_education, 1) LOOP IF i > 1 THEN v_where := v_where || ' OR '; END IF; v_where := v_where || 'p.education_history ILIKE ' || quote_literal('%' || p_education[i] || '%'); END LOOP; v_where := v_where || ')'; END IF;
  IF p_has_personal_email IS NOT NULL AND p_has_personal_email THEN v_where := v_where || ' AND p.personal_email IS NOT NULL AND p.personal_email != '''''; END IF;
  IF p_has_business_email IS NOT NULL AND p_has_business_email THEN v_where := v_where || ' AND p.business_email IS NOT NULL AND p.business_email != '''''; END IF;
  IF p_has_phone IS NOT NULL AND p_has_phone THEN v_where := v_where || ' AND p.phone IS NOT NULL AND p.phone != '''''; END IF;
  IF p_has_linkedin IS NOT NULL AND p_has_linkedin THEN v_where := v_where || ' AND p.linkedin_url IS NOT NULL AND p.linkedin_url != '''''; END IF;
  IF p_has_facebook IS NOT NULL AND p_has_facebook THEN v_where := v_where || ' AND p.facebook_url IS NOT NULL AND p.facebook_url != '''''; END IF;
  IF p_has_twitter IS NOT NULL AND p_has_twitter THEN v_where := v_where || ' AND p.twitter_url IS NOT NULL AND p.twitter_url != '''''; END IF;
  IF p_has_company_phone IS NOT NULL AND p_has_company_phone THEN v_where := v_where || ' AND p.company_phone IS NOT NULL AND p.company_phone != '''''; END IF;
  IF p_has_company_linkedin IS NOT NULL AND p_has_company_linkedin THEN v_where := v_where || ' AND p.company_linkedin IS NOT NULL AND p.company_linkedin != '''''; END IF;
  IF p_has_company_facebook IS NOT NULL AND p_has_company_facebook THEN v_where := v_where || ' AND p.company_facebook_url IS NOT NULL AND p.company_facebook_url != '''''; END IF;
  IF p_has_company_twitter IS NOT NULL AND p_has_company_twitter THEN v_where := v_where || ' AND p.company_twitter_url IS NOT NULL AND p.company_twitter_url != '''''; END IF;
  IF p_zip_code IS NOT NULL THEN v_where := v_where || ' AND p.zip_code ILIKE ' || quote_literal(p_zip_code || '%'); END IF;
  IF p_children IS NOT NULL AND array_length(p_children, 1) > 0 THEN v_where := v_where || ' AND LOWER(p.children) = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(LOWER(x)) FROM unnest(p_children) x), ',') || '])'; END IF;
  IF p_homeowner IS NOT NULL THEN v_where := v_where || ' AND LOWER(p.homeowner) = ' || quote_literal(CASE WHEN p_homeowner THEN 'yes' ELSE 'no' END); END IF;
  IF p_married IS NOT NULL THEN v_where := v_where || ' AND LOWER(p.married) = ' || quote_literal(CASE WHEN p_married THEN 'yes' ELSE 'no' END); END IF;
  IF p_added_on_days_ago IS NOT NULL THEN v_where := v_where || ' AND p.created_at >= NOW() - INTERVAL ''' || p_added_on_days_ago || ' days'''; END IF;
  IF p_exclude_job_titles IS NOT NULL AND array_length(p_exclude_job_titles, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_job_titles, 1) LOOP v_where := v_where || ' AND p.job_title NOT ILIKE ' || quote_literal('%' || p_exclude_job_titles[i] || '%'); END LOOP; END IF;
  IF p_exclude_industries IS NOT NULL AND array_length(p_exclude_industries, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_industries, 1) LOOP v_where := v_where || ' AND p.company_industry NOT ILIKE ' || quote_literal('%' || p_exclude_industries[i] || '%'); END LOOP; END IF;
  IF p_exclude_cities IS NOT NULL AND array_length(p_exclude_cities, 1) > 0 THEN v_where := v_where || ' AND LOWER(p.city) != ALL(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(LOWER(x)) FROM unnest(p_exclude_cities) x), ',') || '])'; END IF;
  IF p_exclude_countries IS NOT NULL AND array_length(p_exclude_countries, 1) > 0 THEN v_where := v_where || ' AND p.country != ALL(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(public.normalize_country(x)) FROM unnest(p_exclude_countries) x), ',') || '])'; END IF;
  IF p_exclude_keywords IS NOT NULL AND array_length(p_exclude_keywords, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_keywords, 1) LOOP v_where := v_where || ' AND p.job_title NOT ILIKE ' || quote_literal('%' || p_exclude_keywords[i] || '%') || ' AND p.company_name NOT ILIKE ' || quote_literal('%' || p_exclude_keywords[i] || '%') || ' AND p.company_description NOT ILIKE ' || quote_literal('%' || p_exclude_keywords[i] || '%'); END LOOP; END IF;
  IF p_exclude_technologies IS NOT NULL AND array_length(p_exclude_technologies, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_technologies, 1) LOOP v_where := v_where || ' AND p.technologies NOT ILIKE ' || quote_literal('%' || p_exclude_technologies[i] || '%'); END LOOP; END IF;
  IF p_exclude_person_skills IS NOT NULL AND array_length(p_exclude_person_skills, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_person_skills, 1) LOOP v_where := v_where || ' AND p.skills NOT ILIKE ' || quote_literal('%' || p_exclude_person_skills[i] || '%'); END LOOP; END IF;
  IF p_exclude_person_interests IS NOT NULL AND array_length(p_exclude_person_interests, 1) > 0 THEN FOR i IN 1..array_length(p_exclude_person_interests, 1) LOOP v_where := v_where || ' AND p.interests NOT ILIKE ' || quote_literal('%' || p_exclude_person_interests[i] || '%'); END LOOP; END IF;
  IF p_company_size_ranges IS NOT NULL AND array_length(p_company_size_ranges, 1) > 0 THEN v_where := v_where || ' AND p.company_size = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(v) FROM unnest(p_company_size_ranges) r CROSS JOIN LATERAL (SELECT unnest(CASE r WHEN '1-10' THEN ARRAY['1 to 10'] WHEN '11-50' THEN ARRAY['26 to 50'] WHEN '51-200' THEN ARRAY['51 to 100', '101 to 250'] WHEN '201-500' THEN ARRAY['251 to 500'] WHEN '501-1000' THEN ARRAY['501 to 1000'] WHEN '1001-5000' THEN ARRAY['1001 to 5000'] WHEN '5001-10000' THEN ARRAY['5001 to 10000'] WHEN '10000+' THEN ARRAY['10000+'] ELSE ARRAY[r] END) AS v) vals), ',') || '])'; END IF;
  IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) > 0 THEN v_where := v_where || ' AND p.company_revenue = ANY(ARRAY[' || array_to_string(ARRAY(SELECT quote_literal(val) FROM (SELECT unnest(CASE LOWER(x) WHEN 'under $1m' THEN ARRAY['Under 1 Million'] WHEN '$1m - $10m' THEN ARRAY['1 Million To 5 Million', '5 Million To 10 Million'] WHEN '$10m - $50m' THEN ARRAY['10 Million To 25 Million', '25 Million To 50 Million'] WHEN '$50m - $100m' THEN ARRAY['50 Million To 100 Million'] WHEN '$100m - $500m' THEN ARRAY['100 Million To 250 Million', '250 Million To 500 Million'] WHEN '$500m - $1b' THEN ARRAY['500 Million To 1 Billion'] WHEN '$1b+' THEN ARRAY['1 Billion And Over'] ELSE ARRAY[]::text[] END) AS val FROM unnest(p_company_revenue) x) sub), ',') || '])'; END IF;

  v_sql := 'SELECT * FROM public.prospects p ' || v_where || ' ORDER BY p.id LIMIT ' || p_limit || ' OFFSET ' || p_offset;
  RETURN QUERY EXECUTE v_sql;
END;
$_$;


