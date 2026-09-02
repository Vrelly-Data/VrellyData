-- agent_audiences.source — which data source an audience searches.
--
-- STAGE 1 OF THE SOURCE ABSTRACTION, and deliberately the whole of it on the
-- database side. This migration adds one column and changes no behaviour: every
-- existing row becomes 'apollo', which is what every existing row already is.
-- Nothing reads this column yet except type definitions.
--
-- WHY A COLUMN RATHER THAN INFERRING IT. An audience's filters are stored
-- verbatim in the source's own vocabulary (see filters / filters_version), so
-- after this there is no way to tell an Apollo audience from a Vrelly one by
-- looking at the filters — 'person_titles' and 'p_job_titles' are different
-- words for the same intent and neither is self-describing. The source has to
-- be recorded at creation time or it is not recoverable.
--
-- WHY FILTERS STAY VERBATIM PER SOURCE. The alternative is a neutral filter
-- model that every adapter translates into. That sounds tidier and rots
-- faster: a neutral model can only express the intersection of what every
-- source supports, so the first source with a filter the others lack either
-- corrupts the model or gets silently dropped. Apollo's api_search already
-- ignores unknown keys without erroring, which makes silent loss the default
-- failure. Storing each source's own vocabulary keeps the audience
-- reproducible against the API that will actually run it.
--
-- THE CHECK LISTS SOURCES THAT DO NOT EXIST YET, on purpose. 'clay' and 'ai'
-- are greyed out in the UI and 'vrelly' does not land until Stage 3. Naming
-- them here means enabling one later is a UI change, not a migration — and a
-- CHECK is the cheap place to be wrong, because widening it is one line while
-- discovering an unconstrained free-text column full of typos is not.

ALTER TABLE public.agent_audiences
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'apollo';

-- Added separately from the column so re-running is safe: ADD COLUMN IF NOT
-- EXISTS skips the whole clause on a second run, constraint included, which
-- would leave the column unconstrained on any database where an earlier
-- partial run had already created it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_audiences'::regclass
      AND conname = 'agent_audiences_source_check'
  ) THEN
    ALTER TABLE public.agent_audiences
      ADD CONSTRAINT agent_audiences_source_check
      CHECK (source IN ('apollo', 'vrelly', 'clay', 'ai'));
  END IF;
END $$;

COMMENT ON COLUMN public.agent_audiences.source IS
  'Data source this audience searches. filters are stored in THIS source''s own '
  'vocabulary — Apollo api_search parameter names for apollo, search_prospects_* '
  'parameter names for vrelly — so filters cannot be interpreted without it. '
  'See docs/SEARCH_PROSPECTS_REFERENCE.md and src/lib/audienceSources.ts.';

-- No index. Every query that touches this table is already scoped by user_id or
-- by primary key, and the row counts here are per-client and small; an index on
-- a four-value column would be write cost for no read benefit.
