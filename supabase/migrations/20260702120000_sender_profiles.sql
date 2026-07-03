-- Multiple sender profiles per client.
--
-- Multi-sender clients (e.g. an agency running one workspace with several
-- LinkedIn senders) need drafts written in the voice of whichever sender owns
-- the thread. agent_leads.reply_thread already records the sender's display name
-- on each role:'sender' message as `fromName` (confirmed values like
-- "Ravi Rathod", "Emma Grace", "Gwen Kidd"). classify-reply matches that name
-- (case-insensitive, trimmed) to a row here and injects the profile's identity
-- into the draft prompt.
--
-- The existing agent_configs.sender_* fields are UNCHANGED and remain the
-- fallback when a client has no profiles (single-sender clients keep working
-- exactly as today). No backfill — profiles are entered manually.
--
-- sender_name matches reply_thread fromName. RLS mirrors agent_configs:
-- user-scoped via auth.uid() = user_id (FOR ALL). team_id is a nullable
-- denormalization column (agent_configs itself is user-scoped, so RLS keys on
-- user_id only — consistent with how config is scoped today).

CREATE TABLE IF NOT EXISTS public.sender_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id             UUID,
  sender_name         TEXT NOT NULL,
  job_title           TEXT,
  linkedin_url        TEXT,
  bio                 TEXT,
  communication_style TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One profile per (client, sender name). Matching in classify-reply is
  -- case-insensitive/trimmed; this constraint is exact-match, so it prevents
  -- literal duplicates (operators should keep names canonical, e.g. "Emma Grace").
  UNIQUE (user_id, sender_name)
);

-- Lookup path: fetch a client's profiles, then match by sender_name in code.
CREATE INDEX IF NOT EXISTS idx_sender_profiles_user_id
  ON public.sender_profiles(user_id);

ALTER TABLE public.sender_profiles ENABLE ROW LEVEL SECURITY;

-- Idempotent policy create (mirrors the draft_audit / agent_configs pattern).
DO $$
BEGIN
  CREATE POLICY "Users manage own sender profiles"
    ON public.sender_profiles
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
