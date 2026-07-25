-- Email sender ↔ mailbox mapping (many mailboxes → one sender).
--
-- For email-heavy Smartlead clients, one real sender sends from MANY mailboxes
-- (deliverability). Attributing a reply to the sender (not the mailbox) keeps
-- the pipeline sender filter + draft voice sane instead of exploding to one
-- "sender" per mailbox. Each mailbox maps to a sender_profiles.sender_name;
-- unmatched from_names sit unmapped (sender_name NULL) for operator review.
--
-- Populated by sync-smartlead-email-accounts (auto-map by from_name == sender
-- name) and read by smartlead-webhook (attribute a reply on any mailbox to its
-- sender). Owner-scoped; the syncs/webhook run under the service role.
--
-- Run in dev then prod, then: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.email_sender_mailboxes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mailbox_email text NOT NULL,          -- the Smartlead sending mailbox
  from_name    text,                    -- that mailbox's Smartlead sending name
  sender_name  text,                    -- maps to sender_profiles.sender_name; NULL = unmapped
  source       text NOT NULL DEFAULT 'smartlead',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per (client, mailbox).
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sender_mailboxes_user_mailbox
  ON public.email_sender_mailboxes (user_id, lower(mailbox_email));
-- Fast lookup of the unmapped review bucket.
CREATE INDEX IF NOT EXISTS idx_email_sender_mailboxes_unmapped
  ON public.email_sender_mailboxes (user_id)
  WHERE sender_name IS NULL;

ALTER TABLE public.email_sender_mailboxes ENABLE ROW LEVEL SECURITY;

-- Owner CRUD (the syncs + webhook use the service role, which bypasses RLS).
DROP POLICY IF EXISTS "Owners manage their email_sender_mailboxes" ON public.email_sender_mailboxes;
CREATE POLICY "Owners manage their email_sender_mailboxes"
  ON public.email_sender_mailboxes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
