#!/usr/bin/env node
// DEV-ONLY end-to-end check for Signals (iqxzetwuxykplzdjysiu). Requires the 3
// signals migrations + dev_signals_seed.sql applied, and the 8 functions deployed.
//
// 1. Test users, each in its own team (all @example.com, no integrations):
//      signals-admin-dev   platform admin
//      signals-client-dev  client with the Agent plan (sees Agent → Signals)
//      signals-other-dev   a second client team
// 2. Dev-only watchlists (the same PostgREST update the admin editor makes):
//      saas_hiring: Greenhouse airbnb, Lever palantir, Ashby ramp
//      github_activity: org supabase + one search query
// 3. Pixel: a site per client team, a few hits each through the public 'track'
// 4. ONE dispatcher call (as the admin) — every source is due on its first run
// 5. Prints row counts per source, the run log, the dispatcher's next selection,
//    and checks visibility through PostgREST as each client (RLS, not the UI).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REF = 'iqxzetwuxykplzdjysiu';
const env = (file, key) => fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`))?.split('=', 2)[1]?.trim();
const SR = env('.env.local', 'SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('.env.development', 'VITE_SUPABASE_PUBLISHABLE_KEY');
const refOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).ref;
if (refOf(SR) !== REF || refOf(ANON) !== REF) { console.error('keys are not for dev — refusing'); process.exit(2); }
const URL_ = `https://${REF}.supabase.co`;
const admin = createClient(URL_, SR, { auth: { persistSession: false } });

const fails = [];
const check = (label, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== '' ? `  (${detail})` : ''}`); if (!ok) fails.push(label); };
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

// ---- 1. users + teams -------------------------------------------------------
const USERS = {
  admin: { email: 'signals-admin-dev@example.com', team: 'Signals Admin Dev Team', isAdmin: true },
  client: { email: 'signals-client-dev@example.com', team: 'Signals Client Dev Team', agent: true },
  other: { email: 'signals-other-dev@example.com', team: 'Signals Other Dev Team', agent: true },
};
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
for (const u of Object.values(USERS)) {
  const found = list.users.find((x) => x.email === u.email);
  u.id = found?.id ?? must(await admin.auth.admin.createUser({ email: u.email, email_confirm: true }), 'createUser').user.id;
  must(await admin.from('profiles').upsert({ id: u.id, name: u.team.replace(' Team', ''), is_platform_admin: !!u.isAdmin }), 'profile');
  const { data: mem } = await admin.from('team_memberships').select('team_id, teams(name)').eq('user_id', u.id);
  const mine = (mem ?? []).find((m) => m.teams?.name === u.team);
  if (mine) u.teamId = mine.team_id;
  else {
    u.teamId = must(await admin.from('teams').insert({ name: u.team }).select('id').single(), 'team').id;
    must(await admin.from('team_memberships').insert({ user_id: u.id, team_id: u.teamId, role: 'admin' }), 'membership');
  }
  // exactly one team per test user, so signals_my_team_id() is unambiguous
  must(await admin.from('team_memberships').delete().eq('user_id', u.id).neq('team_id', u.teamId), 'extra memberships');
  if (u.agent) {
    must(await admin.from('user_credits').upsert({ user_id: u.id, plan: 'agent', subscription_status: 'active' }, { onConflict: 'user_id' }), 'credits');
    const { data: cfg } = await admin.from('agent_configs').select('id').eq('user_id', u.id).maybeSingle();
    if (!cfg) {
      must(await admin.from('agent_configs').insert({
        user_id: u.id, company_name: u.team.replace(' Team', ''), sender_name: 'Dev Tester', offer_description: 'Signals dev test',
        desired_action: 'Book a call', communication_style: 'conversational', mode: 'copilot', is_active: false, onboarding_complete: true,
      }), 'agent_config');
    }
  }
}
console.log('users:', Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, `${u.id} team ${u.teamId}`])));

async function sessionFor(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw error;
  return data.session;
}
const asUser = (session) => createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${session.access_token}` } } });
const S = { admin: await sessionFor(USERS.admin.email), client: await sessionFor(USERS.client.email), other: await sessionFor(USERS.other.email) };
fs.writeFileSync(process.env.SIGNALS_SESSIONS_FILE ?? 'signals_dev_sessions.json', JSON.stringify(S)); // for dev_signals_screenshots.mjs (dev only, short-lived; not committed)
const db = { admin: asUser(S.admin), client: asUser(S.client), other: asUser(S.other) };

// ---- 2. dev watchlists via the admin's own session (same path as the UI) ----
const setConfig = async (key, patch) => {
  const { config } = must(await db.admin.from('signal_sources').select('config').eq('key', key).single(), `read ${key}`);
  must(await db.admin.from('signal_sources').update({ config: { ...config, ...patch } }).eq('key', key), `update ${key}`);
};
await setConfig('saas_hiring', { boards: [
  { ats: 'greenhouse', token: 'airbnb', company_name: 'Airbnb', company_domain: 'airbnb.com' },
  { ats: 'lever', token: 'palantir', company_name: 'Palantir', company_domain: 'palantir.com' },
  { ats: 'ashby', token: 'ramp', company_name: 'Ramp', company_domain: 'ramp.com' },
] });
await setConfig('github_activity', { orgs: [{ login: 'supabase', company_domain: 'supabase.com' }], search_queries: ['topic:sales-automation'] });

// ---- 3. pixel sites + hits --------------------------------------------------
const site = async (who, domain) => must(await db[who].rpc('signals_register_site', { p_domain: domain }), `site ${domain}`);
const clientSite = await site('client', 'signals-client.example');
const otherSite = await site('other', 'signals-other.example');
const hit = async (siteKey, url, anon) => {
  const res = await fetch(`${URL_}/functions/v1/track`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ site_key: siteKey, url, referrer: 'https://www.google.com/', ts: new Date().toISOString(), anon_id: anon }),
  });
  return res.status;
};
console.log('\npixel hits');
const codes = [
  await hit(clientSite.site_key, 'https://signals-client.example/', 'devvisitor0001'),
  await hit(clientSite.site_key, 'https://signals-client.example/pricing', 'devvisitor0001'),
  await hit(clientSite.site_key, 'https://www.signals-client.example/demo', 'devvisitor0001'),
  await hit(clientSite.site_key, 'https://signals-client.example/blog/post', 'devvisitor0002'),
  await hit(otherSite.site_key, 'https://signals-other.example/pricing', 'devvisitor0003'),
];
check('track accepted 5 hits (204)', codes.every((c) => c === 204), codes.join(','));
check('track refuses a page off the site\'s domain (403)', (await hit(clientSite.site_key, 'https://evil.example/', 'devvisitor0009')) === 403);
check('track refuses an unknown site (404)', (await hit('vs_' + '0'.repeat(32), 'https://signals-client.example/', 'devvisitor0009')) === 404);

// ---- 4. one dispatcher run --------------------------------------------------
console.log('\ndispatcher (first run: every source due)');
const dry = await fetch(`${URL_}/functions/v1/dispatch-signal-sources`, { method: 'POST', headers: { Authorization: `Bearer ${S.admin.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }) }).then((r) => r.json());
console.log('  due before:', dry.due?.join(', '));
const t0 = Date.now();
const run = await fetch(`${URL_}/functions/v1/dispatch-signal-sources`, { method: 'POST', headers: { Authorization: `Bearer ${S.admin.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
console.log(`  ran in ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
for (const r of run.ran ?? []) console.log(`    ${r.source.padEnd(18)} http=${r.http} status=${r.status} inserted=${r.inserted}${r.error ? ` error=${r.error}` : ''}`);
check('every source ran without failing', (run.ran ?? []).length === 5 && run.ran.every((r) => ['success', 'partial'].includes(r.status)));
const dry2 = await fetch(`${URL_}/functions/v1/dispatch-signal-sources`, { method: 'POST', headers: { Authorization: `Bearer ${S.admin.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }) }).then((r) => r.json());
console.log('  due right after (realtime rollup only):', dry2.due?.join(', ') || '(none)');
check('daily sources not due again right after their run', !dry2.due?.some((k) => k !== 'web_visitors'));

// ---- 5. counts, run log, RLS ------------------------------------------------
console.log('\nrow counts per source (signals_admin_source_stats, as admin)');
const stats = must(await db.admin.rpc('signals_admin_source_stats'), 'stats');
for (const s of stats) console.log(`    ${s.source_key.padEnd(18)} total=${s.total} 7d=${s.d7} 30d=${s.d30}`);
const count = (k) => stats.find((s) => s.source_key === k)?.total ?? 0;
check('510(k) signals ingested', count('openfda_510k') > 0, count('openfda_510k'));
check('PE: one signal per synthetic interested person (36)', count('pe_seller_intent') === 36, count('pe_seller_intent'));
check('web visitors rolled up: 3 visitor-days', count('web_visitors') === 3, count('web_visitors'));

console.log('\nrun log (latest per source)');
const runs = must(await db.admin.from('signal_runs').select('source_key, status, fetched, inserted, updated, deduped, error, started_at, finished_at').order('started_at', { ascending: false }).limit(10), 'runs');
for (const r of runs) console.log(`    ${r.started_at.slice(0, 19)} ${r.source_key.padEnd(18)} ${r.status.padEnd(8)} fetched=${r.fetched} inserted=${r.inserted} updated=${r.updated} deduped=${r.deduped}${r.error ? ` error=${r.error.slice(0, 120)}` : ''}`);

console.log('\nvisibility through PostgREST (RLS)');
const n = async (who, q) => (await q(db[who].from('signals').select('id', { count: 'exact', head: true }))).count ?? 0;
check('client reads 510(k) signals', (await n('client', (q) => q.eq('source_key', 'openfda_510k'))) === count('openfda_510k'));
check('client reads NO PE signals', (await n('client', (q) => q.eq('source_key', 'pe_seller_intent'))) === 0);
check('client reads its own site\'s visitors (2)', (await n('client', (q) => q.eq('source_key', 'web_visitors'))) === 2);
check('other team reads only its own visitor (1)', (await n('other', (q) => q.eq('source_key', 'web_visitors'))) === 1);
check('admin reads every PE signal', (await n('admin', (q) => q.eq('source_key', 'pe_seller_intent'))) === 36);
const ov = must(await db.client.rpc('signals_overview'), 'overview');
check('client overview has no private_equity tab', !ov.some((v) => v.vertical === 'private_equity'), ov.map((v) => v.vertical).join(','));
const peId = must(await db.admin.from('signals').select('id').eq('source_key', 'pe_seller_intent').limit(1).single(), 'pe id').id;
check('client cannot set status on a PE signal', must(await db.client.rpc('signals_set_status', { p_signal_ids: [peId], p_status: 'dismissed' }), 'status') === 0);
const { error: srcErr, data: srcRows } = await db.client.from('signal_sources').select('key');
check('client cannot read source config', !srcErr && (srcRows ?? []).length === 0);
const { error: upErr } = await db.client.rpc('signals_upsert', { p_source_key: 'openfda_510k', p_rows: [] });
check('client cannot call signals_upsert', !!upErr);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall passed');
process.exit(fails.length ? 1 : 0);
