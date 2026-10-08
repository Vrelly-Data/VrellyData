#!/usr/bin/env node
// DEV-ONLY end-to-end check for the Vrelly audience source.
//
//   node dev_vrelly_audience_e2e.mjs          preview only (no writes)
//   node dev_vrelly_audience_e2e.mjs --push   + create a throwaway audience and
//                                              run it twice against a PAUSED
//                                              Reply.io sequence
//
// Dev prospects are synthetic @example.com rows (a reserved, undeliverable
// domain) and the target sequence is paused, so nobody can be contacted.
// Authenticates as the dev user with a minted JWT (see
// memory dev-edge-function-auth-user-jwt) — the same path the browser uses.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REF = 'iqxzetwuxykplzdjysiu';
const USER_ID = '633c73b0-4864-4d74-bbb9-4727bf88c633';
const CONFIG_ID = '6c7b6c2f-5685-43ff-8eef-853bfc108420';
// "06/29 - Ravi Ideal Companies", PAUSED, Reply.io 1719208 — the established dev push target.
const CAMPAIGN_ID = '14f20d4b-d9ff-4875-b65d-3e31e7bc44f1';
const FILTERS = { job_titles: [process.env.TITLE ?? 'Chief Executive'], person_countries: ['United States'] };

const env = (file, key) => fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`))?.split('=', 2)[1]?.trim();
const SR = env('.env.local', 'SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('.env.development', 'VITE_SUPABASE_PUBLISHABLE_KEY');
const refOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).ref;
if (refOf(SR) !== REF || refOf(ANON) !== REF) { console.error('keys are not for dev — refusing'); process.exit(2); }

const sb = createClient(`https://${REF}.supabase.co`, SR, { auth: { persistSession: false } });
const { data: u } = await sb.auth.admin.getUserById(USER_ID);
const { data: link } = await sb.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
const anon = createClient(`https://${REF}.supabase.co`, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
const JWT = sess.session.access_token;

async function fn(name, body) {
  const t0 = Date.now();
  const res = await fetch(`https://${REF}.supabase.co/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, ms: Date.now() - t0 };
}
const fails = [];
const check = (label, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!ok) fails.push(label); };

console.log('1. preview');
const p1 = await fn('vrelly-audience-search', { filters: FILTERS, per_page: 25 });
check('preview 200', p1.status === 200, `HTTP ${p1.status} in ${p1.ms}ms`);
console.log(`     count=${p1.json.pagination?.total_entries} rows=${p1.json.people?.length} first=${p1.json.people?.[0]?.title} @ ${p1.json.people?.[0]?.company_name}`);
const p0 = await fn('vrelly-audience-search', { filters: { person_titles: ['CEO'] } });
check('Apollo-shaped filters refused with 400', p0.status === 400, p0.json.error);
const anonCall = await fetch(`https://${REF}.supabase.co/functions/v1/vrelly-audience-search`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ filters: FILTERS }),
});
check('anon (no user) refused with 401', anonCall.status === 401, `HTTP ${anonCall.status}`);
const direct = await anon.rpc('vrelly_audience_search', { p_user_id: USER_ID, p_query: { title_patterns: ['%a%'] } });
check('anon cannot call vrelly_audience_search directly', !!direct.error, direct.error?.code);
const mv = await anon.from('prospect_audience_search').select('id').limit(1);
check('anon cannot read the search index', !!mv.error, mv.error?.code);

if (!process.argv.includes('--push')) { console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed (preview only)'); process.exit(fails.length ? 1 : 0); }

console.log('\n2. throwaway audience');
const name = `DEV Vrelly E2E ${new Date().toISOString().slice(0, 16)}`;
const { data: aud, error: aerr } = await sb.from('agent_audiences').insert({
  user_id: USER_ID, agent_config_id: CONFIG_ID, name, source: 'vrelly', filters_version: 2, filters: FILTERS,
  max_per_run: 1, max_total: 1, cadence: 'manual', default_platform: 'reply.io', default_synced_campaign_id: CAMPAIGN_ID,
}).select().single();
check('audience created', !aerr, aerr?.message ?? aud.id);

console.log('\n3. run 1 (no person_ids — exactly what the schedule does)');
const r1 = await fn('run-agent-audience', { audience_id: aud.id, platform: 'reply.io', synced_campaign_id: CAMPAIGN_ID });
console.log(`     HTTP ${r1.status} in ${r1.ms}ms`, JSON.stringify({ ...r1.json, results: undefined }));
check('run 1 success', r1.status === 200 && r1.json.status === 'success');
check('run 1 pushed 1', r1.json.pushed === 1);
check('run 1 spent 0 credits, enriched nobody', r1.json.credits_spent === 0 && r1.json.enriched === 0);
const { data: pushes } = await sb.from('agent_audience_pushes').select('*').eq('audience_id', aud.id);
const push = pushes?.[0];
check('ledger row keyed by prospect_id, apollo_person_id null', !!push?.prospect_id && push?.apollo_person_id === null);
check('ledger row has email + linkedin keys and a Reply.io contact id', !!push?.email_key && !!push?.linkedin_key && !!push?.external_ref, `${push?.email_key} ${push?.linkedin_key} ref=${push?.external_ref}`);
const { data: runRow } = await sb.from('agent_audience_runs').select('*').eq('id', r1.json.run_id).single();
check('run row: source fields', runRow?.credits_spent === 0 && runRow?.status === 'success' && runRow?.reason === null);

console.log('\n4. contact as Reply.io stored it');
const { data: integ } = await sb.from('outbound_integrations').select('api_key_encrypted, synced_campaigns!inner(id)').eq('synced_campaigns.id', CAMPAIGN_ID).single();
const rc = await fetch(`https://api.reply.io/v3/contacts/${push.external_ref}`, { headers: { Authorization: `Bearer ${integ.api_key_encrypted}` } });
const contact = await rc.json().catch(() => ({}));
console.log(`     ${contact.email} | ${contact.firstName} ${contact.lastName} | title=${contact.title} | company=${contact.companyName ?? contact.company} | ${[contact.city, contact.state, contact.country].filter(Boolean).join(', ')} | li=${contact.linkedInProfileUrl ?? contact.linkedInUrl}`);
check('Reply.io kept title and location', !!contact.title && !!contact.city);
// Company is NOT asserted: this workspace has Reply.io's Accounts feature on,
// where company comes from the linked account and a direct value is ignored on
// create (and refused on PATCH: "Company cannot be updated directly because
// the accounts feature is enabled"). Verified 2026-10-08.
console.log(`     company=${contact.company} (Accounts feature: derived from the linked account, not settable)`);

console.log('\n5. run 2 — same audience, cap raised: the person already pushed must not come back');
await sb.from('agent_audiences').update({ max_total: 5, last_run_status: 'success' }).eq('id', aud.id);
const r2 = await fn('run-agent-audience', { audience_id: aud.id, platform: 'reply.io', synced_campaign_id: CAMPAIGN_ID });
console.log(`     HTTP ${r2.status}`, JSON.stringify({ ...r2.json, results: undefined }));
check('run 2 pushed 0', r2.status === 200 && r2.json.pushed === 0, r2.json.note);
const p2 = await fn('vrelly-audience-search', { filters: FILTERS });
check('preview now excludes the pushed person', p2.json.people?.length === 0 && p2.json.pagination?.total_entries === 0);

console.log(`\naudience ${aud.id} left in place (cap 5, manual) for inspection; prospect ${push?.prospect_id} is in paused sequence 1719208.`);
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall passed');
process.exit(fails.length ? 1 : 0);
