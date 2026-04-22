-- Cache for bulk account-level stats pulled from the outbound platform API.
-- Populated by sync jobs (e.g. sync-heyreach-campaigns calls
-- POST /api/public/stats/GetOverallStats once per sync) and read by
-- usePlaygroundStats to populate the Data Playground top-level cards
-- without needing per-campaign stats fan-out.

ALTER TABLE public.outbound_integrations
  ADD COLUMN IF NOT EXISTS stats_cache JSONB DEFAULT '{}'::jsonb;
