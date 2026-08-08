-- organizations: decouple from auth.users + add CRM contact fields.
--
-- WHY user_id BECOMES NULLABLE
-- ---------------------------
-- organizations.user_id is NOT NULL with no default and a FK to auth.users, so
-- every organization had to be bound 1:1 to an existing account. That made the
-- table unusable as a CRM: you cannot record a prospect or a client who has not
-- signed up yet, which is exactly what the Admin -> Organizations tab needs in
-- order to hold rows at all (it is currently empty, and "Sync billing" only
-- UPDATEs existing rows — sync-org-billing/index.ts:86-110 — so it can never
-- create the first one).
--
-- The UNIQUE (user_id) constraint is INTENTIONALLY KEPT. Postgres treats NULLs
-- as distinct in a unique index, so any number of organizations may have a NULL
-- user_id while the 1:1 guarantee still holds for every org that IS linked to
-- an account. That is precisely the semantics we want: "at most one org per
-- user", not "every org has a user".
--
-- The FK (ON DELETE RESTRICT) is also kept and still applies to non-NULL values.
--
-- NEW COLUMNS
-- -----------
-- first_name / last_name are ADDITIVE — contact_name/contact_email/contact_phone
-- are untouched and remain what the Contact column renders today. The split
-- fields are for imports that already carry them separately; nothing is
-- migrated or derived between the two, so no existing row changes meaning.
--
-- All four are nullable text with no default: every existing row stays valid,
-- and this migration cannot fail on current data (prod holds 0 organizations
-- rows at time of writing; dev holds 1 pre-existing test row, which the
-- DROP NOT NULL and the additive columns both leave untouched).
--
-- Safe to re-run: every statement is IF EXISTS / IF NOT EXISTS or idempotent.
-- Run in dev, verify, then prod. NOTIFY refreshes PostgREST's schema cache so
-- the new columns are selectable.

ALTER TABLE public.organizations
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS first_name   TEXT,
  ADD COLUMN IF NOT EXISTS last_name    TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS domain       TEXT;

COMMENT ON COLUMN public.organizations.user_id IS
  'Optional 1:1 link to auth.users. NULL = a CRM record with no platform '
  'account yet. UNIQUE still enforces at most one organization per user, '
  'since NULLs are distinct in a Postgres unique index.';
COMMENT ON COLUMN public.organizations.first_name IS
  'Split contact first name. Additive — contact_name remains the display field.';
COMMENT ON COLUMN public.organizations.last_name IS
  'Split contact last name. Additive — contact_name remains the display field.';
COMMENT ON COLUMN public.organizations.linkedin_url IS
  'Contact or company LinkedIn URL. Stored verbatim; not normalized or deduped.';
COMMENT ON COLUMN public.organizations.domain IS
  'Company web domain. Stored verbatim; not normalized or deduped.';

NOTIFY pgrst, 'reload schema';
