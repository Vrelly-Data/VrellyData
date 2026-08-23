// Would adding fireClassifyReply to poll-heyreach-inbox double-draft a reply
// the webhook already handled?
//
// heyreach-webhook writes inbox_status 'pending' but NO last_surfaced_reply_at,
// so the poller's surface gate (newestMs > priorMs, prior = 0 when null) is
// TRUE for every webhook-handled reply. The only thing that stops the poller
// reaching that gate is the earlier guard:
//
//     if (existingLead.last_reply_text === lastMessageText) { skip }
//
// which compares OUR stored text against HeyReach's GetConversationsV2
// lastMessageText. If those differ by even one character the guard misses and
// the poller proceeds. Test it on the leads the webhook actually drafted.
import fs from 'node:fs';
const KEY = process.env.HR_KEY, API = 'https://api.heyreach.io/api/public';
const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));

const all = []; let offset = 0, total = null;
while (total === null || offset < total) {
  const r = await fetch(`${API}/inbox/GetConversationsV2`, {
    method: 'POST',
    headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ filters: { linkedInAccountIds: [], campaignIds: [], searchString: '' }, offset, limit: 100 }),
  });
  const d = await r.json(); const items = d.items || []; total = d.totalCount || 0;
  all.push(...items); offset += items.length; if (!items.length) break;
  await new Promise((s) => setTimeout(s, 200));
}
const byUrl = new Map();
for (const c of all) {
  const u = (c.correspondentProfile?.profileUrl || '').trim(); if (!u) continue;
  if (!byUrl.has(u)) byUrl.set(u, []);
  byUrl.get(u).push(c);
}

let wouldSkip = 0, wouldProceed = 0;
for (const L of leads) {
  const convos = byUrl.get(L.linkedin_url) || [];
  console.log(`\n=== ${L.full_name}  (status=${L.inbox_status}, watermark=${L.last_surfaced_reply_at ?? 'NULL'}) ===`);
  if (!convos.length) { console.log('  no conversation found for url'); continue; }
  for (const c of convos) {
    const api = String(c.lastMessageText ?? '');
    const stored = String(L.last_reply_text ?? '');
    const match = stored === api;
    if (c.lastMessageSender === 'ME') {
      console.log(`  convo ${String(c.id).slice(0, 18)} sender=ME → poller skips (skippedSenderMe)`);
      wouldSkip++; continue;
    }
    if (match) { wouldSkip++; } else { wouldProceed++; }
    console.log(`  convo ${String(c.id).slice(0, 18)} sender=${c.lastMessageSender}`);
    console.log(`    stored last_reply_text : ${JSON.stringify(stored.slice(0, 80))} (${stored.length} chars)`);
    console.log(`    api    lastMessageText : ${JSON.stringify(api.slice(0, 80))} (${api.length} chars)`);
    console.log(`    byte-identical? ${match ? 'YES → poller SKIPS, no double draft' : 'NO  → poller PROCEEDS → would reach the surface gate'}`);
  }
}
console.log(`\n---- summary over ${leads.length} webhook-drafted leads ----`);
console.log(`  poller would SKIP    : ${wouldSkip}`);
console.log(`  poller would PROCEED : ${wouldProceed}   <-- each of these is a double-draft if classify is fired on 'surface'`);
