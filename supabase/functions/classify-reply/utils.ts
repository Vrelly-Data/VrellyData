// Utilities for classify-reply — concentrated here so we can unit test
// placeholder detection and thread extraction without hitting external APIs.
//
// These helpers are imported by index.ts and have NO side-effects.

export function isPlaceholderReplyText(input: unknown, channel: string): boolean {
  const t = String(input ?? '').trim().toLowerCase();
  if (!t) return false; // empty is handled by the caller explicitly
  const canned = new Set([
    'email reply received',
    'linkedin reply received',
  ]);
  if (canned.has(t)) return true;
  // Defensive: tolerate unexpected casing or channel variants
  if (t === `${String(channel || '').toLowerCase()} reply received`) return true;
  return false;
}

type ThreadEntry = { role?: string; content?: string; channel?: string; timestamp?: string };

export function pickLastProspectContentFromThread(
  thread: unknown,
  opts?: { channel?: string }
): string | null {
  const arr: ThreadEntry[] = Array.isArray(thread) ? (thread as ThreadEntry[]) : [];
  if (arr.length === 0) return null;
  const wantChannel = (opts?.channel ?? '').toLowerCase();
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e || typeof e !== 'object') continue;
    const roleOk = (e.role ?? '').toLowerCase() === 'prospect';
    const content = typeof e.content === 'string' ? e.content : '';
    if (!roleOk || !content.trim()) continue;
    if (!wantChannel) return content;
    const ch = (e.channel ?? '').toLowerCase();
    if (!ch || ch === wantChannel) return content;
  }
  return null;
}

