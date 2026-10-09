-- Agent Audiences, Vrelly source: data-quality fixes found in the first prod
-- preview of "Agent Upload" (2026-10-08). Part 1 of 2: builds the corrected
-- view under a NEW name; part 2 (20261008210100) indexes it concurrently and
-- swaps it in. The live view keeps serving until the swap.
--
-- Measured on prod 2026-10-08 (1,724,457 rows in prospect_audience_search):
--
-- 1. MULTIPLE EMAILS. 138,743 rows (8%) hold several addresses in
--    business_email ("a@x.co.uk, a@y.co.uk"). Pushed verbatim, Reply.io gets
--    one invalid address. email_key is now the FIRST address, and a row whose
--    first address is not a plausible email is left out (it could never be
--    pushed). The search now returns this address, not the raw column.
--
-- 2. COUNTRY. audience_lab rows carry country 'US' for people who are plainly
--    not in the US: 356,059 'US' rows have a non-US state (MH 88k, ENG 73k,
--    ON 24k, NSW 15k, ...). Two of the first ten "US" Agent Upload matches were
--    in England. A row whose country says US but whose state is not a US state
--    (code or name) now has country_l NULL — unknown — so a country=US filter
--    no longer picks it up. Rows with no state keep their country.
--
-- 3. EMAIL NOT AT THE COMPANY. When the prospect has a company_domain, the
--    chosen email's domain must equal it or be a subdomain of it (domains are
--    normalized: lower-case, no scheme, no www., no path). Rows without a
--    company_domain are kept. A 3% sample put the mismatch at 27% of rows with
--    a valid email; for Agent Upload it removed 883 of 2,508 matches. These
--    are the addresses most likely to be stale (a past employer) or wrong
--    person — in the first-10 preview, 3 of 10 were like this.
--
-- 4. FOREIGN EMAIL TLD, for US searches. email_foreign_cctld holds the email's
--    two-letter country-code TLD when it is not 'us' and not one of the ccTLDs
--    used generically by US companies (io co ai me tv ly so fm gg sh cc to ws
--    la vc). vrelly_audience_search excludes those rows when the person-country
--    filter is US only (part 2). Agent Upload: removed 287 of 2,508.
--
-- 5. Job titles move to whole-word matching; that is the function change in
--    part 2 (substring "cto" matched 204,950 titles, as a word 9,938).
--
-- Reading prospects takes only ACCESS SHARE; nothing that writes it waits.

create or replace function public.audience_is_us_state(p_state text)
returns boolean
language sql
immutable
parallel safe
as $$
  select lower(btrim(p_state)) = any (array['al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'pr', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'puerto rico', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming']);
$$;

do $mv$
begin
  if to_regclass('public.prospect_audience_search_next') is null then
    create materialized view public.prospect_audience_search_next as
    select p.id,
           p.job_title,
           lower(btrim(p.seniority))        as seniority_l,
           p.department,
           p.company_industry,
           lower(btrim(p.company_size))     as company_size_l,
           case
             when lower(btrim(p.country)) in ('us', 'usa', 'united states', 'united states of america', 'u.s.', 'u.s.a.')
                  and nullif(btrim(p.state), '') is not null
                  and not public.audience_is_us_state(p.state)
               then null
             else lower(btrim(p.country))
           end                              as country_l,
           lower(btrim(p.state))            as state_l,
           lower(btrim(p.company_country))  as company_country_l,
           lower(btrim(p.company_state))    as company_state_l,
           e.email_key,
           public.audience_linkedin_key(p.linkedin_url) as linkedin_key,
           case
             when substring(d.email_domain from '\.([a-z]{2})$') <> all (array[
                    'us', 'io', 'co', 'ai', 'me', 'tv', 'ly', 'so', 'fm', 'gg', 'sh', 'cc', 'to', 'ws', 'la', 'vc'])
               then substring(d.email_domain from '\.([a-z]{2})$')
           end                              as email_foreign_cctld
    from public.prospects p
    cross join lateral (
      select lower(split_part(regexp_replace(btrim(p.business_email), '[[:space:],;]+', ',', 'g'), ',', 1)) as email_key
    ) e
    cross join lateral (
      select split_part(e.email_key, '@', 2) as email_domain,
             nullif(split_part(regexp_replace(regexp_replace(lower(btrim(p.company_domain)), '^[a-z]+://', ''), '^www\.', ''), '/', 1), '') as company_domain
    ) d
    where e.email_key ~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[a-z]{2,}$'
      and (d.company_domain is null
           or d.email_domain = d.company_domain
           or d.email_domain like '%.' || d.company_domain)
    order by p.id;
  end if;
end
$mv$;

revoke all on public.prospect_audience_search_next from public, anon, authenticated;
