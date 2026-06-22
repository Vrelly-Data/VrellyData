-- Add 'mirrored' to agent_leads.inbox_status.
--
-- 'mirrored' is a NON-ACTIONABLE status for all-time reply mirroring:
-- poll-reply-inbox now writes replies older than 7 days as 'mirrored' so they
-- surface as Data Playground data (RespondersList keys off last_reply_at) but
-- do NOT appear in the agent's actionable inbox. get-agent-inbox's actionable
-- groups are PENDING_APPROVAL_STATUSES=['pending','draft_ready'] and
-- TOTAL_INBOX_STATUSES=['sent','replied','dismissed'] — 'mirrored' is in
-- neither, so the agent never drafts/sends against a mirrored lead. Recent
-- (<=7d) replies remain 'pending'.
--
-- This migration also FORMALIZES 'replied' in the allowed set. 'replied' has
-- been written by the HeyReach/Smartlead senders (send-heyreach-message,
-- send-smartlead-email, add-to-{heyreach,smartlead}-campaign) since before
-- this migration, yet the original phase-2 CHECK (20260403120000) omitted it.
-- That means the check was either absent or unenforced on the live tables
-- (those writes would otherwise have failed). Re-establishing the FULL known
-- set makes the constraint both correct and enforceable going forward —
-- omitting 'replied' here would turn those existing writes into hard errors.
--
-- Idempotent: drop the prior auto-named column check (Postgres names an inline
-- column CHECK as <table>_<column>_check), then re-add the complete set. The
-- ADD validates existing rows; every value the codebase writes is included, so
-- validation cannot fail on current data.

ALTER TABLE public.agent_leads
  DROP CONSTRAINT IF EXISTS agent_leads_inbox_status_check;

ALTER TABLE public.agent_leads
  ADD CONSTRAINT agent_leads_inbox_status_check
  CHECK (inbox_status IN (
    'pending',
    'draft_ready',
    'approved',
    'sent',
    'dismissed',
    'replied',
    'mirrored'
  ));
