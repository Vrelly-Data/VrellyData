-- Per-campaign channel column for the Synced Campaigns dashboard + future
-- Reply.io reporting routing (Step 3).
--
-- Background: source→channel is 1:1 for single-channel platforms
-- (heyreach=linkedin, smartlead=email) but doesn't work for Reply.io,
-- which is multichannel. A Reply.io sequence can be LinkedIn-only,
-- email-only, or have both step types intermixed. The previous
-- sourceToChannel('reply_io') → 'email' assumption mislabeled CYPR's
-- LinkedIn sequences as Email.
--
-- This migration:
--   1. Adds a nullable `channel` column.
--   2. Backfills the easy single-platform rows (heyreach → 'linkedin',
--      smartlead → 'email'). Reply.io rows stay NULL until re-synced —
--      sync-reply-campaigns now fetches /v3/sequences/{id}/steps and
--      classifies per-sequence.
--
-- Allowed values (enforced by the sync writes, NOT a CHECK constraint —
-- column is nullable + leaving room for future channel types like 'sms'
-- without a schema bump):
--   'linkedin'      → HeyReach, single-channel Reply.io LinkedIn seqs
--   'email'         → Smartlead, single-channel Reply.io email seqs
--   'multichannel'  → Reply.io seqs with both linkedIn AND email steps
--   NULL            → unknown / not classified yet (Reply.io pre-resync,
--                     or a sequence that has neither email nor LinkedIn
--                     steps — e.g. structural-only — which we refuse to
--                     guess about)

ALTER TABLE public.synced_campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT;

-- Backfill: every existing heyreach row is LinkedIn by construction
-- (HeyReach is LinkedIn-only). Every smartlead row is email (Smartlead
-- is email-only). Reply.io rows are skipped — sync-reply-campaigns will
-- populate channel on the next run.
--
-- Idempotent: guards on `channel IS NULL` so re-applying this migration
-- doesn't overwrite values written by a subsequent sync.
UPDATE public.synced_campaigns
   SET channel = 'linkedin'
 WHERE source = 'heyreach'
   AND channel IS NULL;

UPDATE public.synced_campaigns
   SET channel = 'email'
 WHERE source = 'smartlead'
   AND channel IS NULL;
