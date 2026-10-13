// Custom fields a pushed contact may carry (the signals source sets them).

/** Up to 20 string-valued custom fields with safe names; anything else dropped. */
export function cleanCustomFields(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(k)) continue;
    if (raw === null || raw === undefined) continue;
    out[k] = String(raw).slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}
