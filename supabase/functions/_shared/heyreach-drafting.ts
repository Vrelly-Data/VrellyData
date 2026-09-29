// HeyReach drafting switch. Pure helpers only: callers read the env var
// themselves (per request) and pass the raw value in, so this module has no
// side effects and is trivially unit-testable.
//
// Drafting for HeyReach replies (the classify-reply call from
// poll-heyreach-inbox and heyreach-webhook) is OFF unless
// HEYREACH_DRAFTING_ENABLED is exactly the string "true". Unset, empty,
// "TRUE", "1", " true" etc. all mean OFF. Unsetting the secret is the instant
// off switch; with it unset both functions behave exactly as the #87 kill
// switch did (surface + record the reply, never classify).
//
// The flag is the only drafting switch. It is checked AFTER the Capture Scope
// gate (synced_campaigns.capture_enabled, fail-closed) and the surface/stale
// decision, so a reply only ever reaches classify-reply when its campaign is
// capture-enabled, it surfaced, and it is fresh (<24h).

export const HEYREACH_DRAFTING_ENV = "HEYREACH_DRAFTING_ENABLED";

export function isHeyReachDraftingEnabled(raw: string | null | undefined): boolean {
  return raw === "true";
}

export type HeyReachClassifyReason =
  | "classify"
  | "not_surfaced"
  | "stale"
  | "drafting_disabled";

// Combines the shared surface decision (willClassify = surfaced && fresh) with
// the drafting flag. Order matters only for the logged reason: a stale or
// non-surfacing reply is reported as such regardless of the flag.
export function heyreachClassifyGate(
  decision: { surface: boolean; willClassify: boolean },
  draftingEnabled: boolean,
): { classify: boolean; reason: HeyReachClassifyReason } {
  if (!decision.surface) return { classify: false, reason: "not_surfaced" };
  if (!decision.willClassify) return { classify: false, reason: "stale" };
  if (!draftingEnabled) return { classify: false, reason: "drafting_disabled" };
  return { classify: true, reason: "classify" };
}
