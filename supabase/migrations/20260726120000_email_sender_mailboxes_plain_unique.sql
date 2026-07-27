-- Fix ON CONFLICT for email_sender_mailboxes upserts.
--
-- The original unique index was functional: (user_id, lower(mailbox_email)).
-- PostgREST/Postgres upsert with onConflict "user_id,mailbox_email" requires a
-- unique index on those EXACT columns, so the expression index didn't match →
-- 42P10 "no unique or exclusion constraint matching the ON CONFLICT
-- specification" → the sync 500'd on the first real Sync.
--
-- Fix: store mailbox_email already-lowercased (sync + webhook both lowercase),
-- and use a PLAIN unique index on (user_id, mailbox_email). Case-insensitivity
-- is preserved because every write is lowercased.
--
-- Run in dev then prod. (No PostgREST schema reload needed for an index swap.)

-- Normalize any existing rows to lowercase before the plain unique index.
-- (Table is empty today — the sync never succeeded — but this keeps the
-- migration correct if any rows exist.)
UPDATE public.email_sender_mailboxes
  SET mailbox_email = lower(mailbox_email)
  WHERE mailbox_email <> lower(mailbox_email);

DROP INDEX IF EXISTS public.idx_email_sender_mailboxes_user_mailbox;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sender_mailboxes_user_mailbox
  ON public.email_sender_mailboxes (user_id, mailbox_email);
