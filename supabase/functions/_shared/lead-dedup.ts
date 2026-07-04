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
  // operator tagged opted_out / not_relevant.
  disposition_tag?: string | null;
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
    .select('id, external_id, linkedin_url, email, last_reply_at, inbox_status, disposition_tag')
    .eq('user_id', userId)
    .eq('source', 'reply_io');
  return (data ?? []) as LeadCandidate[];
}
