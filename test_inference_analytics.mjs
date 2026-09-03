// Lightweight analytics tests (no DB). Run with: deno run --allow-net=none --allow-read test_inference_analytics.mjs
// - Validates copy_fingerprint stability across whitespace/subject variants
// - Validates UTC hour/weekday bucketing
// - Validates "nearest preceding sent" pairing logic on a small synthetic set

import { normalizeOutboundCopy, computeCopyFingerprint } from './supabase/functions/_shared/copy-fingerprint.ts';

function assert(cond, msg) {
  if (!cond) {
    console.error('Assertion failed:', msg);
    Deno.exit(1);
  }
}

async function testCopyFingerprint() {
  const bodyA = "Hi John,\n\nThanks for connecting!\n- Alex";
  const bodyB = "  hi  John,\n\nThanks for connecting!\n\n- Alex  ";
  const fpA = await computeCopyFingerprint(bodyA, null);
  const fpB = await computeCopyFingerprint(bodyB, null);
  assert(fpA === fpB, 'Body-only fingerprint should be stable across trivial whitespace');

  const subj1 = "Quick intro";
  const subj2 = "  QUICK   INTRO ";
  const fpS1 = await computeCopyFingerprint(bodyA, subj1);
  const fpS2 = await computeCopyFingerprint(bodyA, subj2);
  assert(fpS1 === fpS2, 'Subject+body fingerprint should ignore case/spacing differences');
  console.log('[ok] copy_fingerprint normalization and hashing');
}

function weekdayUtc(dateIso) {
  return new Date(dateIso).getUTCDay(); // 0..6 (Sun..Sat)
}
function hourUtc(dateIso) {
  return new Date(dateIso).getUTCHours(); // 0..23
}

function testUtcBucketing() {
  const d = '2026-09-03T12:34:56Z'; // Thursday
  assert(weekdayUtc(d) === 4, 'Thursday should be weekday 4 (Sun=0)');
  assert(hourUtc(d) === 12, 'Hour should be 12 UTC');
  console.log('[ok] UTC hour/weekday bucketing');
}

function pairNearestPrecedingSent(replies, sends) {
  // replies: [{person_key, channel, occurred_at, provider_thread_id?}]
  // sends:   [{person_key, channel, occurred_at, provider_thread_id?, copy_fingerprint?}]
  return replies.map((r) => {
    const candidates = sends
      .filter((s) =>
        s.person_key === r.person_key &&
        s.channel === r.channel &&
        s.occurred_at <= r.occurred_at
      )
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    // Prefer exact thread match when both sides carry it
    const exact = r.provider_thread_id
      ? candidates.find((s) => s.provider_thread_id === r.provider_thread_id)
      : null;
    const chosen = exact || candidates[0] || null;
    return { reply: r, sent: chosen };
  });
}

function testNearestPrecedingSentPairing() {
  const sends = [
    { person_key: 'a@example.com', channel: 'email', occurred_at: '2026-09-03T10:00:00Z', provider_thread_id: 'T1', copy_fingerprint: 'fp1' },
    { person_key: 'a@example.com', channel: 'email', occurred_at: '2026-09-03T11:00:00Z', provider_thread_id: 'T2', copy_fingerprint: 'fp2' },
  ];
  const replies = [
    { person_key: 'a@example.com', channel: 'email', occurred_at: '2026-09-03T11:30:00Z', provider_thread_id: 'T2' },
    { person_key: 'a@example.com', channel: 'email', occurred_at: '2026-09-03T10:30:00Z', provider_thread_id: null },
    { person_key: 'b@example.com', channel: 'email', occurred_at: '2026-09-03T12:00:00Z', provider_thread_id: null },
  ];
  const paired = pairNearestPrecedingSent(replies, sends);
  assert(paired[0].sent?.provider_thread_id === 'T2', 'Exact thread match should be chosen');
  assert(paired[1].sent?.provider_thread_id === 'T2', 'Nearest preceding by time when no thread id match');
  assert(paired[2].sent === null || paired[2].sent === undefined, 'No fabricated matches for unseen person_key');
  console.log('[ok] nearest-preceding-sent pairing logic');
}

await testCopyFingerprint();
testUtcBucketing();
testNearestPrecedingSentPairing();
console.log('All inference analytics tests passed.');

