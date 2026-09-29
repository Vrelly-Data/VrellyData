// Budgeted newest-first walker with persistent baseline and item-granularity cursor.
// Framework/runtime-agnostic: index.ts supplies fetch/processing/state glue and budgets.

export type StopReason = 'caught_up' | 'time_budget' | 'end_of_list' | 'fetch_error';

export type WalkState = {
  version: 1;
  baselineStartedAt: string | null;
  walk: null | {
    startedAt: string;
    cutoff: string | null;
    offset: number;
    lastTs: string | null;
    lastId: string | null;
    failures: number;
  };
  lastTick?: {
    at: string;
    stopReason: StopReason;
    pagesFetched: number;
    conversationsProcessed: number;
    elapsedMs: number;
    headScan?: HeadScanResult;
    // Why the walk stopped with fetch_error (HTTP status, invalid page).
    // Diagnostic only; absent on other stop reasons.
    fetchError?: string;
    // Items on pages fetched this tick with no parseable lastMessageAt (> 0 only).
    missingLastMessageAt?: number;
  };
  // Capture Scope the baseline and walk were built under. See applyScope.
  scope?: CaptureScope;
};

// The request-level campaign filter the poller walks: the capture-enabled
// HeyReach campaign ids, sorted ascending and de-duplicated so equal sets
// compare equal. Always NON-EMPTY: there is no "unfiltered" mode any more
// (HeyReach treats campaignIds [] as every campaign, so an empty scope is never
// walked; the poller skips the integration instead, fail closed).
//
// `unfiltered` is only READ, from state written by earlier versions; a stored
// { unfiltered: true } never equals a real scope, so applyScope resets the
// baseline and walk once and rewrites the scope without the field.
export type CaptureScope = { campaignIds: number[]; unfiltered?: boolean };

// Head scan: page 1 (offset 0) re-processed at the start of every tick that
// resumes a cursor, so a reply the webhook missed surfaces on the next tick
// instead of waiting for the next full walk. See tickWithHeadScan below.
export type HeadScanStopReason =
  | 'complete'              // every item on page 1 was attempted
  | 'time_budget'           // the head-scan share ran out before page 1 was done
  | 'fetch_error'           // page 1 could not be fetched; walk proceeds per the budget rule
  | 'skipped_walk_at_head'  // the walk itself starts at offset 0 this tick (its first page IS page 1)
  | 'skipped_budget';       // not enough total budget left to start a page

export interface HeadScanResult {
  items: number;      // items attempted (successes + failures)
  failures: number;   // items whose processItem threw; counted here, never on the walk
  elapsedMs: number;
  stopReason: HeadScanStopReason;
}

// Which part of a tick is calling: the head scan (page 1) or the walk. Lets the
// caller keep separate counters; the pager itself treats both the same.
export type Phase = 'head' | 'walk';

export interface PagerDeps<Item extends { id?: unknown; lastMessageAt?: unknown }> {
  // Fetch a page (offset/limit). Must throw on any non-OK HTTP or parse error.
  // Return the response's `items` and `totalCount` UNCOERCED: the pager
  // validates the page shape itself (see checkPage) and treats a malformed,
  // empty or short page as fetch_error.
  fetchPage: (offset: number, limit: number, signal: AbortSignal, phase: Phase) => Promise<{ items?: unknown; totalCount?: unknown }>;
  // Process one item. Should throw on failure; caller increments failures.
  // `signal` is the per-item deadline (itemFetchTimeoutMs); honour it for every
  // network and DB call so one item cannot overrun the budget.
  processItem: (item: Item, signal: AbortSignal, phase: Phase) => Promise<void>;
  nowMs: () => number;
  // Persist state fully-replaced (writer decides when to call).
  saveState: (state: WalkState) => Promise<void>;
}

export interface PagerOptions {
  runBudgetMs: number;                 // e.g., 110_000
  pageLimit?: number;                  // default 100
  minRemainingForNextPageMs?: number;  // 40_000
  pageFetchTimeoutMs?: number;         // 35_000 (capped by remaining - 5_000)
  itemFetchTimeoutMs?: number;         // 8_000: per-item deadline (GetChatroom + DB calls)
  minRemainingForNextItemMs?: number;  // 10_000
  // Overlap verification backoff parameters
  resumeBackstepInitial?: number;      // 25
  resumeBackstepStep?: number;         // 100
  // Share of runBudgetMs the head scan may use (page-1 fetch + items). Only
  // used by tickWithHeadScan; walkWithState ignores it.
  headScanBudgetMs?: number;           // 40_000
}

export const DEFAULT_PAGER_OPTIONS: Required<PagerOptions> = {
  runBudgetMs: 110_000,
  pageLimit: 100,
  minRemainingForNextPageMs: 40_000,
  pageFetchTimeoutMs: 35_000,
  itemFetchTimeoutMs: 8_000,
  minRemainingForNextItemMs: 10_000,
  resumeBackstepInitial: 25,
  resumeBackstepStep: 100,
  headScanBudgetMs: 40_000,
};

export interface PagerResult {
  pagesFetched: number;
  itemsProcessed: number;
  failures: number;
  stopReason: StopReason;
  state: WalkState;
}

function parseMs(v: unknown): number {
  const s = typeof v === 'string' ? v : String(v ?? '');
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

function isNonIncreasingByTs<Item extends { lastMessageAt?: unknown }>(items: Item[]): boolean {
  let prev: number | null = null;
  for (const it of items) {
    const ms = parseMs(it?.lastMessageAt);
    if (!Number.isFinite(ms)) return false;
    if (prev !== null && ms > prev) return false; // newer than previous → not non-increasing
    prev = ms;
  }
  return true;
}

function pageFullyOlderThanCutoff<Item extends { lastMessageAt?: unknown }>(items: Item[], cutoffIso: string): boolean {
  // An empty page proves nothing about what is older than the cutoff.
  if (items.length === 0) return false;
  const cutoffMs = parseMs(cutoffIso);
  if (!Number.isFinite(cutoffMs)) return false;
  for (const it of items) {
    const ms = parseMs(it?.lastMessageAt);
    if (!Number.isFinite(ms)) return false; // unparseable cannot count as older
    if (ms >= cutoffMs) return false;       // any item newer-or-equal blocks caught_up
  }
  return true;
}

// ---------------------------------------------------------------------------
// Page validation (walk and head scan)
// ---------------------------------------------------------------------------
// A page is only trusted when its shape is consistent with the list HeyReach
// reports. Anything else is a fetch_error: the walk stays exactly as saved and
// the baseline does not move, so a bad response can never mark a walk clean.
//
// - `items` must be an array.
// - `totalCount` must be a non-negative integer (number, or a digit string).
//   Missing / null / non-numeric → invalid. GetConversationsV2 always returns
//   it (v44 on main relied on it for `hasMore`), so without it a short or empty
//   page cannot be told apart from the real end of the list.
// - Empty page: valid only at offset 0 with totalCount 0 (an empty inbox; see
//   walkWithState: it ends the walk but never advances the baseline). An empty
//   page at offset > 0, or at offset 0 with totalCount > 0, is invalid.
// - Items present but totalCount 0: inconsistent → invalid.
// - Short page (fewer than `limit` items) with offset + items.length <
//   totalCount: truncated → invalid.
// - A full page, or a short page reaching totalCount, is valid. A list that
//   grew or shrank between pages is fine as long as each page is consistent
//   with its own totalCount; drift is handled by the resume verification.
export type PageCheck<Item> =
  | { ok: true; items: Item[]; totalCount: number }
  | { ok: false; kind: 'shape' | 'empty' | 'short'; reason: string; totalCount: number | null };

function parseTotalCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

export function checkPage<Item>(page: unknown, offset: number, limit: number): PageCheck<Item> {
  const p = (page && typeof page === 'object') ? page as { items?: unknown; totalCount?: unknown } : {};
  if (!Array.isArray(p.items)) return { ok: false, kind: 'shape', reason: 'items_not_array', totalCount: null };
  const total = parseTotalCount(p.totalCount);
  if (total === null) return { ok: false, kind: 'shape', reason: 'bad_total_count', totalCount: null };
  const n = p.items.length;
  if (n === 0) {
    if (offset === 0 && total === 0) return { ok: true, items: [], totalCount: 0 };
    return { ok: false, kind: 'empty', reason: `empty_page@${offset}(total=${total})`, totalCount: total };
  }
  if (total === 0) return { ok: false, kind: 'shape', reason: `items_with_zero_total@${offset}`, totalCount: total };
  if (n < limit && offset + n < total) {
    return { ok: false, kind: 'short', reason: `short_page@${offset}(${n}<${limit},total=${total})`, totalCount: total };
  }
  return { ok: true, items: p.items as Item[], totalCount: total };
}

// Per-tick diagnostics shared by the head scan and the walk, so the
// missing-lastMessageAt warning is logged once per tick.
export interface TickDiagnostics { missingTs: number; firstMissingId: string | null }
const newDiagnostics = (): TickDiagnostics => ({ missingTs: 0, firstMissingId: null });

function noteMissingTs<Item extends { id?: unknown; lastMessageAt?: unknown }>(items: Item[], diag: TickDiagnostics) {
  for (const it of items) {
    if (!Number.isFinite(parseMs(it?.lastMessageAt))) {
      diag.missingTs++;
      if (diag.firstMissingId === null) diag.firstMissingId = String(it?.id ?? '');
    }
  }
}

function logDiagnostics(diag: TickDiagnostics) {
  if (diag.missingTs > 0) {
    console.warn(
      `[pager] missing_lastMessageAt: ${diag.missingTs} item(s) on pages fetched this tick have no parseable ` +
        `lastMessageAt (first id=${diag.firstMissingId}); such pages never count as sorted or as older than the cutoff`,
    );
  }
}

function errReason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return (m || 'fetch_failed').slice(0, 120);
}

// ---------------------------------------------------------------------------
// Capture Scope keying
// ---------------------------------------------------------------------------
// null when no usable id remains: the caller must skip the integration
// (never poll with an empty filter, which HeyReach reads as "all campaigns").
export function canonicalScope(campaignIds: number[]): CaptureScope | null {
  const ids = [...new Set(campaignIds.filter((n) => Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b);
  return ids.length === 0 ? null : { campaignIds: ids };
}

function sameScope(a: CaptureScope | undefined | null, b: CaptureScope): boolean {
  if (!a || typeof a !== 'object' || !Array.isArray(a.campaignIds)) return false;
  // Legacy unfiltered (or empty) scopes from earlier versions never match.
  if (a.unfiltered === true || a.campaignIds.length === 0) return false;
  return a.campaignIds.length === b.campaignIds.length &&
    a.campaignIds.every((v, i) => v === b.campaignIds[i]);
}

// The baseline and the walk cursor only mean something for the list they were
// built from. If the campaign filter changes (a campaign enabled or disabled,
// or a legacy unfiltered scope written by an earlier version), offsets point
// into a different list and conversations of a newly enabled campaign may be
// older than the baseline, so both are reset and the next walk covers the new
// scope from the top (as v44 did every run). State without a recorded scope
// (written before this field existed) is treated as a different scope. Returns
// the state to use; `reset` is true when a baseline or walk was discarded.
export function applyScope(
  state: WalkState,
  scope: CaptureScope,
): { state: WalkState; changed: boolean; reset: boolean; previous: CaptureScope | null } {
  const previous = (state.scope && typeof state.scope === 'object') ? state.scope : null;
  if (sameScope(previous, scope)) return { state, changed: false, reset: false, previous };
  const reset = state.baselineStartedAt != null || state.walk != null;
  state.baselineStartedAt = null;
  state.walk = null;
  state.scope = { campaignIds: [...scope.campaignIds] };
  return { state, changed: true, reset, previous };
}

export async function walkWithState<Item extends { id?: unknown; lastMessageAt?: unknown }>(
  deps: PagerDeps<Item>,
  initialState: WalkState | null | undefined,
  opts: PagerOptions,
  sharedDiag?: TickDiagnostics,
): Promise<PagerResult> {
  const diag = sharedDiag ?? newDiagnostics();
  const startedAtMs = deps.nowMs();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const limit = opts.pageLimit ?? 100;
  const minNextPage = opts.minRemainingForNextPageMs ?? 40_000;
  const minNextItem = opts.minRemainingForNextItemMs ?? 10_000;
  const pageTimeoutBase = opts.pageFetchTimeoutMs ?? 35_000;
  const itemTimeout = opts.itemFetchTimeoutMs ?? 8_000;
  const backInitial = opts.resumeBackstepInitial ?? 25;
  const backStep = opts.resumeBackstepStep ?? 100;
  const deadline = startedAtMs + opts.runBudgetMs;
  const remaining = () => Math.max(0, deadline - deps.nowMs());

  const state: WalkState = initialState && typeof initialState === 'object'
    ? (initialState as WalkState)
    : { version: 1, baselineStartedAt: null, walk: null };

  // Start a new walk if none is in progress
  if (!state.walk) {
    state.walk = {
      startedAt: startedAtIso,
      cutoff: state.baselineStartedAt ? new Date(Date.parse(state.baselineStartedAt) - 60 * 60 * 1000).toISOString() : null,
      offset: 0,
      lastTs: null,
      lastId: null,
      failures: 0,
    };
  }

  let pagesFetched = 0;
  let itemsProcessed = 0;
  let failuresCount = 0;
  let stopReason: StopReason = 'end_of_list';
  let fetchError: string | undefined;
  let emptyInbox = false;

  // Compute resume offset with overlap verification
  let effectiveOffset = Math.max(0, (state.walk.offset ?? 0) - backInitial);
  let verified = false;
  let resumeAppliedThisPage = false;

  while (true) {
    // Budget guard before a new page
    if (remaining() < minNextPage) {
      stopReason = 'time_budget';
      break;
    }
    // Cap page fetch timeout by remaining-5s guard
    const timeout = Math.max(1_000, Math.min(pageTimeoutBase, Math.max(0, remaining() - 5_000)));
    let page: unknown;
    try {
      page = await deps.fetchPage(effectiveOffset, limit, AbortSignal.timeout(timeout), 'walk');
    } catch (e) {
      stopReason = 'fetch_error';
      fetchError = errReason(e);
      break;
    }
    const checked = checkPage<Item>(page, effectiveOffset, limit);
    if (!checked.ok) {
      // Resume only: the list now ends before the resume point (it shrank, e.g.
      // a sender account was removed). Step back towards the reported end and
      // keep verifying; nothing is processed or marked clean on the way. An
      // empty page that does not claim the list ended here is a bad response.
      if (
        !verified && checked.kind === 'empty' && effectiveOffset > 0 &&
        checked.totalCount !== null && checked.totalCount <= effectiveOffset
      ) {
        const next = Math.max(0, Math.min(effectiveOffset - backStep, checked.totalCount - backInitial));
        console.warn(`[pager] list_shrank: ${checked.reason} while resuming; stepping back to offset ${next}`);
        effectiveOffset = next;
        continue;
      }
      console.warn(`[pager] invalid page: ${checked.reason} — treated as fetch_error (walk and baseline unchanged)`);
      stopReason = 'fetch_error';
      fetchError = checked.reason;
      break;
    }
    pagesFetched++;
    const items: Item[] = checked.items;
    const totalCount = checked.totalCount;
    noteMissingTs(items, diag);
    if (items.length === 0) emptyInbox = true; // only reachable at offset 0 with totalCount 0

    // Verify overlap on first fetched page after resume
    if (!verified) {
      const lastId = state.walk.lastId;
      const lastTs = state.walk.lastTs;
      const idIndex = lastId != null ? items.findIndex((it) => String(it?.id ?? '') === String(lastId)) : -1;
      const haveId = idIndex >= 0;
      const haveTs = lastTs != null && items.some((it) => {
        const ms = parseMs(it?.lastMessageAt);
        const last = parseMs(lastTs);
        return Number.isFinite(ms) && Number.isFinite(last) && ms >= last;
      });
      if (itemsProcessed === 0 && pagesFetched === 1 && !haveId && !haveTs && effectiveOffset > 0) {
        // Step back and retry this loop; don't burn a page count for verification retries
        pagesFetched--; // revert count since we'll refetch
        effectiveOffset = Math.max(0, effectiveOffset - backStep);
        continue;
      }
      verified = true;
      // Resume rule: if lastId is found on the page at index j, start processing at j+1.
      // This is VERIFICATION-only overlap; do not reprocess the overlap segment.
      if (haveId && idIndex >= 0) {
        const startAt = idIndex + 1;
        if (startAt > 0) {
          // Pre-advance the in-memory cursor to reflect that we are skipping `startAt` items on this page.
          state.walk.offset = effectiveOffset + startAt;
          resumeAppliedThisPage = true;
        }
      } else {
        // When lastId isn't found (drift), process the whole page again.
        resumeAppliedThisPage = false;
      }
    }

    // Caught up rule: only when cutoff is set (baseline known)
    if (state.walk.cutoff) {
      const fullyOlder = pageFullyOlderThanCutoff(items, state.walk.cutoff);
      // Only a page that is ALL older than cutoff can stop BEFORE processing
      if (fullyOlder) {
        stopReason = 'caught_up';
        break;
      }
    }

    // Process items
    const startIndex = resumeAppliedThisPage ? Math.min(items.length, Math.max(0, (state.walk.offset ?? effectiveOffset) - effectiveOffset)) : 0;
    for (let i = startIndex; i < items.length; i++) {
      if (remaining() < minNextItem) {
        stopReason = 'time_budget';
        // Cursor is already updated in memory below; persist happens at page end/stop via caller
        break;
      }
      const it = items[i];
      try {
        await deps.processItem(it, AbortSignal.timeout(itemTimeout), 'walk');
      } catch (_e) {
        state.walk.failures = (state.walk.failures ?? 0) + 1;
        failuresCount++;
      }
      itemsProcessed++;
      // Update item-granularity cursor (in-memory); caller persists at page end and on stop
      state.walk.offset = effectiveOffset + i + 1;
      state.walk.lastId = String(it?.id ?? '') || null;
      const tsMs = parseMs(it?.lastMessageAt);
      state.walk.lastTs = Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : state.walk.lastTs;
    }
    if (stopReason === 'time_budget') break;

    // After processing, apply the non-increasing/last<cutoff shortcut
    if (state.walk.cutoff && items.length > 0) {
      const nonIncreasing = isNonIncreasingByTs(items);
      if (!nonIncreasing) {
        console.warn('[pager] ordering_violation: page not non-increasing by lastMessageAt — requiring fully older page to stop');
      } else {
        const lastMs = parseMs(items[items.length - 1]?.lastMessageAt);
        if (Number.isFinite(lastMs) && lastMs < parseMs(state.walk.cutoff)) {
          stopReason = 'caught_up';
          // Persist current state and break
          try {
            await deps.saveState(state);
          } catch (e) {
            console.error('[pager] saveState failed after page processing:', e);
          }
          break;
        }
      }
    }

    // Advance offset/page
    effectiveOffset += items.length;
    const hasMore = items.length === limit && effectiveOffset < totalCount;
    // Persist at end of each processed page
    try {
      await deps.saveState(state);
    } catch (e) {
      console.error('[pager] saveState failed at end-of-page:', e);
    }
    if (!hasMore) {
      stopReason = 'end_of_list';
      break;
    }
  }

  const elapsedMs = deps.nowMs() - startedAtMs;
  // Finalize baseline/walk per rules
  if (stopReason === 'caught_up' || stopReason === 'end_of_list') {
    if (emptyInbox) {
      // Empty inbox (offset 0, totalCount 0): the walk is over, but nothing was
      // seen, so the baseline is left as it was. A transient empty response can
      // therefore never make older conversations permanently skippable, and a
      // brand-new integration keeps walking without a cutoff until it has data.
      console.log('[pager] empty inbox (totalCount 0): walk ended, baseline unchanged');
    } else if ((state.walk.failures ?? 0) === 0) {
      state.baselineStartedAt = state.walk.startedAt;
    } else {
      // keep previous baseline; log elsewhere
    }
    state.walk = null;
  } else {
    // time_budget or fetch_error → preserve walk as-is
  }
  if (!sharedDiag) logDiagnostics(diag);
  state.lastTick = {
    at: startedAtIso,
    stopReason,
    pagesFetched,
    conversationsProcessed: itemsProcessed,
    elapsedMs,
    ...(fetchError !== undefined ? { fetchError } : {}),
    ...(diag.missingTs > 0 ? { missingLastMessageAt: diag.missingTs } : {}),
  };
  // Persist on stop as well
  try {
    await deps.saveState(state);
  } catch (e) {
    console.error('[pager] saveState failed on stop:', e);
  }

  // Caller is responsible for when to persist; return updated state.
  return {
    pagesFetched,
    itemsProcessed,
    failures: failuresCount,
    stopReason,
    state,
  };
}

// ---------------------------------------------------------------------------
// Head scan
// ---------------------------------------------------------------------------
// Processes page 1 (offset 0, pageLimit items) with the same idempotent
// processItem the walk uses. It deliberately takes NO WalkState: it cannot move
// the cursor, touch the baseline, bump walk.failures, or mark a walk clean, and
// it never contributes to caught_up / end_of_list. Items the walk later reaches
// on its own pages are simply processed again (skip-unchanged makes that cheap).
//
// Budget rule inside the head scan (all relative to the head scan's own start):
// - the page-1 fetch timeout is min(pageFetchTimeoutMs, budgetMs - 5s), floor 1s;
// - an item is started only while at least minRemainingForNextItemMs of the
//   head-scan share is left, so the scan ends within its share (plus at most the
//   overrun of an item that ignores its timeout);
// - a failed item (processItem throws: GetChatroom or DB error) is counted in
//   `failures` and the scan continues with the next item.
// Page 1 goes through the same checkPage rules as a walk page: a malformed,
// empty (unless the inbox is empty) or short page is a head-scan fetch_error.
export async function runHeadScan<Item extends { id?: unknown; lastMessageAt?: unknown }>(
  deps: Pick<PagerDeps<Item>, 'fetchPage' | 'processItem' | 'nowMs'>,
  budgetMs: number,
  opts: PagerOptions,
  sharedDiag?: TickDiagnostics,
): Promise<HeadScanResult> {
  const diag = sharedDiag ?? newDiagnostics();
  const startMs = deps.nowMs();
  const limit = opts.pageLimit ?? 100;
  const minNextItem = opts.minRemainingForNextItemMs ?? 10_000;
  const pageTimeoutBase = opts.pageFetchTimeoutMs ?? 35_000;
  const itemTimeout = opts.itemFetchTimeoutMs ?? 8_000;
  const deadline = startMs + Math.max(0, budgetMs);
  const remaining = () => Math.max(0, deadline - deps.nowMs());

  let page: unknown;
  try {
    const timeout = Math.max(1_000, Math.min(pageTimeoutBase, Math.max(0, remaining() - 5_000)));
    page = await deps.fetchPage(0, limit, AbortSignal.timeout(timeout), 'head');
  } catch (_e) {
    return { items: 0, failures: 0, elapsedMs: deps.nowMs() - startMs, stopReason: 'fetch_error' };
  }
  const checked = checkPage<Item>(page, 0, limit);
  if (!checked.ok) {
    console.warn(`[pager] head scan: invalid page 1: ${checked.reason} — treated as fetch_error`);
    return { items: 0, failures: 0, elapsedMs: deps.nowMs() - startMs, stopReason: 'fetch_error' };
  }
  const items: Item[] = checked.items;
  noteMissingTs(items, diag);
  if (!sharedDiag) logDiagnostics(diag);

  let attempted = 0;
  let failures = 0;
  let stopReason: HeadScanStopReason = 'complete';
  for (const it of items) {
    if (remaining() < minNextItem) {
      stopReason = 'time_budget';
      break;
    }
    try {
      await deps.processItem(it, AbortSignal.timeout(itemTimeout), 'head');
    } catch (_e) {
      failures++;
    }
    attempted++;
  }
  return { items: attempted, failures, elapsedMs: deps.nowMs() - startMs, stopReason };
}

export interface TickResult extends PagerResult {
  headScan: HeadScanResult;
}

// One poller tick for one integration: head scan, then the budgeted walk.
//
// When the head scan runs: whenever the tick RESUMES a cursor (a walk is in
// progress with offset > 0). When there is no walk in progress, or the walk has
// not processed any item yet (offset 0), the walk's first page this tick is
// page 1 itself and is processed in full, so the head scan is skipped
// (skipped_walk_at_head) rather than fetching and processing page 1 twice. In
// the steady state (baseline known, each walk catches up on page 1) that is
// every tick, so the head scan costs nothing once the backlog is drained.
//
// Budget rules (the tick shares one runBudgetMs, 110s by default):
// 1. The head scan starts only if runBudgetMs >= minRemainingForNextPageMs (40s),
//    the same bar as a walk page (otherwise skipped_budget). Its share is
//    min(headScanBudgetMs, runBudgetMs); page-1 fetch and items both count.
// 2. The walk then gets whatever is left: runBudgetMs minus the head scan's
//    elapsed time, and applies its normal guards (a page needs >= 40s left, an
//    item >= 10s). With the defaults (110s total, 40s share) the head scan ends
//    by ~40s, so the walk has ~70s and always starts at least one page.
// 3. A head-scan fetch_error does not stop the tick: the walk runs under rule 2
//    (if HeyReach is down, the walk's own fetch_error preserves the walk as-is).
// 4. The head scan never changes walk state; the walk alone moves the cursor
//    and decides caught_up / end_of_list / baseline. Head-scan failures do not
//    block the baseline: a page-1 item newer than walk.startedAt is covered by
//    the next walk's cutoff anyway, and it is retried by every head scan.
//
// The returned state carries lastTick.headScan; the caller persists it (the
// walk has already saved the cursor at each page end and on stop).
export async function tickWithHeadScan<Item extends { id?: unknown; lastMessageAt?: unknown }>(
  deps: PagerDeps<Item>,
  initialState: WalkState | null | undefined,
  opts: PagerOptions,
): Promise<TickResult> {
  const tickStartMs = deps.nowMs();
  const minNextPage = opts.minRemainingForNextPageMs ?? 40_000;
  const share = Math.min(opts.headScanBudgetMs ?? 40_000, opts.runBudgetMs);
  const state: WalkState = initialState && typeof initialState === 'object'
    ? (initialState as WalkState)
    : { version: 1, baselineStartedAt: null, walk: null };

  const diag = newDiagnostics();
  let headScan: HeadScanResult;
  if (!state.walk || (state.walk.offset ?? 0) <= 0) {
    headScan = { items: 0, failures: 0, elapsedMs: 0, stopReason: 'skipped_walk_at_head' };
  } else if (opts.runBudgetMs < minNextPage || share <= 0) {
    headScan = { items: 0, failures: 0, elapsedMs: 0, stopReason: 'skipped_budget' };
  } else {
    headScan = await runHeadScan(deps, share, opts, diag);
  }

  const walkBudgetMs = Math.max(0, opts.runBudgetMs - (deps.nowMs() - tickStartMs));
  const walk = await walkWithState(deps, state, { ...opts, runBudgetMs: walkBudgetMs }, diag);
  logDiagnostics(diag);
  if (walk.state.lastTick) {
    walk.state.lastTick = {
      ...walk.state.lastTick,
      at: new Date(tickStartMs).toISOString(),
      elapsedMs: deps.nowMs() - tickStartMs,
      headScan,
    };
  }
  return { ...walk, headScan };
}
