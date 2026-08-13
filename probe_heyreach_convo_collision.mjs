//
// Ad-hoc investigation script from the 2026-08-13 HeyReach session. Read-only
// against the HeyReach API unless noted; nothing here writes to the database.
//
// Credentials (never hardcode):
//   PROD_DB='postgresql://postgres.lgnvolndyftsbcjprmic@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
//   export HR_KEY=$(psql "$PROD_DB" -Atc "select api_key_encrypted from outbound_integrations where platform='heyreach' and is_active;")
//
// Usage:  HR_KEY=... node probe_heyreach_convo_collision.mjs
//
// Answers: how many LinkedIn profiles have more than one HeyReach conversation?
// This is the root of the (user_id, linkedin_url) collision — agent_leads can
// only hold one conversation per profile. 2026-08-13: 73 urls / 147 convos.

// Probe: does the same LinkedIn profileUrl appear in more than one HeyReach
// conversation? A collision would explain the watermark discrepancy, since
// agent_leads dedups on (user_id, linkedin_url).
const KEY = process.env.HR_KEY;
const API = 'https://api.heyreach.io/api/public';
const all = [];
let offset = 0, total = null;
while (total === null || offset < total) {
  const res = await fetch(`${API}/inbox/GetConversationsV2`, {
    method: 'POST',
    headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ filters: { linkedInAccountIds: [], campaignIds: [], searchString: '' }, offset, limit: 100 }),
  });
  if (!res.ok) { console.error('API', res.status, await res.text()); process.exit(1); }
  const d = await res.json();
  const items = d.items || [];
  total = d.totalCount || 0;
  all.push(...items);
  offset += items.length;
  if (items.length === 0) break;
  await new Promise(r => setTimeout(r, 250));
}
console.log(`fetched ${all.length} conversations (totalCount=${total})`);

const byUrl = new Map();
for (const c of all) {
  const url = (c.correspondentProfile?.profileUrl || '').trim();
  if (!url) continue;
  if (!byUrl.has(url)) byUrl.set(url, []);
  byUrl.get(url).push(c);
}
const dupes = [...byUrl.entries()].filter(([, v]) => v.length > 1);
console.log(`distinct profileUrls: ${byUrl.size}, urls with >1 conversation: ${dupes.length}`);
console.log(`conversations involved in a collision: ${dupes.reduce((n, [, v]) => n + v.length, 0)}`);

const TARGETS = ['lisa-williams-58989a206','kimmorello','david-shaw-092a852','luke-antal'];
console.log('\n--- collision detail (first 12) ---');
for (const [url, convos] of dupes.slice(0, 12)) {
  console.log(`\n${url}  (${convos.length} conversations)`);
  for (const c of convos) {
    console.log(`   id=${String(c.id).slice(0,30)} acct=${c.linkedInAccountId} sender=${c.lastMessageSender} text="${String(c.lastMessageText||'').replace(/\s+/g,' ').slice(0,60)}"`);
  }
}
console.log('\n--- targets ---');
for (const t of TARGETS) {
  const hits = [...byUrl.entries()].filter(([u]) => u.toLowerCase().includes(t.toLowerCase()));
  console.log(`\n${t}: ${hits.reduce((n,[,v])=>n+v.length,0)} conversation(s) across ${hits.length} url(s)`);
  for (const [u, cs] of hits) for (const c of cs) {
    console.log(`   url=${u} id=${String(c.id).slice(0,30)} acct=${c.linkedInAccountId} sender=${c.lastMessageSender} text="${String(c.lastMessageText||'').replace(/\s+/g,' ').slice(0,70)}"`);
  }
}
console.log('\nsample convo keys:', Object.keys(all[0] || {}).join(', '));
