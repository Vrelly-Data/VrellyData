// Capture Scope — shared platform contract. Stage 2 of 5.
//
// One normalized shape for "which campaigns exist, who sends them, and are we
// capturing replies for them". Adding a 4th platform means implementing
// CaptureScopeAdapter and registering it — no UI work, no new edge function.
//
// The ADAPTER REGISTRY below serves the Capture Scope UI for EVERY platform
// that has a capture gate: Reply.io, Smartlead and HeyReach. A platform whose
// capture is enforced must have an adapter here, otherwise its Capture Scope
// button would open onto an error while the gate silently drops its replies.
// (Reply.io's separate ManageCampaignsDialog / is_linked path is Data Analysis
// reporting scope and has never gated capture.)
//
// The FAIL-CLOSED CAPTURE GATE further down is the single source of truth for
// inbox capture on every platform: a campaign captures nothing until its
// synced_campaigns row has capture_enabled = true. New campaigns get their
// initial capture_enabled from outbound_integrations.auto_capture_new_campaigns
// (BEFORE INSERT trigger, migration 20261007210000); syncs never write the
// column, so a sync can never undo a toggle.
//
// A reply dropped by the gate is recorded in capture_scope_skips
// (recordCaptureScopeSkips below) so the UI can show it and offer to recapture.
//
// Keep this file dependency-free (no imports): it is shared byte-for-byte by
// several functions and PRs.

export type CaptureScopePlatform = "reply.io" | "smartlead" | "heyreach";

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

  // email | linkedin | multichannel, when the platform knows it. Shown as a
  // badge so a mixed Reply.io account can be told apart at a glance.
  channel?: string | null;
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
  // registration, so HeyReach and Reply.io (polling + one account-level
  // webhook) leave these undefined.
  onEnable?(integration: CaptureScopeIntegration, externalIds: string[]): Promise<void>;
  onDisable?(integration: CaptureScopeIntegration, externalIds: string[]): Promise<void>;

  // Edge function that re-reads recent replies for specific campaigns after
  // they are switched on, so replies skipped while they were off land in the
  // inbox. Called by fetch-capture-scope (mode 'recapture') with x-agent-key
  // and body { mode: 'recapture', integrationId, campaignIds, lookbackDays }.
  recaptureFunction: string;
}

// How far back a recapture reads, and the window the UI counts skips over.
export const RECAPTURE_LOOKBACK_DAYS = 14;

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


// ────────────────────────────────────────────────────────────────────────────
// Skipped replies — no silent drops
// ---------------------------------------------------------------------------
// Every path that drops a reply because its campaign is not capture-enabled
// records it here: one capture_scope_skips row per integration + campaign +
// contact (upserted, newest reply time kept). The Capture Scope UI turns these
// into a "N replies skipped" badge with one-click enable + recapture.
//
// Best-effort by design: recording a skip must never break or slow capture,
// so errors are logged (counts only, no contact data) and swallowed.
// ────────────────────────────────────────────────────────────────────────────

export type CaptureSkipRecordReason = "capture_disabled" | "no_synced_row";

export interface CaptureSkipRecord {
  integrationId: string;
  teamId: string;
  platform: string;
  campaignExternalId: unknown;
  campaignName?: string | null;
  contactEmail?: string | null;
  contactLinkedinUrl?: string | null;
  contactName?: string | null;
  // Fallback identity when the contact has neither email nor LinkedIn URL.
  contactFallbackId?: string | null;
  occurredAt?: string | null;
  reason: CaptureSkipRecordReason;
  source: string;
}

/** Skip reasons worth showing to a user: the campaign is known but not on. */
export function isRecordableSkip(reason: string | null | undefined): reason is CaptureSkipRecordReason {
  return reason === "capture_disabled" || reason === "no_synced_row";
}

export function captureSkipContactKey(r: Pick<CaptureSkipRecord, "contactEmail" | "contactLinkedinUrl" | "contactFallbackId">): string | null {
  const email = (r.contactEmail ?? "").trim().toLowerCase();
  if (email) return email;
  const li = (r.contactLinkedinUrl ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/+$/, "");
  if (li) return li;
  const fb = (r.contactFallbackId ?? "").trim();
  return fb ? `id:${fb}` : null;
}

export async function recordCaptureScopeSkips(
  // deno-lint-ignore no-explicit-any
  db: any,
  records: CaptureSkipRecord[],
): Promise<number> {
  const rows = [];
  for (const r of records) {
    const campaignId = normalizeCampaignId(r.campaignExternalId);
    const contactKey = captureSkipContactKey(r);
    if (!campaignId || !contactKey || !r.integrationId || !r.teamId) continue;
    const ts = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
    rows.push({
      integration_id: r.integrationId,
      team_id: r.teamId,
      platform: r.platform,
      campaign_external_id: campaignId,
      campaign_name: r.campaignName ?? null,
      contact_key: contactKey,
      contact_email: (r.contactEmail ?? "").trim().toLowerCase() || null,
      contact_linkedin_url: (r.contactLinkedinUrl ?? "").trim() || null,
      contact_name: (r.contactName ?? "").trim() || null,
      occurred_at: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
      reason: r.reason,
      source: r.source,
    });
  }
  if (rows.length === 0) return 0;
  try {
    const { data, error } = await db.rpc("record_capture_scope_skips", { p_rows: rows });
    if (error) {
      console.warn(`[capture-scope] recordCaptureScopeSkips failed for ${rows.length} row(s): ${error.message}`);
      return 0;
    }
    return typeof data === "number" ? data : rows.length;
  } catch (e) {
    console.warn(`[capture-scope] recordCaptureScopeSkips threw for ${rows.length} row(s): ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
