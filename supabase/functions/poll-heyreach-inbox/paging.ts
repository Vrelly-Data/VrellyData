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
  };
};

export interface PagerDeps<Item extends { id?: unknown; lastMessageAt?: unknown }> {
  // Fetch a page (offset/limit). Must throw on any non-OK or parse error.
  fetchPage: (offset: number, limit: number, signal: AbortSignal) => Promise<{ items: Item[]; totalCount: number }>;
  // Process one item. Should throw on failure; caller increments failures.
  processItem: (item: Item, signal: AbortSignal) => Promise<void>;
  nowMs: () => number;
  sleepMs: (ms: number) => Promise<void>;
  // Persist state fully-replaced (writer decides when to call).
  saveState: (state: WalkState) => Promise<void>;
}

export interface PagerOptions {
  runBudgetMs: number;                 // e.g., 110_000
  pageLimit?: number;                  // default 100
  minRemainingForNextPageMs?: number;  // 40_000
  pageFetchTimeoutMs?: number;         // 35_000 (capped by remaining - 5_000)
  itemFetchTimeoutMs?: number;         // 8_000 for chatroom
  minRemainingForNextItemMs?: number;  // 10_000
  // Overlap verification backoff parameters
  resumeBackstepInitial?: number;      // 25
  resumeBackstepStep?: number;         // 100
}

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
  const cutoffMs = parseMs(cutoffIso);
  if (!Number.isFinite(cutoffMs)) return false;
  for (const it of items) {
    const ms = parseMs(it?.lastMessageAt);
    if (!Number.isFinite(ms)) return false; // unparseable cannot count as older
    if (ms >= cutoffMs) return false;       // any item newer-or-equal blocks caught_up
  }
  return true;
}

export async function walkWithState<Item extends { id?: unknown; lastMessageAt?: unknown }>(
  deps: PagerDeps<Item>,
  initialState: WalkState | null | undefined,
  opts: PagerOptions,
): Promise<PagerResult> {
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

  // Compute resume offset with overlap verification
  let effectiveOffset = Math.max(0, (state.walk.offset ?? 0) - backInitial);
  let verified = false;

  while (true) {
    // Budget guard before a new page
    if (remaining() < minNextPage) {
      stopReason = 'time_budget';
      break;
    }
    // Cap page fetch timeout by remaining-5s guard
    const timeout = Math.max(1_000, Math.min(pageTimeoutBase, Math.max(0, remaining() - 5_000)));
    let items: Item[] = [];
    let totalCount = 0;
    try {
      const page = await deps.fetchPage(effectiveOffset, limit, AbortSignal.timeout(timeout));
      items = Array.isArray(page.items) ? page.items : [];
      totalCount = Number.isFinite(Number(page.totalCount)) ? Number(page.totalCount) : 0;
      pagesFetched++;
    } catch (_e) {
      stopReason = 'fetch_error';
      break;
    }

    // Verify overlap on first fetched page after resume
    if (!verified) {
      const lastId = state.walk.lastId;
      const lastTs = state.walk.lastTs;
      const haveId = lastId != null && items.some((it) => String(it?.id ?? '') === String(lastId));
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
    for (let i = 0; i < items.length; i++) {
      if (remaining() < minNextItem) {
        stopReason = 'time_budget';
        // Cursor is already updated in memory below; persist happens at page end/stop via caller
        break;
      }
      const it = items[i];
      try {
        await deps.processItem(it, AbortSignal.timeout(itemTimeout));
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
    const hasMore = items.length === limit && (totalCount <= 0 || effectiveOffset < totalCount);
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
    if ((state.walk.failures ?? 0) === 0) {
      state.baselineStartedAt = state.walk.startedAt;
    } else {
      // keep previous baseline; log elsewhere
    }
    state.walk = null;
  } else {
    // time_budget or fetch_error → preserve walk as-is
  }
  state.lastTick = {
    at: startedAtIso,
    stopReason,
    pagesFetched,
    conversationsProcessed: itemsProcessed,
    elapsedMs,
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

