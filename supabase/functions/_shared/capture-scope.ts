// Capture Scope — shared platform contract. Stage 2 of 5.
//
// One normalized shape for "which campaigns exist, who sends them, and are we
// capturing replies for them". Adding a 4th platform means implementing
// CaptureScopeAdapter and registering it — no UI work, no new edge function.
//
// The ADAPTER REGISTRY below (campaign/sender listing for the Capture Scope
// UI) does not cover Reply.io: Reply.io campaigns are listed by the
// fetch-available-campaigns / ManageCampaignsDialog path, and migration
// 20260822020000 left every reply_io row at the column default (false).
//
// The FAIL-CLOSED CAPTURE GATE at the bottom of this file is different: it is
// the single source of truth for inbox capture on EVERY platform, Reply.io
// included. A reply_io campaign captures nothing until its synced_campaigns
// row has capture_enabled = true.
//
// Keep this file dependency-free (no imports): it is shared byte-for-byte by
// several functions and PRs.

export type CaptureScopePlatform = "smartlead" | "heyreach";

export interface CaptureScopeSender {
  // What a human recognises — a persona name ("Ron Wade") or an inbox.
  label: string;
  // Stable per-platform identity: an email address, a LinkedIn account id.
  identifier: string;
}

export interface CaptureScopeCampaign {
  externalId: string;
  name: string;
  status: string;        // normalized: in_progress | paused | completed | draft | stopped
  rawStatus: string | null;
  captureEnabled: boolean;

  // Empty when the platform cannot supply senders per campaign, or when they
  // were not requested. NOT a signal that the campaign has no senders — see
  // sendersAvailable on the response envelope.
  senders: CaptureScopeSender[];

  // Null where unknown. Smartlead only populates analytics for a subset of
  // campaigns, so a zero and an unknown must stay distinguishable — rendering
  // "0 sent" for a campaign that actually sent thousands is worse than
  // rendering nothing.
  volume: { sent: number | null; replies: number | null };

  // Platform sub-tenant. Smartlead calls this a "client" and it is how a
  // separate business (captarget) ended up inside SourceCo's account. Any
  // platform with an equivalent surfaces it here so the UI can group by it.
  group: CaptureScopeGroup | null;
}

export interface CaptureScopeGroup {
  id: string;
  label: string;
}

export interface CaptureScopeIntegration {
  id: string;
  team_id: string;
  platform: string;
  api_key_encrypted: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

export interface CaptureScopeAdapter {
  platform: CaptureScopePlatform;

  // Base list. MUST be cheap enough to run on every dialog open — read from
  // synced_campaigns, do not call the vendor API per campaign. Senders are
  // fetched separately precisely because that call does not scale (see below).
  listCampaigns(
    db: Db,
    integration: CaptureScopeIntegration,
  ): Promise<CaptureScopeCampaign[]>;

  // Senders for a BOUNDED set of campaigns, live from the vendor.
  //
  // Smartlead exposes senders only at /campaigns/{id}/email-accounts — one
  // call per campaign, and its account limit is 200 requests/minute. SourceCo
  // alone has 379 campaigns, so fetching every campaign's senders in one pass
  // is not merely slow, it 429s. Verified: the global /email-accounts endpoint
  // carries campaign_count and is_connected_to_campaign but no campaign id
  // list, so there is no bulk mapping to use instead.
  //
  // Callers must therefore page. MAX_SENDER_LOOKUP is the enforced ceiling.
  listSenders?(
    integration: CaptureScopeIntegration,
    externalIds: string[],
  ): Promise<Record<string, CaptureScopeSender[]>>;

  // Stage 4/5. Present on webhook platforms only; poll-based capture needs no
  // registration, so HeyReach will leave these undefined.
  onEnable?(integration: CaptureScopeIntegration, externalIds: string[]): Promise<void>;
  onDisable?(integration: CaptureScopeIntegration, externalIds: string[]): Promise<void>;
}

// Ceiling for one listSenders call. 60 keeps a page comfortably inside the
// 200/min budget even if the user pages quickly.
export const MAX_SENDER_LOOKUP = 60;

const registry = new Map<string, CaptureScopeAdapter>();

export function registerAdapter(adapter: CaptureScopeAdapter): void {
  registry.set(adapter.platform, adapter);
}

export function getAdapter(platform: string): CaptureScopeAdapter | null {
  return registry.get(platform) ?? null;
}

export function supportedPlatforms(): string[] {
  return [...registry.keys()];
}

// Shared normalization so every adapter reports the same vocabulary as
// synced_campaigns.status. Unknown values pass through lowercased rather than
// collapsing to "unknown", so a new vendor status stays visible.
export function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  switch (raw.toUpperCase()) {
    case "ACTIVE":
      return "in_progress";
    case "PAUSED":
      return "paused";
    case "STOPPED":
      return "stopped";
    case "ARCHIVED":
      return "archived";
    case "DRAFTED":
    case "DRAFT":
      return "draft";
    default:
      return raw.toLowerCase();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fail-closed Capture gate — SINGLE SOURCE OF TRUTH for inbox capture
// ---------------------------------------------------------------------------
// A reply/lead is captured into agent_leads only when:
//   1) a campaign id is present on the event (or thread), AND
//   2) synced_campaigns has a row for (integration_id, external_campaign_id), AND
//   3) that row has capture_enabled === true.
//
// Everything else FAILS CLOSED: a missing id, a missing row, capture disabled,
// or any lookup error (including a timeout) returns { allowed:false, reason }
// and the caller MUST skip the agent_leads write and log the reason.
//
// Ids: synced_campaigns.external_campaign_id is TEXT. Providers send numbers
// (HeyReach campaign.id, Smartlead campaign_id, Reply.io sequence ids) or
// strings; normalizeCampaignId maps both to the same canonical string, so
// 518402 and "518402" gate identically.
//
// Timeouts: the lookup is aborted, not just abandoned. The query gets an
// AbortSignal (PostgREST builders expose .abortSignal()), and the await is
// raced against the same deadline, so a stuck network call is cancelled and
// the gate returns lookup_error on time.
// ────────────────────────────────────────────────────────────────────────────

export type CaptureGateSkipReason =
  | "no_campaign_id"
  | "no_synced_row"
  | "capture_disabled"
  | "lookup_error";

export interface CaptureGateResult {
  allowed: boolean;
  reason: "allowed" | CaptureGateSkipReason;
  campaignName?: string | null;
}

/**
 * Canonical campaign id: a finite number becomes its decimal string, a string
 * is trimmed; anything else (null, undefined, "", "null", "undefined",
 * objects, NaN) is treated as missing.
 */
export function normalizeCampaignId(raw: unknown): string | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : null;
  }
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "null" || s === "undefined") return null;
    return s;
  }
  return null;
}

/**
 * Numeric form of campaign ids, for provider APIs that filter on integer ids
 * (HeyReach GetConversationsV2 campaignIds). Non-integer ids are dropped and
 * the result is de-duplicated. Callers must treat an EMPTY result as "nothing
 * enabled": for HeyReach, campaignIds [] means every campaign.
 */
export function numericCampaignIds(ids: readonly string[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const n = Number(id);
    if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

const LOOKUP_TIMEOUT_MIN_MS = 250;
const LOOKUP_TIMEOUT_MAX_MS = 5000;

function clampTimeout(ms: unknown, fallback: number): number {
  const n = Number(ms ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(LOOKUP_TIMEOUT_MIN_MS, Math.min(LOOKUP_TIMEOUT_MAX_MS, n));
}

// Runs build(signal) with a hard deadline. The signal is aborted at the
// deadline (cancelling the underlying fetch when the builder honours it) and
// the returned promise rejects at the same moment even if it does not.
function runBounded<T>(build: (signal: AbortSignal) => PromiseLike<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ctrl.abort(new Error(`capture-scope lookup timed out after ${ms}ms`));
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    try {
      build(ctrl.signal).then(
        (v) => done(() => resolve(v)),
        (e) => done(() => reject(e)),
      );
    } catch (e) {
      done(() => reject(e));
    }
  });
}

// deno-lint-ignore no-explicit-any
function withAbort(q: any, signal: AbortSignal): any {
  return typeof q?.abortSignal === "function" ? q.abortSignal(signal) : q;
}

type LookupResult = { data: unknown; error: { message: string } | null };

/**
 * Fail-closed gate for one campaign id.
 * Returns { allowed:true } only when a capture_enabled row exists for this
 * integration. Otherwise { allowed:false, reason } with one of:
 *   - no_campaign_id
 *   - no_synced_row
 *   - capture_disabled
 *   - lookup_error
 */
export async function checkCaptureGate(
  // deno-lint-ignore no-explicit-any
  db: any,
  integrationId: string,
  campaignExternalId: unknown,
  opts?: { timeoutMs?: number },
): Promise<CaptureGateResult> {
  const campaignId = normalizeCampaignId(campaignExternalId);
  if (!campaignId) {
    return { allowed: false, reason: "no_campaign_id" };
  }
  if (!integrationId) {
    console.warn(`[capture-scope] lookup_error for campaign ${campaignId}: no integration id`);
    return { allowed: false, reason: "lookup_error" };
  }
  const timeoutMs = clampTimeout(opts?.timeoutMs, 1500);
  try {
    const { data, error } = await runBounded<LookupResult>(
      (signal) =>
        withAbort(
          db
            .from("synced_campaigns")
            .select("capture_enabled, name")
            .eq("integration_id", integrationId)
            .eq("external_campaign_id", campaignId),
          signal,
        ).maybeSingle(),
      timeoutMs,
    );
    if (error) {
      console.warn(`[capture-scope] lookup_error for campaign ${campaignId}: ${error.message}`);
      return { allowed: false, reason: "lookup_error" };
    }
    const row = data as { capture_enabled?: boolean | null; name?: string | null } | null;
    if (!row) return { allowed: false, reason: "no_synced_row" };
    if (row.capture_enabled !== true) {
      return { allowed: false, reason: "capture_disabled", campaignName: row.name ?? null };
    }
    return { allowed: true, reason: "allowed", campaignName: row.name ?? null };
  } catch (e) {
    console.warn(`[capture-scope] lookup_error (threw) for campaign ${campaignId}: ${e instanceof Error ? e.message : String(e)}`);
    return { allowed: false, reason: "lookup_error" };
  }
}

export interface EnabledIdsResultOk {
  ok: true;
  // Canonical external campaign ids (see normalizeCampaignId), de-duplicated.
  ids: string[];
  // synced_campaigns.id of the same rows, for callers that join on the row id.
  rowIds: string[];
}
export interface EnabledIdsResultErr {
  ok: false;
  reason: "lookup_error" | "none_enabled";
}
export type EnabledIdsResult = EnabledIdsResultOk | EnabledIdsResultErr;

/**
 * Enumerate capture-enabled campaign ids for an integration.
 * Pollers/recovery use this to FILTER AT SOURCE (provider API) where supported,
 * or locally when not. Fails closed: a lookup error (or timeout) returns
 * lookup_error and no enabled row returns none_enabled; callers must then skip
 * capture for the integration entirely (never poll unfiltered).
 */
export async function listEnabledCampaignIds(
  // deno-lint-ignore no-explicit-any
  db: any,
  integrationId: string,
  opts?: { timeoutMs?: number },
): Promise<EnabledIdsResult> {
  if (!integrationId) {
    console.warn(`[capture-scope] listEnabledCampaignIds lookup_error: no integration id`);
    return { ok: false, reason: "lookup_error" };
  }
  const timeoutMs = clampTimeout(opts?.timeoutMs, 2000);
  try {
    const { data, error } = await runBounded<LookupResult>(
      (signal) =>
        withAbort(
          db
            .from("synced_campaigns")
            .select("id, external_campaign_id")
            .eq("integration_id", integrationId)
            .eq("capture_enabled", true),
          signal,
        ),
      timeoutMs,
    );
    if (error) {
      console.warn(`[capture-scope] listEnabledCampaignIds lookup_error for integration ${integrationId}: ${error.message}`);
      return { ok: false, reason: "lookup_error" };
    }
    const ids: string[] = [];
    const rowIds: string[] = [];
    for (const r of Array.isArray(data) ? data : []) {
      const row = r as { id?: unknown; external_campaign_id?: unknown };
      const id = normalizeCampaignId(row.external_campaign_id);
      if (!id || ids.includes(id)) continue;
      ids.push(id);
      if (row.id != null) rowIds.push(String(row.id));
    }
    if (ids.length === 0) return { ok: false, reason: "none_enabled" };
    return { ok: true, ids, rowIds };
  } catch (e) {
    console.warn(`[capture-scope] listEnabledCampaignIds threw for integration ${integrationId}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, reason: "lookup_error" };
  }
}
