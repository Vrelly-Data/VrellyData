// Stale prospect message helper for HeyReach ingestion paths.
// A message is considered stale when its OWN timestamp is older than `thresholdMs`
// compared to `nowMs`. Missing or unparseable timestamps are treated as stale.
export function isStaleProspectMessage(
  messageTimestampIso: string | null | undefined,
  nowMs: number = Date.now(),
  thresholdMs: number = 24 * 60 * 60 * 1000,
): boolean {
  if (!messageTimestampIso) {
    console.warn("[stale-check] missing timestamp; treating as stale");
    return true;
  }
  const ts = new Date(messageTimestampIso).getTime();
  if (!Number.isFinite(ts)) {
    console.warn("[stale-check] unparseable timestamp; treating as stale");
    return true;
  }
  return nowMs - ts > thresholdMs;
}

