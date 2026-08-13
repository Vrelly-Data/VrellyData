// Backfill the leads whose stored text was produced by the weak tag-strip.
//
// Two classes, deliberately handled differently:
//
//   SMARTLEAD threads -> RE-FETCH message-history and re-clean with the REAL
//     shared module (imported below, so output is byte-identical to the newly
//     deployed code). Required for CSS leakage: the weak strip already deleted
//     the <style> TAGS, so the surviving CSS text cannot be recovered by
//     re-cleaning what we stored — only the source has it.
//
//   last_reply_text, and REPLY_IO threads -> IN-PLACE htmlToText. Reply.io's
//     ingest code was already correct (reply-webhook / poll-reply-inbox both
//     import htmlToText); these rows are historical residue, and their stored
//     content still has its tags, so re-cleaning in place is exact.
//
// SAFETY: never writes a thread with FEWER messages than the stored one — the
// HeyReach session showed how easily an authoritative-looking refetch can drop
// history. Shrinks are reported and skipped for manual review.
//
// PREVIEW by default; --apply writes the SQL file out for psql.
import fs from 'node:fs';
import { htmlToText } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/html-to-text.ts';
import { fetchSmartleadThread } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/smartlead-thread.ts';

const CSS_RE = /!important|@media|ExternalClass|MsoNormal|ReadMsgBody|text-size-adjust|border-collapse|mso-|font-family:|line-height:\s*[0-9]/i;
const ENT_RE = /&(nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|copy|reg|trade|deg|middot|bull|zwnj|shy);|&#x?[0-9a-fA-F]+;/;
const dirty = (s) => !!s && (CSS_RE.test(s) || ENT_RE.test(s));

const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));
const senderMap = new Map(
  JSON.parse(fs.readFileSync(process.env.SENDERS_FILE, 'utf8') || '[]')
    .map((r) => [String(r.mailbox_email).trim().toLowerCase(), r.sender_name]),
);
const senderNameFor = (e) => (e ? senderMap.get(String(e).trim().toLowerCase()) ?? null : null);
const KEY = process.env.SL_KEY;

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const stmts = [];
let threadsRefetched = 0, threadsInPlace = 0, lrtFixed = 0, shrinks = 0, apiFail = 0, unchanged = 0;

for (const L of leads) {
  const stored = Array.isArray(L.reply_thread) ? L.reply_thread : [];
  const threadDirty = stored.some((e) => dirty(e?.content));
  let newThread = null;

  if (threadDirty && L.source === 'smartlead' && L.campaign_id && L.lead_id) {
    const r = await fetchSmartleadThread({
      apiKey: KEY, campaignId: String(L.campaign_id), leadId: String(L.lead_id),
      localThread: stored, senderNameFor,
    });
    if (!r.thread) { apiFail++; console.log(`  API ${r.status} / empty — ${L.full_name}`); }
    else if (r.thread.length < stored.length) {
      shrinks++;
      console.log(`  SHRINK skipped — ${L.full_name}: stored ${stored.length} -> api ${r.thread.length}`);
    } else { newThread = r.thread; threadsRefetched++; }
  } else if (threadDirty) {
    newThread = stored.map((e) => ({ ...e, content: htmlToText(e?.content ?? '') }));
    threadsInPlace++;
  }

  const newLrt = dirty(L.last_reply_text) ? htmlToText(L.last_reply_text) : null;
  if (newLrt !== null) lrtFixed++;

  if (!newThread && newLrt === null) { unchanged++; continue; }
  const sets = [];
  if (newThread) sets.push(`reply_thread = ${q(JSON.stringify(newThread))}::jsonb`);
  if (newLrt !== null) sets.push(`last_reply_text = ${q(newLrt)}`);
  stmts.push(`UPDATE agent_leads SET ${sets.join(', ')} WHERE id = ${q(L.id)}::uuid;`);
  if (L.source === 'smartlead' && threadDirty) await new Promise((r) => setTimeout(r, 350));
}

console.log(`\nleads considered      : ${leads.length}`);
console.log(`  threads re-fetched  : ${threadsRefetched}   (smartlead, authoritative)`);
console.log(`  threads in-place    : ${threadsInPlace}   (reply_io residue)`);
console.log(`  last_reply_text fix : ${lrtFixed}`);
console.log(`  shrinks SKIPPED     : ${shrinks}`);
console.log(`  API empty/failed    : ${apiFail}`);
console.log(`  no change needed    : ${unchanged}`);
console.log(`  UPDATE statements   : ${stmts.length}`);

fs.writeFileSync(process.env.OUT_FILE, `BEGIN;\n${stmts.join('\n')}\n`);
console.log(`\nwrote SQL -> ${process.env.OUT_FILE}`);
