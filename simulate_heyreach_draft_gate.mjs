// Dry-run of poll-heyreach-inbox's decision path against LIVE HeyReach data,
// reproducing the deployed order of guards exactly:
//
//   1. no lastMessageText            -> skip
//   2. lastMessageSender === 'ME'    -> skip
//   3. stored last_reply_text === lastMessageText -> skip (skippedSameText)
//   4. surface = existingLead ? shouldResurface(...) : (prospect && <24h)
//   5. NEW: if (surface) -> fireClassifyReply
//
// Prints who would receive a draft on the next poll run, so the change can be
// sequenced safely instead of discovered in production.
import fs from 'node:fs';
const KEY = process.env.HR_KEY, API = 'https://api.heyreach.io/api/public';
const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));
const byId = new Map(leads.map((l) => [l.linkedin_url, l]));

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

const SUPPRESSED = ['opted_out'];
const DAY = 24 * 60 * 60 * 1000;
const wouldDraft = [], skipped = { noText: 0, senderMe: 0, sameText: 0, notNewer: 0, notProspect: 0, suppressed: 0, notRecent: 0 };

for (const c of all) {
  const url = (c.correspondentProfile?.profileUrl || '').trim();
  const L = byId.get(url);
  if (!L) continue;                                   // only leads we were asked about
  const text = String(c.lastMessageText ?? '');
  if (!text) { skipped.noText++; continue; }
  if (c.lastMessageSender === 'ME') { skipped.senderMe++; continue; }
  if (String(L.last_reply_text ?? '') === text) { skipped.sameText++; continue; }

  // The poller derives `newest` from GetChatroom; lastMessageAt is the same
  // instant for the newest message and avoids a fetch per conversation.
  const newestMs = Date.parse(c.lastMessageAt ?? '');
  const priorMs = L.last_surfaced_reply_at ? Date.parse(L.last_surfaced_reply_at) : 0;
  const newerThanPrior = Number.isFinite(newestMs) && newestMs > priorMs;
  const newestRole = 'prospect';                      // lastMessageSender !== ME
  let surface;
  if (L.exists_as_lead) {
    if (SUPPRESSED.includes(String(L.disposition_tag ?? ''))) { skipped.suppressed++; continue; }
    surface = newestRole === 'prospect' && newerThanPrior;
    if (!surface) { skipped.notNewer++; continue; }
  } else {
    surface = Number.isFinite(newestMs) && newestMs >= Date.now() - DAY;
    if (!surface) { skipped.notRecent++; continue; }
  }
  wouldDraft.push({ name: L.full_name, status: L.inbox_status, wm: L.last_surfaced_reply_at ?? 'NULL',
    newest: c.lastMessageAt, hasDraft: L.has_draft, convo: String(c.id).slice(0, 20) });
}

console.log(`leads examined: ${leads.length}`);
console.log(`skips: ${JSON.stringify(skipped)}`);
console.log(`\nWOULD FIRE classify-reply on next poll: ${wouldDraft.length}`);
for (const w of wouldDraft) {
  console.log(`  ${String(w.name).padEnd(24)} status=${String(w.status).padEnd(12)} hasDraftAlready=${w.hasDraft}  watermark=${w.wm}  newest=${w.newest}`);
}
const dupes = wouldDraft.filter((w) => w.hasDraft);
console.log(`\n  of which ALREADY have a draft (double-draft): ${dupes.length}`);
