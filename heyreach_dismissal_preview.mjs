// PREVIEW of the bulk HeyReach dismissal.
//
// Watermark rule (from this session's finding): agent_leads dedups on
// (user_id, linkedin_url), but HeyReach can hold SEVERAL conversations for one
// profile. The stored reply_thread is only whichever conversation was written
// last, so max(reply_thread.timestamp) UNDERSTATES what we have seen. The
// watermark must be max(lastMessageAt) across EVERY conversation sharing the
// url — the same quantity the poller's gate recomputes — or the sibling
// conversation re-surfaces the lead on the very next run.
//
// Ad-hoc investigation script from the 2026-08-13 HeyReach session. Read-only
// against the HeyReach API unless noted; nothing here writes to the database.
//
// Credentials (never hardcode):
//   PROD_DB='postgresql://postgres.lgnvolndyftsbcjprmic@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
//   export HR_KEY=$(psql "$PROD_DB" -Atc "select api_key_encrypted from outbound_integrations where platform='heyreach' and is_active;")
//
// Usage:  LEADS_FILE=pending.json OUT_FILE=dismiss_set.json HR_KEY=... \
//           node heyreach_dismissal_preview.mjs
//
// PREVIEW ONLY — writes OUT_FILE, touches no database. Buckets the pending
// HeyReach leads into dismiss / keep-recent / keep-empty-thread / keep-unmatched
// and computes each dismissal's correct watermark. Feed OUT_FILE to
// heyreach_dismissal_gen.mjs to emit the SQL.

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
console.log(`HeyReach conversations fetched: ${all.length}`);

const byUrl = new Map();               // url -> {maxMs, n, maxIso}
for (const c of all) {
  const u = (c.correspondentProfile?.profileUrl || '').trim();
  if (!u) continue;
  const ms = Date.parse(c.lastMessageAt || '');
  const cur = byUrl.get(u) || { maxMs: -1, n: 0, maxIso: null };
  cur.n++;
  if (Number.isFinite(ms) && ms > cur.maxMs) { cur.maxMs = ms; cur.maxIso = new Date(ms).toISOString(); }
  byUrl.set(u, cur);
}

const DAY = 24 * 60 * 60 * 1000, now = Date.now();
const buckets = { dismiss: [], keepEmptyThread: [], keepRecent: [], keepNoApiMatch: [] };

for (const L of leads) {
  if (L.thread_len === 0) { buckets.keepEmptyThread.push(L); continue; }
  const api = byUrl.get(L.linkedin_url);
  const threadMs = Date.parse(L.thread_newest || '');
  const apiMs = api ? api.maxMs : -1;
  const effMs = Math.max(threadMs || -1, apiMs);          // high-water across all sources
  if (!api) { buckets.keepNoApiMatch.push({ ...L, effMs }); continue; }
  if (effMs >= now - DAY) { buckets.keepRecent.push({ ...L, effMs }); continue; }
  buckets.dismiss.push({
    id: L.id, name: L.full_name, url: L.linkedin_url,
    convos: api.n,
    threadNewest: L.thread_newest,
    watermark: new Date(effMs).toISOString(),
    understated: apiMs > (threadMs || -1),
    ageDays: Math.round((now - effMs) / DAY),
  });
}

console.log(`\npending HeyReach leads considered : ${leads.length}`);
console.log(`  -> DISMISS                      : ${buckets.dismiss.length}`);
console.log(`  -> keep (empty reply_thread bug): ${buckets.keepEmptyThread.length}`);
console.log(`  -> keep (activity in last 24h)  : ${buckets.keepRecent.length}`);
console.log(`  -> keep (no HeyReach convo for url): ${buckets.keepNoApiMatch.length}`);

const understated = buckets.dismiss.filter(d => d.understated);
console.log(`\nleads whose watermark comes from a SIBLING conversation (would have re-surfaced if we used the stored thread alone): ${understated.length}`);
for (const u of understated) console.log(`   ${u.name.padEnd(28)} convos=${u.convos} thread=${u.threadNewest} -> watermark=${u.watermark}`);

const multi = buckets.dismiss.filter(d => d.convos > 1);
console.log(`\ndismiss set with >1 HeyReach conversation: ${multi.length}`);

const ages = buckets.dismiss.map(d => d.ageDays).sort((a,b)=>a-b);
console.log(`\nage of newest activity (days): min=${ages[0]} p50=${ages[Math.floor(ages.length/2)]} max=${ages[ages.length-1]}`);
console.log(`  <=7d: ${ages.filter(a=>a<=7).length}   8-30d: ${ages.filter(a=>a>7&&a<=30).length}   31-90d: ${ages.filter(a=>a>30&&a<=90).length}   >90d: ${ages.filter(a=>a>90).length}`);

console.log('\n--- KEEP: recent (last 24h) ---');
for (const k of buckets.keepRecent) console.log(`   ${k.full_name} — newest ${new Date(k.effMs).toISOString()} role=${k.newest_role}`);
console.log('\n--- KEEP: empty reply_thread (GetChatroom bug) ---');
for (const k of buckets.keepEmptyThread) console.log(`   ${k.full_name} — ${k.linkedin_url}`);
console.log('\n--- KEEP: no HeyReach conversation matched the url ---');
for (const k of buckets.keepNoApiMatch) console.log(`   ${k.full_name} — ${k.linkedin_url} thread_newest=${k.thread_newest}`);

fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(buckets.dismiss, null, 0));
console.log(`\nwrote ${buckets.dismiss.length} dismissal rows -> ${process.env.OUT_FILE}`);
