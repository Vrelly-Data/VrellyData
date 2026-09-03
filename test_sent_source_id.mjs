// Validate invariants for computeSentSourceId
// Run with: deno run --allow-net=none --allow-read test_sent_source_id.mjs
import { computeSentSourceId } from './supabase/functions/_shared/sent-source-id.ts';

function assert(cond, msg) {
  if (!cond) {
    console.error('Assertion failed:', msg);
    Deno.exit(1);
  }
}

// Two distinct sends to the same lead/thread/copy at different times → distinct ids
const common = {
  provider: 'reply_io',
  personKey: 'alice@example.com',
  providerThreadId: '123456789',
  providerMessageId: null,
  copyFingerprint: 'abc123fp',
};
const id1 = await computeSentSourceId({ ...common, occurredAt: '2026-09-03T10:00:00.000Z', tag: 'direct' });
const id2 = await computeSentSourceId({ ...common, occurredAt: '2026-09-03T10:00:01.000Z', tag: 'direct' });
assert(id1 !== id2, 'Distinct sends must yield distinct source_row_ids');

// Same provider message id → identical id (idempotent on retries)
const id3 = await computeSentSourceId({
  ...common,
  occurredAt: '2026-09-03T10:00:05.000Z',
  providerMessageId: 'm-999',
});
const id4 = await computeSentSourceId({
  ...common,
  occurredAt: '2026-09-03T10:00:06.000Z', // different time ignored when providerMessageId set
  providerMessageId: 'm-999',
});
assert(id3 === id4, 'Provider message id must force idempotence');

console.log('All sent source id invariants passed.');

