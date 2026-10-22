ALTER POLICY "Service role has full access" ON public.blog_posts TO service_role;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('search_free_data_builder','search_free_data_count','search_prospects_count','get_filter_counts','get_filter_options','get_filter_suggestions','reset_monthly_credits','reset_daily_credits_if_needed','refresh_filter_counts','refresh_filter_suggestions') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP; END $$;
