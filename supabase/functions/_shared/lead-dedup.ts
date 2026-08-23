// Shared lead-dedup helpers for the Reply.io capture paths (reply-webhook +
// poll-reply-inbox). Keeping the normalized keys and the resolution ORDER
// identical across both paths is what prevents the same prospect from producing
// duplicate agent_leads.
//
// Resolution order (see resolveExistingLead): external_id → normalized
// linkedin_url → normalized email (genmail placeholders excluded). The first
// match wins and the caller UPDATEs that row; only when nothing matches does the
// caller INSERT. This deliberately does NOT rely on Postgres ON CONFLICT / the
// partial (user_id, external_id) unique index — supabase-js's `onConflict`
// can't convey the index's WHERE predicate, so arbiter inference is unreliable.

export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = String(url).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '');   // strip protocol (http:// vs https://)
  s = s.replace(/^www\./, '');         // strip leading www.
  s = s.split('#')[0].split('?')[0];   // strip fragment + query
  s = s.replace(/\/+$/, '');           // strip trailing slash(es)
  return s || null;
}

// Reply.io masks some LinkedIn contacts with a #####@genmail.com placeholder.
// These are NOT stable/unique identifiers, so they must never be a dedup key.
export function isGenmailEmail(email: string | null | undefined): boolean {
  return String(email ?? '').trim().toLowerCase().endsWith('@genmail.com');
}

// Normalize an email into a dedup key, or null when it's unusable (empty or a
// genmail placeholder).
export function normalizeEmailKey(email: string | null | undefined): string | null {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e || isGenmailEmail(e)) return null;
  return e;
}

export interface LeadCandidate {
  id: string;
  external_id: string | null;
  linkedin_url: string | null;
  email: string | null;
  last_reply_at: string | null;
  // Optional — poll-reply-inbox reads it (PROTECTED_STATUSES) on the matched
  // candidate; reply-webhook ignores it.
  inbox_status?: string | null;
  // Optional — both ingestion paths read it to suppress resurfacing a lead the
  // operator tagged opted_out.
  disposition_tag?: string | null;
  // Optional — the SURFACE watermark: the timestamp of the last inbound reply
  // that actually flipped the lead to 'pending'. "Genuinely new" is computed
  // against THIS (not last_reply_at, which the display write bumps
  // unconditionally), so a stored-but-not-surfaced reply can't poison it.
  last_surfaced_reply_at?: string | null;
}

// Most recent by last_reply_at; on a tie prefer a real (non-genmail) email so a
// masked stub never wins over its real-email counterpart.
function pickWinner<T extends LeadCandidate>(rows: T[]): T {
  return rows.reduce((a, b) => {
    const at = a.last_reply_at || '';
    const bt = b.last_reply_at || '';
    if (bt !== at) return bt > at ? b : a;
    const aGen = isGenmailEmail(a.email);
    const bGen = isGenmailEmail(b.email);
    if (aGen !== bGen) return aGen ? b : a; // prefer non-genmail
    return a;
  });
}

// Pure, in-memory resolver: find the existing lead an incoming reply belongs to,
// in priority order. Returns the matched candidate or null (→ caller INSERTs).
export function resolveExistingLead(
  candidates: LeadCandidate[],
  keys: { externalId?: string | null; linkedinUrl?: string | null; email?: string | null },
): LeadCandidate | null {
  // 1. external_id — exact match (primary).
  const ext = keys.externalId != null ? String(keys.externalId).trim() : '';
  if (ext) {
    const m = candidates.filter((c) => c.external_id != null && String(c.external_id) === ext);
    if (m.length) return pickWinner(m);
  }
  // 2. normalized linkedin_url (secondary — collapses masked-stub ↔ real-email,
  //    and http:// vs https://).
  const liKey = normalizeLinkedInUrl(keys.linkedinUrl);
  if (liKey) {
    const m = candidates.filter((c) => normalizeLinkedInUrl(c.linkedin_url) === liKey);
    if (m.length) return pickWinner(m);
  }
  // 3. normalized email (tertiary — genmail placeholders excluded).
  const emailKey = normalizeEmailKey(keys.email);
  if (emailKey) {
    const m = candidates.filter((c) => normalizeEmailKey(c.email) === emailKey);
    if (m.length) return pickWinner(m);
  }
  return null;
}

// Fetch this user's reply_io leads as dedup candidates (lightweight — no
// reply_thread; the caller fetches that only for the matched winner).
// deno-lint-ignore no-explicit-any
export async function fetchReplyIoCandidates(supabase: any, userId: string): Promise<LeadCandidate[]> {
  const { data } = await supabase
    .from('agent_leads')
    .select('id, external_id, linkedin_url, email, last_reply_at, inbox_status, disposition_tag, last_surfaced_reply_at')
    .eq('user_id', userId)
    .eq('source', 'reply_io');
  return (data ?? []) as LeadCandidate[];
}

// Is this external_id a real Reply.io INBOX THREAD id?
//
// agent_leads.external_id is contractually the thread id for reply_io rows —
// send-agent-reply posts to /v3/inbox/threads/{external_id}/messages. But the
// column has historically also held:
//   * CONTACT ids            (reply-webhook, pre-fix)      — numeric, >= 5e8
//   * email addresses        (sync-reply-contacts, pre-gate)
//   * 'backfill:<sha1>' keys (one-off pipeline backfill scripts)
// Each of those 404s as inboxThread.notFound at send time, so the lead looks
// healthy — full thread, fresh reply, generated draft — and is unsendable.
//
// Observed live ranges: thread ids 3.5e8-4.1e8, contact ids > 7e8. 5e8 is the
// discriminator, matching the guard in send-agent-reply.
export function isValidReplyThreadId(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return false;
  return Number(s) < 5e8;
}
