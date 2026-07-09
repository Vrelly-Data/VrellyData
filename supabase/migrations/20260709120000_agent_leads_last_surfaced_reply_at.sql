-- Surface watermark for inbox resurfacing.
--
-- last_surfaced_reply_at = the timestamp of the last inbound reply that
-- actually flipped the lead to inbox_status='pending'. The ingestion paths
-- (poll-reply-inbox + reply-webhook) compute "is this reply genuinely new?"
-- against THIS column, not last_reply_at.
--
-- Why: last_reply_at is written on EVERY ingest (it drives inbox ordering +
-- the reply preview), so using it as the resurface guard meant a reply that
-- was stored without surfacing (e.g. into a 'dismissed' thread) advanced the
-- watermark and could never resurface. Splitting the surface watermark out
-- fixes that: the display write no longer consumes the resurface guard.
--
-- Nullable + no backfill of the column itself — a NULL simply means "never
-- surfaced", so the first genuinely-new reply always surfaces. The separate
-- one-time rescue backfill sets it for currently-stuck threads it re-pends.
--
-- Run in dev then prod, then: NOTIFY pgrst, 'reload schema';

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS last_surfaced_reply_at TIMESTAMPTZ;
