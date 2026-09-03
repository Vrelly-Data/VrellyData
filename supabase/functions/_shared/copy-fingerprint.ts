// Deterministic fingerprint for outbound copy (subject + body or body only).
// - Normalization: collapse whitespace, normalize newlines, trim, lowercase.
// - Hash: SHA-256 as lowercase hex.
// Intended for: inference_events.copy_fingerprint and linkage across events.
//
// NOTE: Keep normalization conservative — goal is stability across trivial
// formatting changes, not semantic equivalence.

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n/g, '\n')         // CRLF → LF
    .replace(/\r/g, '\n')           // CR → LF
    .replace(/[ \t]+/g, ' ')        // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')     // collapse 3+ newlines
    .trim()
    .toLowerCase();
}

export function normalizeOutboundCopy(body: string, subject?: string | null): string {
  const combined = (subject ? `${subject}\n` : '') + (body ?? '');
  return normalizeWhitespace(combined);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

export async function computeCopyFingerprint(body: string | null | undefined, subject?: string | null): Promise<string | null> {
  if (!body || !String(body).trim()) return null;
  const norm = normalizeOutboundCopy(String(body), subject ?? null);
  if (!norm) return null;
  return await sha256Hex(norm);
}

