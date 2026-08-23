// Re-clean EVERY Smartlead thread so stored text is exactly what the deployed
// code now produces.
//
// The first backfill ran before the inline-vs-block fix to htmlToText, so its
// output still glued words across table cells ("dayMartha"). Rather than try to
// detect that in text whose tags are already gone, re-fetch every thread from
// message-history — the only place the structure still exists — and re-map with
// the real shared module.
//
// Only rows whose content ACTUALLY changes are written. Same shrink guard as
// before: never store a thread shorter than the one already held.
import fs from 'node:fs';
import { fetchSmartleadThread } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/smartlead-thread.ts';

const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));
const senderMap = new Map(
  JSON.parse(fs.readFileSync(process.env.SENDERS_FILE, 'utf8') || '[]')
    .map((r) => [String(r.mailbox_email).trim().toLowerCase(), r.sender_name]),
);
const senderNameFor = (e) => (e ? senderMap.get(String(e).trim().toLowerCase()) ?? null : null);
const KEY = process.env.SL_KEY;
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const stmts = [];
let changed = 0, same = 0, shrink = 0, failed = 0, noIds = 0;

for (const L of leads) {
  if (!L.campaign_id || !L.lead_id) { noIds++; continue; }
  const stored = Array.isArray(L.reply_thread) ? L.reply_thread : [];
  let r;
  try {
    r = await fetchSmartleadThread({
      apiKey: KEY, campaignId: String(L.campaign_id), leadId: String(L.lead_id),
      localThread: stored, senderNameFor,
    });
  } catch { failed++; continue; }
  if (!r?.thread) { failed++; }
  else if (r.thread.length < stored.length) {
    shrink++;
    console.log(`  SHRINK skipped — ${L.full_name}: ${stored.length} -> ${r.thread.length}`);
  } else if (JSON.stringify(r.thread) === JSON.stringify(stored)) {
    same++;
  } else {
    changed++;
    stmts.push(`UPDATE agent_leads SET reply_thread = ${q(JSON.stringify(r.thread))}::jsonb WHERE id = ${q(L.id)}::uuid;`);
  }
  await new Promise((s) => setTimeout(s, 300));
}

console.log(`\nleads         : ${leads.length}`);
console.log(`  changed     : ${changed}`);
console.log(`  already ok  : ${same}`);
console.log(`  shrink skip : ${shrink}`);
console.log(`  api failed  : ${failed}`);
console.log(`  missing ids : ${noIds}`);
fs.writeFileSync(process.env.OUT_FILE, stmts.length ? `BEGIN;\n${stmts.join('\n')}\n` : '-- nothing to do\n');
console.log(`\nwrote ${stmts.length} UPDATEs -> ${process.env.OUT_FILE}`);
