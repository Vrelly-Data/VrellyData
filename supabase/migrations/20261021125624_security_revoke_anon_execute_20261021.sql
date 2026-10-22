REVOKE EXECUTE ON FUNCTION public.update_credits_for_testing(uuid,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_campaign_leaderboard(integer) FROM PUBLIC, anon;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('search_prospects_results','search_free_data_results') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP; END $$;
