// Stable source_row_id generator for 'sent' events.
// Priority:
// 1) provider_message_id when available → "${provider}:${provider_message_id}"
// 2) Deterministic hash over (provider, personKey, providerThreadId, copyFingerprint, occurredAt, tag)
//    Returns "${provider}:h:${sha256Hex(...)}"
//
// This yields:
// - Uniqueness across distinct sends (occurredAt differs)
// - Idempotence for the same provider message id (exact match)
// - Idempotence within one execution when the same occurredAt/tag are reused
//
// NOTE: Callers should pass the EXACT occurredAt they persist on the event row.

import { sha256Hex } from './copy-fingerprint.ts';

export async function computeSentSourceId(opts: {
  provider: string;
  personKey: string;
  occurredAt: string; // ISO timestamp persisted in event.occurred_at
  providerThreadId?: string | null;
  providerMessageId?: string | null;
  copyFingerprint?: string | null;
  tag?: string | null;
}): Promise<string> {
  const provider = String(opts.provider || '').toLowerCase();
  const personKey = String(opts.personKey || '').toLowerCase();
  const occurredAt = String(opts.occurredAt || '');
  const threadId = (opts.providerThreadId ?? '') + '';
  const msgId = (opts.providerMessageId ?? '') + '';
  const fp = (opts.copyFingerprint ?? '') + '';
  const tag = (opts.tag ?? '') + '';

  if (msgId) return `${provider}:${msgId}`;

  const base = `${provider}|${personKey}|${threadId}|${fp}|${occurredAt}|${tag}`;
  const h = await sha256Hex(base);
  return `${provider}:h:${h}`;
}

