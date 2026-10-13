-- Signals, phase 2, part 2 of 2: the prospects indexes the company match uses.
--
-- RUN OUTSIDE A TRANSACTION (psql autocommit): CREATE INDEX CONCURRENTLY
-- refuses to run inside one. Record the ledger row after both succeed.
--
-- signals_resolve_people (part 1) finds a signal's company in public.prospects
-- by signals_domain_key(company_domain), or by signals_company_name_key(
-- company_name) + state when the signal has no domain. Neither had an index
-- (prospects: 1.91M rows, 4.4 GB, 92% with a company_domain, measured
-- 2026-10-13), so each lookup would scan the table. Expression indexes on the
-- base table, rather than columns on prospect_audience_search, so a match is
-- never older than the prospect row; the #107 guards still come from
-- prospect_audience_search, joined on id.
--
-- CONCURRENTLY takes SHARE UPDATE EXCLUSIVE: writes to prospects continue.

create index concurrently if not exists idx_prospects_signals_domain_key
  on public.prospects (public.signals_domain_key(company_domain));

create index concurrently if not exists idx_prospects_signals_name_key
  on public.prospects (public.signals_company_name_key(company_name));
