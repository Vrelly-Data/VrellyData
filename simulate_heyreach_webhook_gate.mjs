// Replay heyreach-webhook's NEW surface gate over real leads, importing the
// REAL shared shouldResurface so the simulation cannot drift from the deployed
// predicate.
//
// Two scenarios per lead, both derived from live data:
//   REDELIVERY — HeyReach re-sends the event for the newest message we already
//                hold. This is the 2026-08-16 Reason Mphahlele case. MUST NOT
//                surface any lead that is currently dismissed.
//   NEW REPLY  — a genuinely newer inbound arrives. MUST surface, unless the
//                lead is suppressed (opted_out).
import fs from 'node:fs';
import { shouldResurface } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/inbox-reply.ts';

const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));

// Mirrors the deployed code exactly.
function gate(existing, newestRole, newestIso) {
  const newestMs = Date.parse(newestIso ?? '');
  const priorMs = existing?.last_surfaced_reply_at ? Date.parse(existing.last_surfaced_reply_at) : 0;
  const newerThanPrior = Number.isFinite(newestMs) && newestMs > priorMs;
  return existing
    ? shouldResurface({ dispositionTag: existing.disposition_tag, newestRole, newerThanPrior })
    : true;
}

let redeliverySurfaced = 0, redeliveryHeld = 0;
let newReplySurfaced = 0, newReplyHeld = 0;
const wrong = [];

for (const L of leads) {
  const newestIso = L.newest_msg;
  const role = L.newest_role;

  // --- scenario A: re-delivery of the message already recorded -------------
  const a = gate(L, role, newestIso);
  if (a) {
    redeliverySurfaced++;
    // Surfacing on a re-delivery is only defensible if the lead is already
    // actionable; on a dismissed lead it is the bug we are fixing.
    if (L.inbox_status === 'dismissed') wrong.push({ kind: 'REDELIVERY re-pends a dismissed lead', L, newestIso });
  } else redeliveryHeld++;

  // --- scenario B: a genuinely newer prospect reply ------------------------
  // A "genuinely newer" reply must be newer than EVERYTHING we already know:
  // the stored thread AND the watermark. On the collision leads the watermark
  // came from a sibling conversation and is LATER than the stored thread, so
  // basing this on newest_msg alone would construct a reply that is not
  // actually new and the gate would correctly reject it.
  const baseMs = Math.max(
    Date.parse(newestIso ?? '') || 0,
    Date.parse(L.last_surfaced_reply_at ?? '') || 0,
  ) || Date.now();
  const newer = new Date(baseMs + 60_000).toISOString();
  const b = gate(L, 'prospect', newer);
  if (b) newReplySurfaced++;
  else {
    newReplyHeld++;
    if (L.disposition_tag !== 'opted_out') {
      wrong.push({ kind: 'NEW REPLY suppressed on a non-opted-out lead', L, newestIso: newer });
    }
  }
}

console.log(`leads replayed: ${leads.length}\n`);
console.log(`SCENARIO A — re-delivery of the message we already hold`);
console.log(`  held (no surface, no draft) : ${redeliveryHeld}`);
console.log(`  surfaced                    : ${redeliverySurfaced}`);
console.log(`\nSCENARIO B — a genuinely newer prospect reply`);
console.log(`  surfaced (correct)          : ${newReplySurfaced}`);
console.log(`  held                        : ${newReplyHeld}   (expected: only opted_out)`);

console.log(`\nINCORRECT OUTCOMES: ${wrong.length}`);
for (const w of wrong.slice(0, 10)) {
  console.log(`  ${w.kind} — ${w.L.full_name} status=${w.L.inbox_status} disp=${w.L.disposition_tag} wm=${w.L.last_surfaced_reply_at} newest=${w.newestIso}`);
}

// The specific regression case.
const rm = leads.find((l) => l.full_name === 'Reason Mphahlele');
if (rm) {
  console.log(`\n--- the 2026-08-16 regression case, under the new gate ---`);
  console.log(`  ${rm.full_name}: status=${rm.inbox_status} disp=${rm.disposition_tag}`);
  console.log(`  watermark=${rm.last_surfaced_reply_at}  newest=${rm.newest_msg}`);
  console.log(`  re-delivery surfaces? ${gate(rm, rm.newest_role, rm.newest_msg)}  (must be false)`);
  console.log(`  genuine new reply surfaces? ${gate(rm, 'prospect', new Date(Date.parse(rm.newest_msg) + 60_000).toISOString())}  (must be true)`);
}
