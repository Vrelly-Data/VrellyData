import { shouldResurface, SUPPRESSED_TAGS } from "./inbox-reply.ts";

export function normalizeIsoMs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  // Compare at whole-second precision to avoid sub-second flaps
  const sec = Math.floor(ts / 1000) * 1000;
  return new Date(sec).toISOString();
}

export interface SurfaceDecisionInput {
  dispositionTag: string | null | undefined;
  isExistingLead: boolean;
  newestProspectTimestamp: string | null; // raw; may be null/unparseable
  priorWatermark: string | null; // last_surfaced_reply_at or null
  nowMs?: number;
  thresholdMs?: number;
}

export interface SurfaceDecisionResult {
  surface: boolean;       // write pending + watermark?
  willClassify: boolean;  // call classify-reply?
  newWatermark: string | null; // normalized ISO or null when unknown
  setPending: boolean;    // whether to set inbox_status='pending' (respects opted_out only for existing)
  isStale: boolean;
  seedWatermark: string | null; // when non-surface seeding is allowed (existing + null prior + ts present)
}

/**
 * Centralizes the staleness and classify gate:
 * - Existing lead: surface mirrors shouldResurface (suppressed guard + newer-than-prior), keyed on newest PROSPECT ts.
 * - New lead: surface to 'pending' regardless of age/timestamp presence (product decision).
 * - Stale (>24h by own timestamp) or missing/unparseable timestamp → willClassify=false (safe default).
 * - Fresh (<24h) → willClassify=true on surface; false otherwise.
 * - Watermark uses the normalized newest PROSPECT timestamp when available; null otherwise.
 */
export function decideSurfaceAndClassify(input: SurfaceDecisionInput): SurfaceDecisionResult {
  const { dispositionTag, isExistingLead, nowMs = Date.now(), thresholdMs = 24 * 60 * 60 * 1000 } = input;
  const tsNorm = normalizeIsoMs(input.newestProspectTimestamp);
  const priorNorm = normalizeIsoMs(input.priorWatermark);

  const newerThanPrior = tsNorm != null && priorNorm != null
    ? new Date(tsNorm).getTime() > new Date(priorNorm).getTime()
    : tsNorm != null && priorNorm == null;

  const stale = (() => {
    if (!tsNorm) return true; // missing/unparseable → stale (safe default)
    return (nowMs - new Date(tsNorm).getTime()) > thresholdMs;
  })();

  let surface = false;
  if (isExistingLead) {
    if (!priorNorm) {
      if (stale) {
        // Seed-only: do not surface; allow callers to write watermark if tsNorm exists
        surface = false;
      } else {
        surface = shouldResurface({
          dispositionTag,
          newestRole: tsNorm ? "prospect" : null,
          newerThanPrior,
        });
      }
    } else {
      surface = shouldResurface({
        dispositionTag,
        newestRole: tsNorm ? "prospect" : null,
        newerThanPrior,
      });
    }
  } else {
    // New lead: always surface to 'pending' (product decision), even if stale or ts missing
    surface = true;
  }

  const setPending = surface && (!isExistingLead || !SUPPRESSED_TAGS.includes(String(dispositionTag ?? "")));
  // HeyReach drafting kill switch: never classify from ingestion.
  const willClassify = false;
  const newWatermark = tsNorm;
  const seedWatermark = (!surface && isExistingLead && !priorNorm && tsNorm) ? tsNorm : null;

  return { surface, willClassify, newWatermark, setPending, isStale: stale, seedWatermark };
}

// Build DB update fields from the decision. Does NOT include last_reply_* or reply_thread.
export function buildSurfaceUpdateFields(
  decision: SurfaceDecisionResult,
  opts: { isExistingLead: boolean; alreadyPending?: boolean },
): Record<string, unknown> {
  if (decision.surface) {
    const f: Record<string, unknown> = {};
    if (decision.newWatermark) f.last_surfaced_reply_at = decision.newWatermark;
    if (decision.setPending && !opts.alreadyPending) f.inbox_status = "pending";
    return f;
  }
  if (decision.seedWatermark) {
    return { last_surfaced_reply_at: decision.seedWatermark };
  }
  return {};
}

