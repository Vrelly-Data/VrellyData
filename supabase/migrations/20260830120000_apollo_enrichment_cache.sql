-- apollo_enrichment_cache — pay Apollo once per person, not once per click.
--
-- THE PROBLEM THIS SOLVES. Until now the only way to see a person's real email,
-- surname, LinkedIn or location was to push them: run-agent-audience enriches
-- candidateIds unconditionally (its step 6) and the operator never sees the
-- data before it is spent. Reveal fixes that — but a naive Reveal makes it
-- WORSE, because revealing and then pushing calls people/bulk_match twice for
-- the same person. Apollo bills per record where credit-consuming data is
-- found, so without a cache the Reveal button silently doubles the cost of
-- every push it precedes.
--
-- WHY NOT LEAN ON APOLLO'S OWN revealed_for_current_team. It is returned by
-- enrichment and tells you Apollo remembers the reveal, but it is not a
-- promise about billing, it arrives only WITH the (already-made) paid call, and
-- it is a property of the Apollo team account rather than of our user. It
-- cannot answer "will this next call cost me money?" before the call. Only a
-- local record can.
--
-- WHAT THIS IS NOT. Not a contact store, not a CRM mirror, and not a dedup key.
-- agent_audience_pushes remains the audit trail and the dedup key; this table
-- only remembers what Apollo already told us, so we don't buy it twice. Reads
-- go through a TTL (see ENRICH_CACHE_TTL_DAYS in _shared/apollo.ts): stale
-- contact data is worse than a credit, so an expired row is re-fetched rather
-- than served.

-- ============================================================================
CREATE TABLE IF NOT EXISTS public.apollo_enrichment_cache (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SCOPED PER USER, DELIBERATELY, even though that means two clients who both
  -- match the same person each pay once.
  --
  -- The alternative — one global row per apollo_person_id — would be cheaper
  -- and is wrong twice over. Credits are drawn from whichever Apollo account
  -- the key belongs to (see _shared/apollo-key.ts: a client's own key, else the
  -- shared one), so a global cache would let client A's spend silently
  -- subsidise client B and make agent_audience_runs.credits_spent unreconcilable
  -- against any one Apollo dashboard. And it would hand one tenant's enriched
  -- personal data — email, surname, LinkedIn — to another tenant that never
  -- paid for or requested it. Isolation wins; the duplicate spend is the price.
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  apollo_person_id  TEXT NOT NULL,

  -- Whose balance actually paid, from getApolloKeyForUser. Recorded for the
  -- same reason the enrich logs record it: a cached record that was bought with
  -- the shared key is not evidence that the client's own account has it.
  key_source        TEXT NOT NULL CHECK (key_source IN ('client', 'shared')),

  -- The mapped ApolloEnrichedPerson, verbatim. JSONB rather than columns
  -- because the mapper is the schema and it changes with Apollo; a column per
  -- field would need a migration every time bulk_match grows one, and the
  -- read-through path hands this straight back to the caller untouched.
  person            JSONB NOT NULL,

  -- The one denormalized field. Not for joins — purely so "is the cache
  -- actually holding anything useful?" is answerable in SQL without unpacking
  -- every payload. email_key / linkedin_key are deliberately NOT mirrored here:
  -- those must be produced by _shared/lead-dedup.ts at push time, and a second
  -- copy normalized by different code is exactly how a dedup key silently
  -- drifts out of agreement with agent_audience_pushes.
  email             TEXT,

  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- How many times we have PAID for this person. Stays 0 for a row that has
  -- only ever been served from cache; increments when a TTL expiry or an
  -- explicit refresh made us buy them again. A climbing value here means the
  -- TTL is too short for how this account works.
  refresh_count     INTEGER NOT NULL DEFAULT 0 CHECK (refresh_count >= 0),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NO credits column, on purpose. Apollo reports credits_consumed per CALL, not
-- per record, so any per-person figure here would be an apportioned guess — and
-- agent_audience_runs.credits_spent is meant to reconcile against the Apollo
-- dashboard. That ledger stays the single source of truth for spend; this table
-- only answers "do we already have this person?".

-- The read-through lookup is exactly this key, and it must be unique so the
-- writer can upsert on conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uq_apollo_enrichment_cache_person
  ON public.apollo_enrichment_cache(user_id, apollo_person_id);

-- For the eventual prune of long-expired rows. Cheap now, needed later: this
-- table holds personal data and should not accumulate forever.
CREATE INDEX IF NOT EXISTS idx_apollo_enrichment_cache_fetched
  ON public.apollo_enrichment_cache(fetched_at);

-- ============================================================================
-- refresh_count — maintained in the database, not by the writer
-- ============================================================================
-- Every UPDATE of a row here is, by construction, a re-purchase: the sole
-- writer is apollo-enrich's upsert, which only ever conflicts when a TTL expiry
-- or an explicit refresh sent us back to Apollo for someone we already had.
--
-- The counter lives in a trigger rather than in the upsert payload because a
-- payload cannot express "increment". Sending refresh_count as a literal would
-- overwrite the stored value on every conflict — the same class of mistake as
-- including a null firmographic column in an upsert and erasing what was there.
-- Omitted from the payload, the column is untouched by the write and adjusted
-- here instead.
CREATE OR REPLACE FUNCTION public.apollo_enrichment_cache_bump_refresh()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.refresh_count := COALESCE(OLD.refresh_count, 0) + 1;
  -- created_at records when we FIRST bought this person; a re-purchase must not
  -- move it. fetched_at (set by the writer) is the freshness clock.
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apollo_enrichment_cache_bump_refresh ON public.apollo_enrichment_cache;
CREATE TRIGGER trg_apollo_enrichment_cache_bump_refresh
  BEFORE UPDATE ON public.apollo_enrichment_cache
  FOR EACH ROW EXECUTE FUNCTION public.apollo_enrichment_cache_bump_refresh();

-- ============================================================================
-- RLS
-- ============================================================================
-- READ-ONLY for the owner, unlike the agent_audience_* tables' FOR ALL policies.
-- Nothing in the client has any business writing here: a forged row would make
-- the app serve fabricated contact data as though Apollo had returned it, and
-- suppress the real (paid) lookup that would have corrected it. Every legitimate
-- write comes from apollo-enrich under the service role, which bypasses RLS.
ALTER TABLE public.apollo_enrichment_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='apollo_enrichment_cache'
                   AND policyname='Users read own apollo enrichment cache') THEN
    CREATE POLICY "Users read own apollo enrichment cache"
      ON public.apollo_enrichment_cache
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
