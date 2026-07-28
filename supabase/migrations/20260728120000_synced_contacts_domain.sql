-- Add company domain to synced_contacts.
--
-- Reply.io's full contact object (GET /v3/contacts) carries `domain` alongside
-- industry / companySize / location. sync-reply-contacts now enriches the
-- sequence roster from the bulk /v3/contacts list; store the domain too (shown
-- in the Reply.io UI, useful for firmographic reporting later).
--
-- Run in dev then prod, then: NOTIFY pgrst, 'reload schema';

ALTER TABLE public.synced_contacts
  ADD COLUMN IF NOT EXISTS domain text;
