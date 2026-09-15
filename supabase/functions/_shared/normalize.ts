// Shared normalization helpers for storage (database writes).
// Keep these conservative — only coerce values that are unquestionably invalid.

/**
 * Normalizes a LinkedIn URL value for storage.
 *
 * - Empty string, whitespace-only, or the sentinel string "0" → null
 * - Otherwise returns the trimmed string as-is (do not canonicalize here)
 */
export function sanitizeLinkedinUrlForStorage(
  value: string | null | undefined,
): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (s === "0") return null;
  return s;
}

