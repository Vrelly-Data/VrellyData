-- Agent Audiences: Vrelly source (part 3 of 3) — indexes on the search views.
--
-- RUN OUTSIDE A TRANSACTION (psql autocommit; not in BEGIN/COMMIT, not via a
-- tool that wraps the file in one): CREATE INDEX CONCURRENTLY refuses to run
-- inside a transaction block. Each statement is its own transaction, and the
-- ledger row for this file is written only after all of them succeed.
--
-- These index the materialized views from 20261008150100, not public.prospects
-- itself — prospects gets no new index. CONCURRENTLY is used anyway so no
-- statement here ever takes a lock that blocks a reader.
--
-- prospect_audience_search_id_key / prospect_audience_keywords_id_key are the
-- unique indexes REFRESH MATERIALIZED VIEW CONCURRENTLY requires.

create unique index concurrently if not exists prospect_audience_search_id_key on public.prospect_audience_search (id);
create index concurrently if not exists prospect_audience_search_title_trgm on public.prospect_audience_search using gin (job_title gin_trgm_ops);
create index concurrently if not exists prospect_audience_search_industry_trgm on public.prospect_audience_search using gin (company_industry gin_trgm_ops);
create index concurrently if not exists prospect_audience_search_department_trgm on public.prospect_audience_search using gin (department gin_trgm_ops);
create index concurrently if not exists prospect_audience_search_seniority on public.prospect_audience_search (seniority_l);
create index concurrently if not exists prospect_audience_search_size on public.prospect_audience_search (company_size_l);
create index concurrently if not exists prospect_audience_search_country on public.prospect_audience_search (country_l);
create index concurrently if not exists prospect_audience_search_state on public.prospect_audience_search (state_l);
create index concurrently if not exists prospect_audience_search_company_country on public.prospect_audience_search (company_country_l);
create index concurrently if not exists prospect_audience_search_company_state on public.prospect_audience_search (company_state_l);
create unique index concurrently if not exists prospect_audience_keywords_id_key on public.prospect_audience_keywords (id);
create index concurrently if not exists prospect_audience_keywords_kw on public.prospect_audience_keywords using gin (kw);

-- VACUUM (not just ANALYZE) so the visibility map is set and the planner can
-- use index-only scans on the btree indexes. Also not allowed in a transaction.
vacuum (analyze) public.prospect_audience_search;
vacuum (analyze) public.prospect_audience_keywords;
