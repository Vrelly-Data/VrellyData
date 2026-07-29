#!/usr/bin/env node
// ============================================================================
// test_sync_reply_contacts_nondestructive.mjs
//
// Guards the prod-safety guarantee of sync-reply-contacts firmographic
// enrichment. The functions under test are EXTRACTED FROM THE REAL SOURCE
// (supabase/functions/sync-reply-contacts/index.ts) rather than reimplemented,
// so this test cannot silently drift from what ships.
//
// Proves:
//   1. NON-DESTRUCTIVE  — a contact absent from the bulk workspace map keeps
//      its existing firmographics; a re-sync never nulls them.
//   2. PARTIAL PATCH    — a contact present with only SOME fields updates only
//      those fields; the untouched columns keep their stored values.
//   3. PAGINATION       — the walk fetches the FULL workspace, honouring
//      hasMore and retrying 429/5xx rather than treating them as "done".
//
// Tests 1-2 hit the DEV database (throwaway rows, cleaned up after).
// Test 3 stubs global fetch — no API quota consumed.
//
// Usage: DEV_KEY_FILE=<file with dev service_role key> node test_sync_reply_contacts_nondestructive.mjs
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SRC = 'supabase/functions/sync-reply-contacts/index.ts';
const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf('interface Firmo {');
const end = src.indexOf('Deno.serve(', start);
if (start < 0 || end < 0) { console.error('could not locate the firmographic block in source'); process.exit(1); }
const block =
  `const REPLY_API_V3 = "https://api.reply.io/v3";\n` +
  src.slice(start, end) +
  `\nexport { fetchWorkspaceFirmographics, applyFirmographics, cleanStr };\n`;
const js = execFileSync('node_modules/.bin/esbuild', ['--loader=ts', '--format=esm'], { input: block }).toString();
const { fetchWorkspaceFirmographics, applyFirmographics } =
  await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${label}`);
};

// ─── Tests 1 & 2: non-destructive write, against the dev database ──────────
const sb = createClient('https://iqxzetwuxykplzdjysiu.supabase.co',
  fs.readFileSync(process.env.DEV_KEY_FILE, 'utf8').trim(), { auth: { persistSession: false } });

const { data: camp } = await sb.from('synced_campaigns').select('id, team_id').limit(1).single();
const ABSENT = 'nondestructive-absent@vrelly-test.example';
const PARTIAL = 'nondestructive-partial@vrelly-test.example';
const cleanup = () => sb.from('synced_contacts').delete().eq('campaign_id', camp.id).in('email', [ABSENT, PARTIAL]);
await cleanup();

// Both rows start FULLY enriched, as a healthy prior sync would have left them.
const seeded = {
  campaign_id: camp.id, team_id: camp.team_id,
  industry: 'Real Estate', company_size: '11-50', domain: 'seed.example',
  city: 'Austin', state: 'TX', country: 'USA',
};
await sb.from('synced_contacts').insert([
  { ...seeded, email: ABSENT, external_contact_id: 'nd-absent', first_name: 'Absent' },
  { ...seeded, email: PARTIAL, external_contact_id: 'nd-partial', first_name: 'Partial' },
]);

// The roster this sync saw. ABSENT was NOT in the bulk workspace map, so it
// carries no firmographics at all (exactly the shape v3ToUnified produces for
// an unenriched contact). PARTIAL was in the map but the API only knew its
// industry and city.
const roster = [
  { id: '1', email: ABSENT,  firstName: 'Absent' },
  { id: '2', email: PARTIAL, firstName: 'Partial', industry: 'Biotechnology', city: 'Boston' },
];

const result = await applyFirmographics(sb, camp.id, camp.team_id, roster);
check('applyFirmographics touched only the enriched contact', [result.updated, result.skipped], [1, 1]);

const read = async (email) => (await sb.from('synced_contacts')
  .select('industry, company_size, domain, city, state, country')
  .eq('campaign_id', camp.id).eq('email', email).single()).data;

// 1. NON-DESTRUCTIVE: absent from the map => every firmographic survives.
check('1. contact absent from bulk map keeps ALL firmographics', await read(ABSENT),
  { industry: 'Real Estate', company_size: '11-50', domain: 'seed.example', city: 'Austin', state: 'TX', country: 'USA' });

// 2. PARTIAL PATCH: only industry + city move; company_size/domain/state/country untouched.
check('2. partially-enriched contact updates ONLY the supplied fields', await read(PARTIAL),
  { industry: 'Biotechnology', company_size: '11-50', domain: 'seed.example', city: 'Boston', state: 'TX', country: 'USA' });

// A second identical run must be a no-op, not a regression.
await applyFirmographics(sb, camp.id, camp.team_id, roster);
check('2b. re-running the same sync changes nothing', await read(ABSENT),
  { industry: 'Real Estate', company_size: '11-50', domain: 'seed.example', city: 'Austin', state: 'TX', country: 'USA' });

// An empty-string / "Empty" sentinel must not overwrite either.
await applyFirmographics(sb, camp.id, camp.team_id, [
  { id: '1', email: ABSENT, industry: '   ', company_size: 'Empty', country: '' },
]);
check('2c. blank / "Empty" sentinel values never overwrite', await read(ABSENT),
  { industry: 'Real Estate', company_size: '11-50', domain: 'seed.example', city: 'Austin', state: 'TX', country: 'USA' });

await cleanup();

// ─── Test 3: pagination walks the whole workspace ──────────────────────────
// Stub fetch with a 18,662-contact workspace (the real Avania size), injecting
// a 429 on page 3 and a 500 on page 7 to prove they are retried, not swallowed.
const WORKSPACE = 18_662;
const PAGE = 1000;
const injected = { 429: new Set([3]), 500: new Set([7]) };
const served = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const skip = Number(new URL(url).searchParams.get('skip'));
  const page = skip / PAGE;
  for (const [status, pages] of Object.entries(injected)) {
    if (pages.has(page)) {
      pages.delete(page); // fail once, then succeed on retry
      return new Response('throttled', { status: Number(status), headers: { 'retry-after': '0' } });
    }
  }
  const n = Math.max(0, Math.min(PAGE, WORKSPACE - skip));
  const items = Array.from({ length: n }, (_, i) => ({
    id: skip + i, email: `c${skip + i}@example.com`, industry: 'staffing & recruiting', companySize: '11-50',
  }));
  served.push(page);
  return new Response(JSON.stringify({ items, hasMore: skip + n < WORKSPACE }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};

const pull = await fetchWorkspaceFirmographics('fake-key');
globalThis.fetch = realFetch;

check('3. pagination fetches the FULL workspace count', pull.total, WORKSPACE);
check('3b. every contact landed in the email map', pull.byEmail.size, WORKSPACE);
check('3c. pull is reported complete', pull.incomplete, false);
check('3d. 429 and 5xx were retried, not treated as exhaustion', served.length, Math.ceil(WORKSPACE / PAGE));

// ─── Test 4: the roster upsert must not carry firmographic columns ────────
// This is the regression that caused the incident: the record builder set
// `industry: contact.industry || null` etc., so upsert-on-conflict UPDATEd
// them to NULL for every contact the bulk pull missed. Tests 1-2 exercise
// applyFirmographics, which cannot catch that column creeping back into the
// upsert payload — so guard the payload shape directly.
const FIRMO_COLUMNS = ['industry', 'company_size', 'domain', 'city', 'state', 'country'];
const recStart = src.indexOf('const records = batch.map(contact => {');
const recEnd = src.indexOf('});', recStart);
const recordBlock = src.slice(recStart, recEnd);
if (recStart < 0 || recEnd < 0) { failures++; console.log('FAIL 4. could not locate the roster record builder'); }
const leaked = FIRMO_COLUMNS.filter((col) => new RegExp(`^\\s*${col}\\s*:`, 'm').test(recordBlock));
check('4. roster upsert payload contains NO firmographic column', leaked, []);
if (leaked.length) {
  console.log(`     "${leaked.join('", "')}" is assigned in the roster upsert — on conflict it will NULL stored values.`);
  console.log('     Firmographics belong in applyFirmographics(), which only ever writes non-null values.');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
