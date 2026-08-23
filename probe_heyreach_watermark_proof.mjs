//
// Ad-hoc investigation script from the 2026-08-13 HeyReach session. Read-only
// against the HeyReach API unless noted; nothing here writes to the database.
//
// Credentials (never hardcode):
//   PROD_DB='postgresql://postgres.lgnvolndyftsbcjprmic@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
//   export HR_KEY=$(psql "$PROD_DB" -Atc "select api_key_encrypted from outbound_integrations where platform='heyreach' and is_active;")
//
// Usage:  LEADS_FILE=leads.json HR_KEY=... node probe_heyreach_watermark_proof.mjs
//
// LEADS_FILE is a JSON array of agent_leads rows, e.g.
//   psql "$PROD_DB" -Atc "select jsonb_agg(jsonb_build_object(
//     'id',id,'full_name',full_name,'linkedin_url',linkedin_url,
//     'heyreach_conversation_id',heyreach_conversation_id,
//     'last_surfaced_reply_at',last_surfaced_reply_at,
//     'reply_thread',coalesce(reply_thread,'[]'::jsonb)))
//     from agent_leads where source='heyreach' and last_surfaced_reply_at is not null;" > leads.json
//
// Proves the collision explanation: for each lead it fetches EVERY conversation
// sharing the url and shows which one's newest message equals the stored
// watermark. 2026-08-13: 6/6 matched the SIBLING conversation, not the stored one.

import fs from 'node:fs';
const KEY = process.env.HR_KEY, API = 'https://api.heyreach.io/api/public';
const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));

const all = []; let offset = 0, total = null;
while (total === null || offset < total) {
  const r = await fetch(`${API}/inbox/GetConversationsV2`, { method: 'POST',
    headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ filters: { linkedInAccountIds: [], campaignIds: [], searchString: '' }, offset, limit: 100 }) });
  const d = await r.json(); const items = d.items || []; total = d.totalCount || 0;
  all.push(...items); offset += items.length; if (!items.length) break;
  await new Promise(s => setTimeout(s, 200));
}
const byUrl = new Map();
for (const c of all) { const u = (c.correspondentProfile?.profileUrl || '').trim(); if (u) { if (!byUrl.has(u)) byUrl.set(u, []); byUrl.get(u).push(c); } }
const newestOf = (a) => a.length ? a.reduce((x,y)=> Date.parse(y.timestamp||'') > Date.parse(x.timestamp||'') ? y : x) : null;

for (const L of leads) {
  const convos = byUrl.get(L.linkedin_url) || [];
  const sn = newestOf((L.reply_thread||[]).map(e=>({timestamp:e.timestamp, role:e.role})));
  console.log(`\n=== ${L.full_name} — ${convos.length} conversation(s) for ${L.linkedin_url}`);
  console.log(`    stored thread newest : ${sn?.timestamp ?? 'n/a'} (${sn?.role ?? '-'}, ${(L.reply_thread||[]).length} msgs)`);
  console.log(`    stored watermark     : ${L.last_surfaced_reply_at}`);
  for (const c of convos) {
    const cr = await fetch(`${API}/inbox/GetChatroom/${c.linkedInAccountId}/${c.id}`, { headers: { 'X-API-KEY': KEY, Accept: 'application/json' } });
    let msgs = [];
    if (cr.ok) { const j = await cr.json(); msgs = (j.messages||[]).map(m=>({timestamp:m.createdAt, role: m.sender==='ME'?'sender':'prospect'})); }
    const n = newestOf(msgs);
    const stored = c.id === L.heyreach_conversation_id;
    const eqW = n && Math.abs(Date.parse(n.timestamp) - Date.parse(L.last_surfaced_reply_at)) < 1000;
    console.log(`      ${stored?'>> STORED':'   other  '} acct=${c.linkedInAccountId} msgs=${msgs.length} newest=${n?.timestamp ?? 'EMPTY'} (${n?.role??'-'})${eqW?'   <<== EQUALS WATERMARK':''}`);
    await new Promise(s => setTimeout(s, 200));
  }
}
