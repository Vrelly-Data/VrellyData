-- Per-user uniqueness on the natural identifiers for each channel.
-- Required because external_id ambiguously held either linkedin_url
-- (legacy webhook code) or heyreach_conversation_id (current code),
-- which let polling and the webhook produce parallel rows for the
-- same prospect when the format changed underneath them. The merge
-- of those duplicates was performed manually; these indexes make
-- the divergence impossible going forward.
--
-- Non-partial indexes — Postgres' default NULL semantics treat NULL
-- as distinct in unique indexes, so multiple email-only leads can
-- coexist with linkedin_url IS NULL, and multiple LinkedIn-only
-- leads with email_address IS NULL. The edge functions normalize
-- empty strings to NULL before writing so '' doesn't claim a
-- unique slot.
--
-- (Partial indexes were considered but supabase-js's `onConflict`
-- parameter does not propagate the WHERE predicate, so Postgres'
-- arbiter inference cannot match a partial index. Non-partial keeps
-- the upsert API working unchanged.)
--
-- Apply via Studio (NOT db push) because of the existing migration
-- backlog.

create unique index if not exists agent_leads_user_linkedin_unique
  on agent_leads (user_id, linkedin_url);

create unique index if not exists agent_leads_user_email_unique
  on agent_leads (user_id, email_address);
