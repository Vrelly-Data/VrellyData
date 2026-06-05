# Vrelly — Deploy & Environments

How to push changes from dev to production, and what's automated vs. manual.
Last verified 2026-06-05. Pipeline run #1 deployed all edge functions to dev.

## The two environments

| | DEV | PROD |
|---|---|---|
| Supabase ref | iqxzetwuxykplzdjysiu | lgnvolndyftsbcjprmic |
| Supabase name | Vrelly-Data-Dev | Vrelly Data |
| Git branch | dev | main |
| Vercel | Preview (vrelly-git-dev-myallbuds-projects.vercel.app) | Production (www.vrelly.com) |
| Stripe | Test mode (sk_test_, pk_test_) | Live mode |

Dev is fully isolated: own database, own Stripe (test mode), own secrets.

## What deploys automatically vs manually

| Layer | Dev (push to dev) | Prod (push to main) |
|---|---|---|
| Frontend | Vercel auto Preview | Vercel auto Production |
| Edge functions | GitHub Actions auto | GitHub Actions, AFTER approval gate |
| DB migrations | MANUAL (supabase db push) | MANUAL (supabase db push) |

## Everyday workflow

1. Work on the dev branch.
2. git push origin dev  -> Actions auto-deploys functions to DEV; Vercel rebuilds dev Preview.
3. Test at the dev URL. Test users: lowbalance@example.com / quotacrosser@example.com, password TestPass1234!
4. Promote: PR dev -> main, merge/push. The main push PAUSES at the production approval gate.
   Actions tab -> pending run -> Review deployments -> Approve. Functions deploy to prod; Vercel ships frontend.
5. If the change had a new migration, run it to prod manually:
   supabase db push --project-ref lgnvolndyftsbcjprmic
   then re-link to dev: supabase link --project-ref iqxzetwuxykplzdjysiu

## Manual commands

- Deploy all functions to DEV:   bash dev_deploy_functions.sh
- Deploy specific functions:     supabase functions deploy NAME --project-ref REF
- Set a secret:                  supabase secrets set KEY=value --project-ref REF
- List secrets (names only):     supabase secrets list --project-ref REF
- Push migrations:               supabase db push --project-ref REF
- Migration state:               supabase migration list --linked

## The pipeline

- File: .github/workflows/deploy.yml (runs on push to dev or main).
- Branch mapping: main -> production env, else -> develop env.
- production env has Required reviewers (myallbud) = the prod approval gate.
- Secret: SUPABASE_ACCESS_TOKEN (repo secret). Functions-only; does NOT run db push.

## Before automating migrations (precondition)

1. Resolve the 20260412 / 20260413 migration-ledger collision. Files were renamed
   to 20260412000001_* and 20260412000002_* and committed, but dev's ledger still
   records old 20260412. Do rename + 'supabase migration repair --status reverted
   20260412 --linked' as ONE unit, then db push. Renamed files are idempotent.
   Investigate 20260413 too.
2. Verify PROD's migration ledger is clean before automating db push.
   Then add db push back to deploy.yml + set SUPABASE_DB_PASSWORD as an ENVIRONMENT
   secret on both develop (dev pw) and production (prod pw).

## Parked cleanup (non-blocking)

- TIER_CONFIG prod product IDs in stripe-webhook -> move to env (same class as Agent fix, commit 2c9dc08).
- Rotate the test Stripe key (sk_test_) — exposed in transcript/history. Stripe -> API keys -> Roll.
- gitignore supabase/.temp/* (CLI cache). Decide if prod_schema.sql belongs in repo (leaks table shape).
- Bump GitHub Actions off Node 20 (checkout@v4, setup-cli@v1) when convenient.

## Safety invariants

- Prod actions always use explicit prod ref (lgnvolndyftsbcjprmic).
- Keep the production approval gate enabled.
- Never put live keys in dev, or test keys in prod.
- Vercel env vars scoped per-environment (Preview=dev creds, Production=prod creds), never "All Environments".
