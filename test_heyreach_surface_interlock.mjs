// Synthetic coverage for paths real data can't exercise, using the REAL shared
// helper — plus an explicit webhook -> poller interlock replay.
import { shouldResurface } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/inbox-reply.ts';

const gate = (existing, newestRole, newestIso) => {
  const newestMs = Date.parse(newestIso ?? '');
  const priorMs = existing?.last_surfaced_reply_at ? Date.parse(existing.last_surfaced_reply_at) : 0;
  return existing
    ? shouldResurface({ dispositionTag: existing.disposition_tag, newestRole, newerThanPrior: Number.isFinite(newestMs) && newestMs > priorMs })
    : true;
};

const T0 = '2026-08-10T10:00:00.000Z', T1 = '2026-08-11T10:00:00.000Z';
const cases = [
  ['opted_out + genuinely newer prospect reply', { disposition_tag: 'opted_out', last_surfaced_reply_at: T0 }, 'prospect', T1, false],
  ['dismissed + genuinely newer prospect reply', { disposition_tag: 'replied', last_surfaced_reply_at: T0 }, 'prospect', T1, true],
  ['re-delivery of the same message',            { disposition_tag: 'replied', last_surfaced_reply_at: T1 }, 'prospect', T1, false],
  ['newest is OUR outbound, not a reply',        { disposition_tag: null, last_surfaced_reply_at: T0 }, 'sender', T1, false],
  ['brand-new lead (no row yet)',                null, 'prospect', T1, true],
  ['existing lead, null watermark, new reply',   { disposition_tag: null, last_surfaced_reply_at: null }, 'prospect', T1, true],
];
let fail = 0;
console.log('--- gate unit coverage ---');
for (const [name, existing, role, ts, expect] of cases) {
  const got = gate(existing, role, ts);
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} expected=${expect} got=${got}`);
}

console.log('\n--- webhook -> poller interlock replay (the double-draft check) ---');
// Webhook handles a genuinely new reply at T1 on a dismissed lead.
let lead = { disposition_tag: 'replied', last_surfaced_reply_at: T0 };
const whSurface = gate(lead, 'prospect', T1);
if (whSurface) lead = { ...lead, last_surfaced_reply_at: T1 };   // webhook writes the watermark
console.log(`  webhook surfaces: ${whSurface}  -> watermark now ${lead.last_surfaced_reply_at}`);
// Poller runs 15 min later and sees the SAME newest message from GetChatroom.
const pollSurface = gate(lead, 'prospect', T1);
console.log(`  poller surfaces:  ${pollSurface}  (must be false — this is the no-double-draft guarantee)`);
if (pollSurface) fail++;

// And the reverse: webhook DECLINES a re-delivery, so it does not move the
// watermark; the poller must also decline rather than pick it up.
let lead2 = { disposition_tag: 'replied', last_surfaced_reply_at: T1 };
const wh2 = gate(lead2, 'prospect', T1);
const poll2 = gate(lead2, 'prospect', T1);
console.log(`  re-delivery: webhook=${wh2} poller=${poll2}  (both must be false)`);
if (wh2 || poll2) fail++;

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
