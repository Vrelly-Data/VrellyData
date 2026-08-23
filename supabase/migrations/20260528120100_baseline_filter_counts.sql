-- Migration: baseline filter_counts + its trigger/refresh functions
-- (catch out-of-band prod state under version control)
-- Source: pg_dump of prod on 2026-05-28. Reconcile schema_migrations on prod separately.
--
-- Note: RLS is enabled on filter_counts but NO policies exist — access is intentionally
-- gated through SECURITY DEFINER functions (refresh_filter_counts, get_filter_counts).
-- update_filter_counts() is defined here because the trigger on public.prospects
-- (in the next migration) needs it to exist already.

-- Table

CREATE TABLE public.filter_counts (
    field_name text NOT NULL,
    field_value text NOT NULL,
    record_count bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


-- Constraints

ALTER TABLE ONLY public.filter_counts
    ADD CONSTRAINT filter_counts_pkey PRIMARY KEY (field_name, field_value);


-- Indexes
CREATE INDEX idx_filter_counts_field ON public.filter_counts USING btree (field_name);

-- Row Level Security (enabled, no policies — by design)
ALTER TABLE public.filter_counts ENABLE ROW LEVEL SECURITY;

-- Trigger function (consumed by prospects' AFTER INSERT trigger in next migration)

CREATE FUNCTION public.update_filter_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  tech text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Simple single-value fields
    INSERT INTO public.filter_counts (field_name, field_value, record_count)
    SELECT field_name, LEFT(field_value, 200), 1
    FROM (VALUES
      ('company_industry', NEW.company_industry),
      ('city', NEW.city),
      ('seniority', NEW.seniority),
      ('country', NEW.country),
      ('state', NEW.state),
      ('department', NEW.department),
      ('gender', NEW.gender),
      ('income_range', NEW.income_range),
      ('net_worth', NEW.net_worth)
    ) AS t(field_name, field_value)
    WHERE field_value IS NOT NULL AND field_value != ''
      AND LENGTH(field_value) <= 500
    ON CONFLICT (field_name, field_value)
    DO UPDATE SET record_count = filter_counts.record_count + 1, updated_at = now();

    -- Split comma-separated fields
    IF NEW.technologies IS NOT NULL AND NEW.technologies != '' THEN
      FOR tech IN SELECT TRIM(t) FROM unnest(string_to_array(NEW.technologies, ',')) t
        WHERE LENGTH(TRIM(t)) > 0 AND LENGTH(TRIM(t)) <= 100
      LOOP
        INSERT INTO public.filter_counts (field_name, field_value, record_count)
        VALUES ('technologies', tech, 1)
        ON CONFLICT (field_name, field_value)
        DO UPDATE SET record_count = filter_counts.record_count + 1, updated_at = now();
      END LOOP;
    END IF;

    IF NEW.skills IS NOT NULL AND NEW.skills != '' THEN
      FOR tech IN SELECT TRIM(t) FROM unnest(string_to_array(NEW.skills, ',')) t
        WHERE LENGTH(TRIM(t)) > 0 AND LENGTH(TRIM(t)) <= 100
      LOOP
        INSERT INTO public.filter_counts (field_name, field_value, record_count)
        VALUES ('skills', tech, 1)
        ON CONFLICT (field_name, field_value)
        DO UPDATE SET record_count = filter_counts.record_count + 1, updated_at = now();
      END LOOP;
    END IF;

    IF NEW.interests IS NOT NULL AND NEW.interests != '' THEN
      FOR tech IN SELECT TRIM(t) FROM unnest(string_to_array(NEW.interests, ',')) t
        WHERE LENGTH(TRIM(t)) > 0 AND LENGTH(TRIM(t)) <= 100
      LOOP
        INSERT INTO public.filter_counts (field_name, field_value, record_count)
        VALUES ('interests', tech, 1)
        ON CONFLICT (field_name, field_value)
        DO UPDATE SET record_count = filter_counts.record_count + 1, updated_at = now();
      END LOOP;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;


-- Re-aggregation function (full rebuild from prospects)

CREATE FUNCTION public.refresh_filter_counts() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Job titles
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'job_title', job_title, COUNT(*)
  FROM prospects
  WHERE job_title IS NOT NULL AND job_title != ''
  GROUP BY job_title
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Company industry
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'company_industry', company_industry, COUNT(*)
  FROM prospects
  WHERE company_industry IS NOT NULL AND company_industry != ''
  GROUP BY company_industry
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Company size
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'company_size', company_size, COUNT(*)
  FROM prospects
  WHERE company_size IS NOT NULL AND company_size != ''
  GROUP BY company_size
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- City
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'city', city, COUNT(*)
  FROM prospects
  WHERE city IS NOT NULL AND city != ''
  GROUP BY city
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Country
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'country', country, COUNT(*)
  FROM prospects
  WHERE country IS NOT NULL AND country != ''
  GROUP BY country
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- State
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'state', state, COUNT(*)
  FROM prospects
  WHERE state IS NOT NULL AND state != ''
  GROUP BY state
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Seniority
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'seniority', seniority, COUNT(*)
  FROM prospects
  WHERE seniority IS NOT NULL AND seniority != ''
  GROUP BY seniority
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Department
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'department', department, COUNT(*)
  FROM prospects
  WHERE department IS NOT NULL AND department != ''
  GROUP BY department
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Gender
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'gender', gender, COUNT(*)
  FROM prospects
  WHERE gender IS NOT NULL AND gender != ''
  GROUP BY gender
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Income range
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'income_range', income_range, COUNT(*)
  FROM prospects
  WHERE income_range IS NOT NULL AND income_range != ''
  GROUP BY income_range
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Net worth
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'net_worth', net_worth, COUNT(*)
  FROM prospects
  WHERE net_worth IS NOT NULL AND net_worth != ''
  GROUP BY net_worth
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Skills
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'skills', skills, COUNT(*)
  FROM prospects
  WHERE skills IS NOT NULL AND skills != ''
  GROUP BY skills
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Interests
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'interests', interests, COUNT(*)
  FROM prospects
  WHERE interests IS NOT NULL AND interests != ''
  GROUP BY interests
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Technologies
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'technologies', technologies, COUNT(*)
  FROM prospects
  WHERE technologies IS NOT NULL AND technologies != ''
  GROUP BY technologies
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Company revenue
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'company_revenue', company_revenue, COUNT(*)
  FROM prospects
  WHERE company_revenue IS NOT NULL AND company_revenue != ''
  GROUP BY company_revenue
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Education history
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  SELECT 'education_history', education_history, COUNT(*)
  FROM prospects
  WHERE education_history IS NOT NULL AND education_history != ''
  GROUP BY education_history
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

  -- Boolean presence flags
  INSERT INTO public.filter_counts (field_name, field_value, record_count)
  VALUES
    ('has_personal_email', 'true', (SELECT COUNT(*) FROM prospects WHERE personal_email IS NOT NULL AND personal_email != '')),
    ('has_business_email', 'true', (SELECT COUNT(*) FROM prospects WHERE business_email IS NOT NULL AND business_email != '')),
    ('has_phone', 'true', (SELECT COUNT(*) FROM prospects WHERE phone IS NOT NULL AND phone != '')),
    ('has_linkedin', 'true', (SELECT COUNT(*) FROM prospects WHERE linkedin_url IS NOT NULL AND linkedin_url != '')),
    ('has_facebook', 'true', (SELECT COUNT(*) FROM prospects WHERE facebook_url IS NOT NULL AND facebook_url != '')),
    ('has_company_twitter', 'true', (SELECT COUNT(*) FROM prospects WHERE company_twitter_url IS NOT NULL AND company_twitter_url != '')),
    ('has_company_facebook', 'true', (SELECT COUNT(*) FROM prospects WHERE company_facebook_url IS NOT NULL AND company_facebook_url != ''))
  ON CONFLICT (field_name, field_value) DO UPDATE SET record_count = EXCLUDED.record_count;

END;
$$;


