import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyScope,
  canonicalScope,
  checkPage,
  tickHeadScanOnly,
  tickWithHeadScan,
  walkWithState,
  type WalkState,
  DEFAULT_PAGER_OPTIONS,
} from "./paging.ts";

function makeClock(start = 0) {
  let now = start;
  return {
    nowMs: () => now,
    sleepMs: async (ms: number) => { now += ms; },
    get: () => now,
  };
}

type Item = { id: string; lastMessageAt: string };

// Helper: single-tick runner with injected pages and item durations
async function runOnce(opts: {
  initial: WalkState | null;
  pages: Item[][];
  pageDurationsMs?: number[]; // sleep before returning each page
  perItemDurationsMs?: number[]; // cycle through durations
  runBudgetMs: number;
  pageLimit?: number;
  pageErrorAt?: number; // 1-based page index to throw
}) {
  const clock = makeClock(0);
  const visited: string[] = [];
  let fetchedPages = 0;
  const flatAll: Item[] = opts.pages.flat();
  const res = await walkWithState<Item>({
    async fetchPage(offset, limit, _signal) {
      // simulate page fetch time
      fetchedPages++;
      const pd = opts.pageDurationsMs?.[fetchedPages - 1] ?? 0;
      await clock.sleepMs(pd);
      if (opts.pageErrorAt && fetchedPages === opts.pageErrorAt) {
        throw new Error("simulated_fetch_error");
      }
      const items = flatAll.slice(offset, offset + (opts.pageLimit ?? 100));
      return { items, totalCount: flatAll.length };
    },
    async processItem(item, _signal) {
      const durations = opts.perItemDurationsMs ?? [];
      const d = durations.length ? durations[(visited.length) % durations.length] : 0;
      await clock.sleepMs(d);
      visited.push(item.id);
    },
    nowMs: clock.nowMs,
    async saveState(_s) { /* no-op for unit tests */ },
  }, opts.initial, { ...DEFAULT_PAGER_OPTIONS });
  return { res, visited, clock, fetchedPages };
}

Deno.test("(1) Missed webhook: B must be processed under baseline+cutoff", async () => {
  const T0 = Date.parse("2026-09-01T12:00:00Z");
  const baseline = new Date(T0).toISOString();
  // cutoff = T0 - 1h; mixed page with fresh head then older tail
  const A: Item = { id: "A", lastMessageAt: new Date(T0 + 30 * 60 * 1000).toISOString() };
  const B: Item = { id: "B", lastMessageAt: new Date(T0 + 10 * 60 * 1000).toISOString() };
  const tail: Item[] = Array.from({ length: 98 }, (_, i) => ({
    id: `old-${i + 1}`,
    lastMessageAt: new Date(T0 - (i + 1) * 60 * 1000).toISOString(),
  }));
  const initial: WalkState = { version: 1, baselineStartedAt: baseline, walk: null };
  const { visited } = await runOnce({
    initial,
    pages: [[A, B, ...tail]],
    runBudgetMs: 110_000,
    pageLimit: 100,
  });
  assert(visited.includes("B"));
  assert(visited.includes("A"));
});

// (9): GetChatroom failure leaves baseline unchanged and no DB writes (spy)
// Walker-level half of (9). The index-side throw-before-write check lives in index_chatroom_test.ts.
Deno.test("(9w) processItem throw: failure counted, baseline unchanged", async () => {
  const T0 = Date.parse("2026-09-15T00:00:00Z");
  let state: WalkState = { version: 1, baselineStartedAt: new Date(T0).toISOString(), walk: null };
  const failing: Item[] = [{ id: "fail", lastMessageAt: new Date(T0 + 1000).toISOString() }];
  const clock = makeClock(0);
  const res = await walkWithState<Item>({
    async fetchPage(_o, _l, _s) { return { items: failing, totalCount: 1 }; },
    async processItem(_it, _s) {
      // Simulate chatroom failure BEFORE any DB writes
      throw new Error("getchatroom_500");
    },
    nowMs: clock.nowMs,
    async saveState(s) { state = s; },
  }, state, { ...DEFAULT_PAGER_OPTIONS });
  // Baseline unchanged and failure recorded
  assertEquals(res.failures > 0, true);
  assertEquals(state.baselineStartedAt, new Date(T0).toISOString());
});

// (10): a zero totalCount alongside items is inconsistent → fetch_error, not a
// walk of an unknown-length list. (GetConversationsV2 always returns a real
// totalCount; v44 on main relied on it for hasMore.)
Deno.test("(10) Zero totalCount with items: fetch_error, nothing processed, walk and baseline unchanged", async () => {
  const all: Item[] = Array.from({ length: 250 }, (_, i) => ({
    id: `c${i + 1}`,
    lastMessageAt: new Date(6_000_000 - i * 1000).toISOString(),
  }));
  const clock = makeClock(0);
  let processed = 0;
  const baseline = "1970-01-01T00:00:00.000Z";
  const r = await walkWithState<Item>({
    async fetchPage(offset, limit, _s) {
      await clock.sleepMs(20_000);
      const items = all.slice(offset, offset + limit);
      return { items, totalCount: 0 }; // zero totalCount
    },
    async processItem(_it, _s) { processed++; },
    nowMs: clock.nowMs,
    async saveState(_s) {},
  }, { version: 1, baselineStartedAt: baseline, walk: null }, { ...DEFAULT_PAGER_OPTIONS });
  assertEquals(processed, 0);
  assertEquals(r.stopReason, "fetch_error");
  assertEquals(r.state.baselineStartedAt, baseline);
  assertEquals(r.state.walk!.offset, 0);
  assertEquals(r.state.lastTick?.fetchError, "items_with_zero_total@0");
});

// (old (2) test removed — replaced by new (2) and (2b) using production defaults)

// (old (3) test removed — replaced above with deep-copy-after-page1 variant)

Deno.test("(4) Mid-page budget stop resumes at the exact next item", async () => {
  // 100 items at 8s each + ~30s page fetch ⇒ exceeds 110s budget → mid-page stop
  const page: Item[] = Array.from({ length: 100 }, (_, i) => ({
    id: `p1-${i}`,
    lastMessageAt: new Date(4_000_000 - i * 1000).toISOString(),
  }));
  let state: WalkState = { version: 1, baselineStartedAt: null, walk: null };
  // First tick: default budget; heavy per-item so we stop mid-page
  const r1 = await runOnce({
    initial: state,
    pages: [page],
    runBudgetMs: 110_000,
    pageLimit: 100,
    pageDurationsMs: [30_000],
    perItemDurationsMs: [8_000],
  });
  state = r1.res.state;
  assertEquals(r1.res.stopReason, "time_budget");
  // Second tick: ensure next item is processed next
  const r2 = await runOnce({
    initial: state,
    pages: [page],
    runBudgetMs: 110_000,
    pageLimit: 100,
  });
  const processedFirstTick = r1.visited.length;
  assertEquals(r2.visited[0], page[processedFirstTick]?.id);
});

// (old (5) drift test removed — replaced with >=150 items variant above)

Deno.test("(6) Item failures: baseline NOT advanced on completion", async () => {
  const T0 = Date.parse("2026-09-10T00:00:00Z");
  let state: WalkState = { version: 1, baselineStartedAt: new Date(T0).toISOString(), walk: null };
  // Pages with some items throwing
  const items: Item[] = [
    { id: "ok1", lastMessageAt: new Date(T0 + 1000).toISOString() },
    { id: "bad", lastMessageAt: new Date(T0 + 900).toISOString() },
  ];
  const r = await (async () => {
    const clock = makeClock(0);
    return await walkWithState<Item>({
      async fetchPage(_o, _l, _s) { return { items, totalCount: items.length }; },
      async processItem(it, _s) { if (it.id === "bad") throw new Error("fail"); },
      nowMs: clock.nowMs,
      async saveState(s) { state = s; },
    }, state, { ...DEFAULT_PAGER_OPTIONS });
  })();
  assertEquals(r.stopReason, "end_of_list");
  // Baseline should remain the previous value since failures > 0
  assertEquals(state.baselineStartedAt, new Date(T0).toISOString());
});

Deno.test("(7) Unsorted or missing-ts page never triggers caught_up", async () => {
  const T0 = Date.parse("2026-09-12T00:00:00Z");
  const baseline = new Date(T0).toISOString();
  const initial: WalkState = { version: 1, baselineStartedAt: baseline, walk: null };
  const unsorted: Item[] = [
    { id: "u1", lastMessageAt: new Date(T0 - 4000).toISOString() },
    { id: "u2", lastMessageAt: new Date(T0 + 1000).toISOString() }, // newer in the middle → unsorted
    { id: "u3", lastMessageAt: "" }, // missing ts
  ];
  const r = await runOnce({ initial, pages: [unsorted], runBudgetMs: 110_000, pageLimit: 100 });
  assertNotEquals(r.res.stopReason, "caught_up");
});

Deno.test("(8) Randomized durations: guards respected and total ≤ 120s", async () => {
  const pages: Item[][] = [
    Array.from({ length: 100 }, (_, i) => ({ id: `p1-${i}`, lastMessageAt: new Date(5_000_000 - i * 1000).toISOString() })),
    Array.from({ length: 100 }, (_, i) => ({ id: `p2-${i}`, lastMessageAt: new Date(4_000_000 - i * 1000).toISOString() })),
  ];
  const pageDurations = [20_000 + Math.floor(Math.random() * 10_000), 20_000 + Math.floor(Math.random() * 10_000)];
  const perItem = Array.from({ length: 10 }, () => Math.floor(Math.random() * 2000));
  const clock = makeClock(0);
  const r = await walkWithState<Item>({
    async fetchPage(offset, _limit, _s) {
      const pi = Math.floor(offset / 100);
      const elapsed = clock.get();
      const remaining = 110_000 - elapsed;
      assert(remaining >= 40_000);
      await clock.sleepMs(pageDurations[pi] ?? 0);
      return { items: pages[pi] ?? [], totalCount: 200 };
    },
    async processItem(_it, _s) {
      const d = perItem[Math.floor(Math.random() * perItem.length)];
      const elapsed = clock.get();
      const remaining = 110_000 - elapsed;
      assert(remaining >= 10_000);
      await clock.sleepMs(d);
    },
    nowMs: clock.nowMs,
    async saveState(_s) {},
  }, { version: 1, baselineStartedAt: null, walk: null }, { ...DEFAULT_PAGER_OPTIONS });
  assert(clock.get() <= 120_000);
});


// ---------------------------------------------------------------------------
// Multi-run walker harness: offset-true fake list, per-call durations, no
// overrides of DEFAULT_PAGER_OPTIONS.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeList(n: number, prefix: string, newestMs = Date.parse("2026-09-20T00:00:00Z")): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, lastMessageAt: new Date(newestMs - i * 60_000).toISOString() }));
}

async function runTick(
  list: () => Item[],
  state: WalkState,
  pageMs: () => number,
  itemMs: () => number,
  visited: string[],
) {
  const clock = makeClock(0);
  let saved: WalkState | null = null;
  const res = await walkWithState<Item>({
    async fetchPage(offset, limit, _s) {
      await clock.sleepMs(pageMs());
      const all = list();
      return { items: all.slice(offset, offset + limit), totalCount: all.length };
    },
    async processItem(item, _s) {
      await clock.sleepMs(itemMs()); // drawn per call
      visited.push(item.id);
    },
    nowMs: clock.nowMs,
    async saveState(st) { saved = structuredClone(st); },
  }, state, { ...DEFAULT_PAGER_OPTIONS });
  return { res, elapsed: clock.get(), saved };
}

async function walkToEnd(total: number, itemMs: () => number, rnd: () => number, maxRuns: number) {
  const all = makeList(total, "w");
  let state: WalkState = { version: 1, baselineStartedAt: null, walk: null };
  const visited: string[] = [];
  let prevOffset = -1;
  for (let run = 1; run <= maxRuns; run++) {
    const { res, elapsed } = await runTick(() => all, state, () => 20_000 + Math.floor(rnd() * 10_000), itemMs, visited);
    state = res.state;
    assert(elapsed <= 120_000, `run ${run} took ${elapsed}ms`);
    if (res.stopReason === "end_of_list") {
      assertNotEquals(state.baselineStartedAt, null);
      assertEquals(state.walk, null);
      return { runs: run, visited };
    }
    assertEquals(res.stopReason, "time_budget");
    assertEquals(state.baselineStartedAt, null); // no baseline until completion
    assert(state.walk!.offset > prevOffset, `run ${run}: offset ${state.walk!.offset} did not advance past ${prevOffset}`);
    prevOffset = state.walk!.offset;
  }
  throw new Error(`walk did not reach end_of_list within ${maxRuns} runs`);
}

Deno.test("(2) 1,893 items, 20–30s pages, 0–9s items drawn per call: strictly increasing offset, all ids, baseline only at end", async () => {
  const rnd = mulberry32(1893);
  const { runs, visited } = await walkToEnd(1893, () => Math.floor(rnd() * 9_000), rnd, 400);
  assertEquals(new Set(visited).size, 1893);
  assertEquals(visited.length, 1893, "no item should be processed twice without drift");
  assert(runs > 1, "must span multiple runs");
  console.log(`(2) runs=${runs}`);
});

Deno.test("(2b) 1,893 items at a fixed 8s per item: still reaches end_of_list with strictly increasing offset", async () => {
  const rnd = mulberry32(8);
  const { runs, visited } = await walkToEnd(1893, () => 8_000, rnd, 400);
  assertEquals(new Set(visited).size, 1893);
  assertEquals(visited.length, 1893);
  console.log(`(2b) runs=${runs}`);
});

Deno.test("(3) fetch_error: walk and baseline equal the state saved before the failed page; only lastTick differs", async () => {
  const all = makeList(300, "f");
  const baseline = "2026-09-01T00:00:00.000Z"; // older than every item → no caught_up
  const clock = makeClock(0);
  let fetches = 0;
  const saves: WalkState[] = [];
  const res = await walkWithState<Item>({
    async fetchPage(offset, limit, _s) {
      fetches++;
      await clock.sleepMs(1_000);
      if (fetches === 2) throw new Error("simulated_fetch_error");
      return { items: all.slice(offset, offset + limit), totalCount: all.length };
    },
    async processItem(_it, _s) { await clock.sleepMs(10); },
    nowMs: clock.nowMs,
    async saveState(st) { saves.push(structuredClone(st)); },
  }, { version: 1, baselineStartedAt: baseline, walk: null }, { ...DEFAULT_PAGER_OPTIONS });
  assertEquals(res.stopReason, "fetch_error");
  assert(saves.length >= 2);
  const afterPage1 = saves[0];
  const final = saves[saves.length - 1];
  assertEquals(afterPage1.walk!.offset, 100);
  assertEquals(final.walk, afterPage1.walk);
  assertEquals(final.baselineStartedAt, baseline);
  assertEquals(final.lastTick?.stopReason, "fetch_error");
  // Next run resumes exactly after page 1 and completes.
  const visited: string[] = [];
  const r2 = await runTick(() => all, final, () => 1_000, () => 10, visited);
  assertEquals(r2.res.stopReason, "end_of_list");
  assertEquals(visited[0], "f100");
  assertEquals(new Set(visited).size, 200);
});

Deno.test("(5) Drift: 400 items, partial first run, >25 removed above cursor + inserts at top; every original id at/after cutoff visited", async () => {
  const T0 = Date.parse("2026-09-20T00:00:00Z");
  const baseline = new Date(T0 - 24 * 3600_000).toISOString(); // cutoff = baseline - 1h, older than every item
  let all = makeList(400, "d", T0);
  const original = all.slice();
  const visited: string[] = [];
  let state: WalkState = { version: 1, baselineStartedAt: baseline, walk: null };
  const r1 = await runTick(() => all, state, () => 25_000, () => 1_000, visited);
  assertEquals(r1.res.stopReason, "time_budget");
  state = r1.res.state;
  const cursor = state.walk!.offset;
  assert(cursor > 40 && cursor < 400, `cursor ${cursor}`);
  // Remove 30 already-processed items directly above the cursor, then insert 5 fresh items at the top.
  const removed = new Set(all.slice(cursor - 35, cursor - 5).map((x) => x.id));
  assertEquals(removed.size, 30);
  all = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `new${i}`, lastMessageAt: new Date(T0 + (i + 1) * 60_000).toISOString() })),
    ...all.filter((x) => !removed.has(x.id)),
  ];
  let stop = "time_budget";
  for (let run = 2; run <= 50 && stop !== "end_of_list" && stop !== "caught_up"; run++) {
    const r = await runTick(() => all, state, () => 25_000, () => 1_000, visited);
    state = r.res.state;
    stop = r.res.stopReason;
  }
  assertEquals(stop, "end_of_list");
  const cutoffMs = T0 - 25 * 3600_000;
  const expected = original.filter((x) => !removed.has(x.id) && Date.parse(x.lastMessageAt) >= cutoffMs).map((x) => x.id);
  const seen = new Set(visited);
  const missing = expected.filter((id) => !seen.has(id));
  assertEquals(missing, []);
});

// ---------------------------------------------------------------------------
// Head scan (tickWithHeadScan): page 1 re-processed each tick that resumes a
// cursor, without touching walk state. All on DEFAULT_PAGER_OPTIONS.
// ---------------------------------------------------------------------------
type HeadTickOpts = {
  pageMs: () => number;
  itemMs: () => number;
  failIds?: Set<string>;                     // processItem throws BEFORE the "write"
  failFetch?: (fetchNo: number, offset: number) => boolean;
  onWalkFirstFetch?: (stateSeenByWalk: WalkState) => void;
};

async function runHeadTick(list: () => Item[], state: WalkState, o: HeadTickOpts) {
  const clock = makeClock(0);
  const headExpected = !!state.walk && (state.walk.offset ?? 0) > 0;
  const headVisited: string[] = [];
  const walkVisited: string[] = [];
  const written: string[] = [];
  const saves: WalkState[] = [];
  let fetchNo = 0;
  let phase: "head" | "walk" = headExpected ? "head" : "walk";
  const res = await tickWithHeadScan<Item>({
    async fetchPage(offset, limit, _s) {
      fetchNo++;
      phase = headExpected && fetchNo === 1 ? "head" : "walk";
      if (phase === "walk" && (fetchNo === 1 || (headExpected && fetchNo === 2))) {
        o.onWalkFirstFetch?.(structuredClone(state));
      }
      await clock.sleepMs(o.pageMs());
      if (o.failFetch?.(fetchNo, offset)) throw new Error("simulated_fetch_error");
      const all = list();
      return { items: all.slice(offset, offset + limit), totalCount: all.length };
    },
    async processItem(item, _s) {
      await clock.sleepMs(o.itemMs());
      (phase === "head" ? headVisited : walkVisited).push(item.id);
      if (o.failIds?.has(item.id)) throw new Error("getchatroom_500"); // nothing written
      written.push(item.id);
    },
    nowMs: clock.nowMs,
    async saveState(st) { saves.push(structuredClone(st)); },
  }, state, { ...DEFAULT_PAGER_OPTIONS });
  return { res, elapsed: clock.get(), headVisited, walkVisited, written, saves, fetchNo };
}

// A walk in progress deep in a 1,893-item list: cursor just after w899.
function deepState(all: Item[], at = 900): WalkState {
  return {
    version: 1,
    baselineStartedAt: null,
    walk: {
      startedAt: "2026-09-19T00:00:00.000Z",
      cutoff: null,
      offset: at,
      lastTs: all[at - 1].lastMessageAt,
      lastId: all[at - 1].id,
      failures: 2,
    },
  };
}

Deno.test("(H1) Missed-webhook reply inserted at the top while the cursor is at 900/1,893 is processed by the next tick's head scan; the cursor still moves forward", async () => {
  const T0 = Date.parse("2026-09-20T00:00:00Z");
  let all = makeList(1893, "w", T0);
  const state = deepState(all);
  const before = structuredClone(state.walk!);
  // The reply the webhook missed: a brand-new conversation at the top of the inbox.
  all = [{ id: "fresh", lastMessageAt: new Date(T0 + 60_000).toISOString() }, ...all];
  const rnd = mulberry32(11);
  const r = await runHeadTick(() => all, state, {
    pageMs: () => 20_000 + Math.floor(rnd() * 10_000),
    itemMs: () => Math.floor(rnd() * 9_000),
  });
  assertEquals(r.headVisited[0], "fresh", "head scan processes the new top item first");
  assert(r.written.includes("fresh"));
  assert(r.res.headScan.items >= 1);
  assertEquals(r.res.headScan.failures, 0);
  // The walk resumed after w899 (now at index 900 because of the insert) and advanced.
  assertEquals(r.walkVisited[0], "w900");
  assert(r.res.state.walk!.offset > before.offset + 1, `offset ${r.res.state.walk!.offset}`);
  assertEquals(r.res.state.walk!.startedAt, before.startedAt);
  assertEquals(r.res.state.walk!.failures, before.failures);
  assertEquals(r.res.state.baselineStartedAt, null);
  assertEquals(r.res.stopReason, "time_budget");
  assert(r.elapsed <= 120_000, `tick took ${r.elapsed}ms`);
});

Deno.test("(H2) Head-scan-only tick (walk fetch fails): cursor, baseline, startedAt and failure counters deep-equal before/after", async () => {
  const all = makeList(1893, "w");
  const baseline = "2026-09-01T00:00:00.000Z";
  const state = deepState(all);
  state.baselineStartedAt = baseline;
  state.walk!.cutoff = new Date(Date.parse(baseline) - 3600_000).toISOString();
  const beforeWalk = structuredClone(state.walk);
  const r = await runHeadTick(() => all, state, {
    pageMs: () => 2_000,
    itemMs: () => 3_000,
    failIds: new Set(["w1"]),                 // a failing head-scan item must not touch walk.failures
    failFetch: (n) => n >= 2,                 // every walk fetch fails → the only work is the head scan
  });
  assertEquals(r.res.headScan.stopReason, "time_budget");
  assert(r.res.headScan.items >= 5, `head items ${r.res.headScan.items}`);
  assertEquals(r.res.headScan.failures, 1);
  assertEquals(r.res.stopReason, "fetch_error");
  assertEquals(r.walkVisited, []);
  assertEquals(r.res.state.walk, beforeWalk);
  assertEquals(r.res.state.baselineStartedAt, baseline);
  for (const saved of r.saves) {
    assertEquals(saved.walk, beforeWalk);
    assertEquals(saved.baselineStartedAt, baseline);
  }
  assertEquals(r.res.state.lastTick?.headScan, r.res.headScan);
});

Deno.test("(H3) Head scan that exhausts its share (slow items) leaves the walk exactly intact; the walk and the next tick still progress", async () => {
  const all = makeList(1893, "w");
  let state = deepState(all);
  const beforeWalk = structuredClone(state.walk);
  const seen: { st: WalkState | null } = { st: null };
  const r1 = await runHeadTick(() => all, state, {
    pageMs: () => 5_000,
    itemMs: () => 9_000,
    onWalkFirstFetch: (st) => { seen.st = st; },
  });
  assertEquals(r1.res.headScan.stopReason, "time_budget");
  assertEquals(r1.res.headScan.items, 3);        // 5s fetch + 3 × 9s; a 4th would start with < 10s of the 40s share
  assert(r1.res.headScan.elapsedMs <= DEFAULT_PAGER_OPTIONS.headScanBudgetMs);
  assert(seen.st, "walk must still run after an exhausted head scan");
  assertEquals(seen.st!.walk, beforeWalk);
  assertEquals(seen.st!.baselineStartedAt, null);
  assert(r1.res.pagesFetched >= 1);
  assert(r1.res.state.walk!.offset > beforeWalk!.offset);
  assert(r1.elapsed <= 120_000);
  // Next tick: same slow head scan, walk resumes exactly where it stopped.
  state = r1.res.state;
  const offset1 = state.walk!.offset;
  const r2 = await runHeadTick(() => all, state, { pageMs: () => 5_000, itemMs: () => 9_000 });
  assertEquals(r2.res.headScan.stopReason, "time_budget");
  assertEquals(r2.walkVisited[0], all[offset1].id);
  assert(r2.res.state.walk!.offset > offset1);
});

Deno.test("(H4) Head-scan item failure: counted on the head scan, nothing written for it, scan continues, walk state unchanged", async () => {
  const all = makeList(1893, "w");
  const state = deepState(all);
  const beforeWalk = structuredClone(state.walk);
  const seen: { st: WalkState | null } = { st: null };
  const r = await runHeadTick(() => all, state, {
    pageMs: () => 1_000,
    itemMs: () => 1_000,
    failIds: new Set(["w0"]),
    onWalkFirstFetch: (st) => { seen.st = st; },
  });
  assertEquals(r.res.headScan.failures, 1);
  assertEquals(r.res.headScan.items, 30);         // 1s fetch + 30 × 1s items, then < 10s of share left
  assertEquals(r.headVisited[0], "w0");
  assert(!r.written.includes("w0"), "nothing written for the failed item");
  assert(r.written.includes("w1"), "scan continues past the failure");
  assertEquals(seen.st!.walk, beforeWalk);
  assertEquals(r.res.failures, 0);                // walk-level failures untouched
  assertEquals(r.res.state.walk!.failures, beforeWalk!.failures);
});

Deno.test("(H5) Head-scan page-1 fetch_error: walk still runs, walk state untouched by the head scan", async () => {
  const all = makeList(1893, "w");
  const state = deepState(all);
  const beforeWalk = structuredClone(state.walk);
  const seen: { st: WalkState | null } = { st: null };
  const r = await runHeadTick(() => all, state, {
    pageMs: () => 25_000,
    itemMs: () => 2_000,
    failFetch: (n) => n === 1,
    onWalkFirstFetch: (st) => { seen.st = st; },
  });
  assertEquals(r.res.headScan, { items: 0, failures: 0, elapsedMs: 25_000, stopReason: "fetch_error" });
  assertEquals(seen.st!.walk, beforeWalk);
  assertEquals(r.walkVisited[0], "w900");
  assert(r.res.state.walk!.offset > beforeWalk!.offset);
});

Deno.test("(H6) No walk in progress (or offset 0): head scan skipped, page 1 fetched once and processed by the walk", async () => {
  const all = makeList(250, "s");
  const r = await runHeadTick(() => all, { version: 1, baselineStartedAt: null, walk: null }, {
    pageMs: () => 1_000,
    itemMs: () => 100,
  });
  assertEquals(r.res.headScan, { items: 0, failures: 0, elapsedMs: 0, stopReason: "skipped_walk_at_head" });
  assertEquals(r.walkVisited.slice(0, 3), ["s0", "s1", "s2"]);
  assertEquals(r.res.stopReason, "end_of_list");
  assertEquals(r.fetchNo, 3);
  // A walk that exists but has not processed anything yet (e.g. first page failed) also starts at page 1.
  const r0 = await runHeadTick(() => all, {
    version: 1,
    baselineStartedAt: null,
    walk: { startedAt: "2026-09-19T00:00:00.000Z", cutoff: null, offset: 0, lastTs: null, lastId: null, failures: 0 },
  }, { pageMs: () => 1_000, itemMs: () => 100 });
  assertEquals(r0.res.headScan.stopReason, "skipped_walk_at_head");
  assertEquals(r0.walkVisited[0], "s0");
  assertEquals(r0.fetchNo, 3);
});

async function walkToEndWithHead(total: number, itemMs: () => number, rnd: () => number, maxRuns: number) {
  const all = makeList(total, "w");
  let state: WalkState = { version: 1, baselineStartedAt: null, walk: null };
  const walkVisited: string[] = [];
  let headItems = 0;
  let walkItems = 0;
  let prevOffset = -1;
  for (let run = 1; run <= maxRuns; run++) {
    const r = await runHeadTick(() => all, state, { pageMs: () => 20_000 + Math.floor(rnd() * 10_000), itemMs });
    state = r.res.state;
    walkVisited.push(...r.walkVisited);
    headItems += r.res.headScan.items;
    walkItems += r.res.itemsProcessed;
    assert(r.elapsed <= 120_000, `run ${run} took ${r.elapsed}ms`);
    if (run > 1) assert(r.res.headScan.stopReason !== "skipped_walk_at_head", `run ${run}: head scan should run while resuming`);
    if (r.res.stopReason === "end_of_list") {
      assertNotEquals(state.baselineStartedAt, null);
      assertEquals(state.walk, null);
      return { runs: run, walkVisited, headItems, walkItems };
    }
    assertEquals(r.res.stopReason, "time_budget");
    assertEquals(state.baselineStartedAt, null);
    assert(state.walk!.offset > prevOffset, `run ${run}: offset ${state.walk!.offset} did not advance past ${prevOffset}`);
    prevOffset = state.walk!.offset;
  }
  throw new Error(`walk did not reach end_of_list within ${maxRuns} runs`);
}

Deno.test("(2h) 1,893 items with head scan, 20–30s pages, 0–9s items: walk still reaches end_of_list, every id processed by the walk exactly once", async () => {
  const rnd = mulberry32(1893);
  const r = await walkToEndWithHead(1893, () => Math.floor(rnd() * 9_000), rnd, 2000);
  assertEquals(new Set(r.walkVisited).size, 1893);
  assertEquals(r.walkItems, 1893, "the walk never redoes an item");
  console.log(`(2h) runs=${r.runs} headScanItems=${r.headItems}`);
});

Deno.test("(2bh) 1,893 items with head scan at a fixed 8s per item: walk still reaches end_of_list, every id processed by the walk exactly once", async () => {
  const rnd = mulberry32(8);
  const r = await walkToEndWithHead(1893, () => 8_000, rnd, 2000);
  assertEquals(new Set(r.walkVisited).size, 1893);
  assertEquals(r.walkItems, 1893);
  console.log(`(2bh) runs=${r.runs} headScanItems=${r.headItems}`);
});

// ---------------------------------------------------------------------------
// Page validation (B*): a malformed, empty or short page is a fetch_error and
// never marks a walk clean. All on DEFAULT_PAGER_OPTIONS.
// ---------------------------------------------------------------------------
type RawPage = { items?: unknown; totalCount?: unknown };

async function walkScripted(
  state: WalkState,
  respond: (offset: number, limit: number, fetchNo: number) => RawPage,
  itemMs = 10,
) {
  const clock = makeClock(0);
  const visited: string[] = [];
  const offsets: number[] = [];
  const saves: WalkState[] = [];
  const res = await walkWithState<Item>({
    async fetchPage(offset, limit, _s) {
      offsets.push(offset);
      await clock.sleepMs(1_000);
      return respond(offset, limit, offsets.length);
    },
    async processItem(item, _s) { await clock.sleepMs(itemMs); visited.push(item.id); },
    nowMs: clock.nowMs,
    async saveState(st) { saves.push(structuredClone(st)); },
  }, state, { ...DEFAULT_PAGER_OPTIONS });
  return { res, visited, offsets, saves };
}

const healthy = (all: Item[]) => (offset: number, limit: number): RawPage => ({ items: all.slice(offset, offset + limit), totalCount: all.length });

Deno.test("(B1) CTO repro: 300 items, empty page at offset 100 → fetch_error, baseline not advanced; next tick visits all 241 items newer than the cutoff", async () => {
  const T0 = Date.parse("2026-09-20T00:00:00Z");
  const all = makeList(300, "r", T0); // r_i at T0 - i min
  // cutoff = baseline - 1h lands between r240 and r241 → 241 items are newer than the cutoff.
  const baseline = new Date(T0 - 180.5 * 60_000).toISOString();
  const cutoffMs = Date.parse(baseline) - 3600_000;
  const newer = all.filter((x) => Date.parse(x.lastMessageAt) >= cutoffMs).map((x) => x.id);
  assertEquals(newer.length, 241);
  const t1 = await walkScripted({ version: 1, baselineStartedAt: baseline, walk: null }, (offset, limit) =>
    offset === 100 ? { items: [], totalCount: 300 } : healthy(all)(offset, limit));
  assertEquals(t1.res.stopReason, "fetch_error");
  assertEquals(t1.res.state.baselineStartedAt, baseline, "baseline must not advance");
  assertEquals(t1.res.state.walk!.offset, 100, "walk kept at the failed page");
  assertEquals(t1.res.state.lastTick?.fetchError, "empty_page@100(total=300)");
  assertEquals(t1.visited.length, 100);
  // HeyReach healthy again: the next tick resumes at 100 and reaches every newer item.
  const t2 = await walkScripted(t1.res.state, healthy(all));
  assertEquals(t2.res.stopReason, "caught_up");
  const seen = new Set([...t1.visited, ...t2.visited]);
  assertEquals(newer.filter((id) => !seen.has(id)), [], "no newer item skipped");
  assertEquals(t2.visited[0], "r100");
  assertNotEquals(t2.res.state.baselineStartedAt, baseline);
});

function resumeState(all: Item[], at: number, baseline: string): WalkState {
  return {
    version: 1,
    baselineStartedAt: baseline,
    walk: { startedAt: "2026-09-19T00:00:00.000Z", cutoff: new Date(Date.parse(baseline) - 3600_000).toISOString(), offset: at, lastTs: all[at - 1].lastMessageAt, lastId: all[at - 1].id, failures: 0 },
  };
}

Deno.test("(B2) Resume: empty page on the verification fetch → fetch_error, walk deep-equal, no step-back to 0, not marked clean", async () => {
  const all = makeList(300, "v");
  const baseline = "2026-09-01T00:00:00.000Z"; // older than every item
  const state = resumeState(all, 250, baseline);
  const before = structuredClone(state.walk);
  const r = await walkScripted(state, () => ({ items: [], totalCount: 300 }));
  assertEquals(r.res.stopReason, "fetch_error");
  assertEquals(r.offsets, [225]);
  assertEquals(r.res.state.walk, before);
  assertEquals(r.res.state.baselineStartedAt, baseline);
  assertEquals(r.visited, []);
});

Deno.test("(B2b) Resume: empty page DURING step-back (lastId not on the first page) → fetch_error, walk deep-equal, never reaches offset 0", async () => {
  const all = makeList(300, "v");
  const baseline = "2026-09-01T00:00:00.000Z";
  const state = resumeState(all, 250, baseline);
  const before = structuredClone(state.walk);
  // First verification page: different ids, all older than lastTs → step back by 100; that page is empty.
  const stale: Item[] = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, lastMessageAt: "2026-09-02T00:00:00.000Z" }));
  const r = await walkScripted(state, (offset) => offset === 225 ? { items: stale, totalCount: 300 } : { items: [], totalCount: 300 });
  assertEquals(r.offsets, [225, 125]);
  assertEquals(r.res.stopReason, "fetch_error");
  assertEquals(r.res.state.walk, before);
  assertEquals(r.res.state.baselineStartedAt, baseline);
  assertEquals(r.visited, []);
});

Deno.test("(B3) Short page before totalCount (37 of 100 at offset 100, total 300) → fetch_error, short page not processed, walk at 100", async () => {
  const all = makeList(300, "s");
  const baseline = "2026-09-01T00:00:00.000Z";
  const r = await walkScripted({ version: 1, baselineStartedAt: baseline, walk: null }, (offset, limit) =>
    offset === 100 ? { items: all.slice(100, 137), totalCount: 300 } : healthy(all)(offset, limit));
  assertEquals(r.res.stopReason, "fetch_error");
  assertEquals(r.visited.length, 100);
  assertEquals(r.res.state.walk!.offset, 100);
  assertEquals(r.res.state.baselineStartedAt, baseline);
  assertEquals(r.res.state.lastTick?.fetchError, "short_page@100(37<100,total=300)");
  // A short LAST page (reaching totalCount) is the real end of the list.
  const ok = await walkScripted({ version: 1, baselineStartedAt: null, walk: null }, healthy(all.slice(0, 237)));
  assertEquals(ok.res.stopReason, "end_of_list");
  assertEquals(ok.visited.length, 237);
});

Deno.test("(B4) items not an array (missing, null, object) → fetch_error, nothing processed, walk and baseline unchanged", async () => {
  const baseline = "2026-09-01T00:00:00.000Z";
  for (const bad of [{ totalCount: 300 }, { items: null, totalCount: 300 }, { items: { a: 1 }, totalCount: 300 }] as RawPage[]) {
    const all = makeList(300, "n");
    const state = resumeState(all, 150, baseline);
    const before = structuredClone(state.walk);
    const r = await walkScripted(state, () => bad);
    assertEquals(r.res.stopReason, "fetch_error");
    assertEquals(r.res.state.walk, before);
    assertEquals(r.res.state.baselineStartedAt, baseline);
    assertEquals(r.res.state.lastTick?.fetchError, "items_not_array");
    assertEquals(r.visited, []);
  }
});

Deno.test("(B5) totalCount missing / null / non-numeric / negative / fractional → fetch_error; digit string accepted", async () => {
  const all = makeList(50, "t");
  const baseline = "2026-09-01T00:00:00.000Z";
  for (const tc of [undefined, null, "abc", -1, 1.5, "", true]) {
    const r = await walkScripted({ version: 1, baselineStartedAt: baseline, walk: null }, () => ({ items: all, totalCount: tc }));
    assertEquals(r.res.stopReason, "fetch_error", `totalCount=${String(tc)}`);
    assertEquals(r.res.state.lastTick?.fetchError, "bad_total_count");
    assertEquals(r.res.state.baselineStartedAt, baseline);
    assertEquals(r.visited, []);
  }
  const ok = await walkScripted({ version: 1, baselineStartedAt: null, walk: null }, () => ({ items: all, totalCount: "50" }));
  assertEquals(ok.res.stopReason, "end_of_list");
  assertEquals(ok.visited.length, 50);
});

Deno.test("(B6) Empty inbox (offset 0, totalCount 0): walk ends, baseline NOT advanced (null stays null, a known baseline is kept); offset 0 empty with totalCount > 0 → fetch_error", async () => {
  const fresh = await walkScripted({ version: 1, baselineStartedAt: null, walk: null }, () => ({ items: [], totalCount: 0 }));
  assertEquals(fresh.res.stopReason, "end_of_list");
  assertEquals(fresh.res.state.walk, null);
  assertEquals(fresh.res.state.baselineStartedAt, null);
  const baseline = "2026-09-01T00:00:00.000Z";
  const known = await walkScripted({ version: 1, baselineStartedAt: baseline, walk: null }, () => ({ items: [], totalCount: 0 }));
  assertEquals(known.res.stopReason, "end_of_list", "an empty page is never 'older than the cutoff'");
  assertEquals(known.res.state.baselineStartedAt, baseline);
  const bad = await walkScripted({ version: 1, baselineStartedAt: baseline, walk: null }, () => ({ items: [], totalCount: 5 }));
  assertEquals(bad.res.stopReason, "fetch_error");
  assertEquals(bad.res.state.baselineStartedAt, baseline);
  assertEquals(bad.res.state.walk!.offset, 0);
});

Deno.test("(B7) List shrank below the resume point: steps back to the reported end, finds lastId, resumes after it; mid-walk shrink → fetch_error", async () => {
  const full = makeList(300, "k");
  const baseline = "2026-09-01T00:00:00.000Z";
  const state = resumeState(full, 250, baseline); // cursor after k249
  const shrunk = full.slice(100); // 100 conversations removed from the top: k249 is now at index 149
  const r = await walkScripted(state, healthy(shrunk));
  assertEquals(r.offsets[0], 225, "first fetch is the normal resume point");
  assertEquals(r.offsets[1], 125, "then back by min(backStep, to totalCount - 25): min(225-100, 200-25)");
  assert(!r.offsets.includes(0), "never resets to offset 0");
  assertEquals(r.visited[0], "k250");
  assertEquals(r.visited.length, 50);
  assertEquals(r.res.stopReason, "end_of_list");
  // Mid-walk (already verified): an empty page claiming the list ended at this offset is still a fetch_error.
  const all = makeList(150, "m");
  const r2 = await walkScripted({ version: 1, baselineStartedAt: baseline, walk: null }, (offset, limit) =>
    offset === 100 ? { items: [], totalCount: 100 } : { items: all.slice(offset, offset + limit), totalCount: 150 });
  assertEquals(r2.res.stopReason, "fetch_error");
  assertEquals(r2.res.state.baselineStartedAt, baseline);
  assertEquals(r2.res.state.walk!.offset, 100);
});

Deno.test("(B8) checkPage rules", () => {
  const it = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
  assertEquals(checkPage(null, 0, 100).ok, false);
  assertEquals(checkPage({ items: [], totalCount: 0 }, 0, 100).ok, true);
  assertEquals(checkPage({ items: [], totalCount: 0 }, 100, 100).ok, false);
  assertEquals(checkPage({ items: it(100), totalCount: 250 }, 100, 100).ok, true);
  assertEquals(checkPage({ items: it(50), totalCount: 250 }, 200, 100).ok, true);
  assertEquals(checkPage({ items: it(49), totalCount: 250 }, 200, 100).ok, false);
  assertEquals(checkPage({ items: it(3), totalCount: 0 }, 0, 100).ok, false);
});

Deno.test("(BH) Head scan: page 1 empty (total > 0) / short / non-array / bad totalCount → head-scan fetch_error, walk state untouched, walk still runs; empty inbox → complete, 0 items", async () => {
  const all = makeList(1893, "w");
  const bads: RawPage[] = [
    { items: [], totalCount: 1893 },
    { items: all.slice(0, 40), totalCount: 1893 },
    { items: "nope", totalCount: 1893 },
    { items: all.slice(0, 100) },
  ];
  for (const bad of bads) {
    const state = deepState(all);
    const before = structuredClone(state.walk);
    const clock = makeClock(0);
    const walkVisited: string[] = [];
    const headVisited: string[] = [];
    let walkSawState: WalkState | null = null;
    let fetches = 0;
    const res = await tickWithHeadScan<Item>({
      async fetchPage(offset, limit, _s, phase) {
        fetches++;
        await clock.sleepMs(1_000);
        if (phase === "head") return bad;
        if (!walkSawState) walkSawState = structuredClone(state);
        return { items: all.slice(offset, offset + limit), totalCount: all.length };
      },
      async processItem(item, _s, phase) { await clock.sleepMs(100); (phase === "head" ? headVisited : walkVisited).push(item.id); },
      nowMs: clock.nowMs,
      async saveState(_st) {},
    }, state, { ...DEFAULT_PAGER_OPTIONS });
    assertEquals(res.headScan.stopReason, "fetch_error", JSON.stringify(bad).slice(0, 60));
    assertEquals(res.headScan.items, 0);
    assertEquals(headVisited, []);
    assertEquals(walkSawState!.walk, before);
    assertEquals(walkVisited[0], "w900");
    assert(fetches >= 2);
  }
  // Empty inbox on page 1 is not an error: nothing to do.
  const clock = makeClock(0);
  const st: WalkState = { version: 1, baselineStartedAt: null, walk: { startedAt: "2026-09-19T00:00:00.000Z", cutoff: null, offset: 5, lastTs: null, lastId: "gone", failures: 0 } };
  const r = await tickWithHeadScan<Item>({
    async fetchPage(_o, _l, _s) { return { items: [], totalCount: 0 }; },
    async processItem() {},
    nowMs: clock.nowMs,
    async saveState() {},
  }, st, { ...DEFAULT_PAGER_OPTIONS });
  assertEquals(r.headScan.stopReason, "complete");
  assertEquals(r.headScan.items, 0);
});

// ---------------------------------------------------------------------------
// Capture Scope keying (S*)
// ---------------------------------------------------------------------------
Deno.test("(S1) applyScope: same set (any order) keeps state; changed set, scoped<->unfiltered, or unrecorded scope resets baseline and walk", () => {
  const walk = { startedAt: "2026-09-19T00:00:00.000Z", cutoff: null, offset: 400, lastTs: null, lastId: "c399", failures: 0 };
  const base = (scope?: WalkState["scope"]): WalkState => ({ version: 1, baselineStartedAt: "2026-09-10T00:00:00.000Z", walk: { ...walk }, ...(scope ? { scope } : {}) });
  assertEquals(canonicalScope([508828, 518402, 508828]), { unfiltered: false, campaignIds: [508828, 518402] });
  assertEquals(canonicalScope([]), { unfiltered: true, campaignIds: [] });

  const same = applyScope(base({ unfiltered: false, campaignIds: [508828, 518402] }), canonicalScope([518402, 508828]));
  assertEquals([same.changed, same.reset], [false, false]);
  assertEquals(same.state.walk!.offset, 400);
  assertEquals(same.state.baselineStartedAt, "2026-09-10T00:00:00.000Z");

  for (const [prev, next] of [
    [{ unfiltered: false, campaignIds: [508828] }, canonicalScope([508828, 518402])], // campaign enabled
    [{ unfiltered: false, campaignIds: [508828, 518402] }, canonicalScope([508828])], // campaign disabled
    [{ unfiltered: true, campaignIds: [] }, canonicalScope([508828])],               // unfiltered -> scoped
    [{ unfiltered: false, campaignIds: [508828] }, canonicalScope([])],              // scoped -> unfiltered
    [undefined, canonicalScope([])],                                                // unrecorded (pre-patch state)
  ] as const) {
    const r = applyScope(base(prev as WalkState["scope"]), next);
    assertEquals([r.changed, r.reset], [true, true], JSON.stringify(prev));
    assertEquals(r.state.baselineStartedAt, null);
    assertEquals(r.state.walk, null);
    assertEquals(r.state.scope, next);
  }
  // Fresh state: scope recorded, nothing to reset.
  const fresh = applyScope({ version: 1, baselineStartedAt: null, walk: null }, canonicalScope([7]));
  assertEquals([fresh.changed, fresh.reset], [true, false]);
  assertEquals(fresh.state.scope, { unfiltered: false, campaignIds: [7] });
});

Deno.test("(S2) Scope change end to end: a newly enabled campaign's conversations older than the old baseline are walked after the reset", async () => {
  const T0 = Date.parse("2026-09-20T00:00:00Z");
  const all = makeList(150, "c", T0 - 30 * 24 * 3600_000); // all 30+ days older than the baseline
  const oldState: WalkState = { version: 1, baselineStartedAt: new Date(T0).toISOString(), walk: null, scope: { unfiltered: false, campaignIds: [1] } };
  // Without a reset, the old baseline makes the first page caught_up with nothing processed.
  const kept = await walkScripted(applyScope(structuredClone(oldState), canonicalScope([1])).state, healthy(all));
  assertEquals(kept.res.stopReason, "caught_up");
  assertEquals(kept.visited, []);
  // Campaign 2 enabled: reset → every conversation of the new scope is walked.
  const reset = await walkScripted(applyScope(structuredClone(oldState), canonicalScope([1, 2])).state, healthy(all));
  assertEquals(reset.res.stopReason, "end_of_list");
  assertEquals(reset.visited.length, 150);
  assertEquals(reset.res.state.scope, { unfiltered: false, campaignIds: [1, 2] });
});

Deno.test("(S3) tickHeadScanOnly (scope lookup failed): page 1 processed even with no walk, baseline/walk/scope untouched, lastTick fetch_error", async () => {
  const all = makeList(300, "h");
  for (const walk of [null, { startedAt: "2026-09-19T00:00:00.000Z", cutoff: null, offset: 200, lastTs: all[199].lastMessageAt, lastId: all[199].id, failures: 1 }]) {
    const state: WalkState = { version: 1, baselineStartedAt: "2026-09-10T00:00:00.000Z", walk: structuredClone(walk), scope: { unfiltered: false, campaignIds: [9] } };
    const before = structuredClone(state);
    const clock = makeClock(0);
    const offsets: number[] = [];
    const visited: string[] = [];
    let saved: WalkState | null = null;
    const r = await tickHeadScanOnly<Item>({
      async fetchPage(offset, limit, _s) { offsets.push(offset); await clock.sleepMs(1_000); return { items: all.slice(offset, offset + limit), totalCount: all.length }; },
      async processItem(it, _s) { await clock.sleepMs(100); visited.push(it.id); },
      nowMs: clock.nowMs,
      async saveState(st) { saved = structuredClone(st); },
    }, state, { ...DEFAULT_PAGER_OPTIONS }, "scope_lookup_failed");
    assertEquals(offsets, [0]);
    assertEquals(visited.length, 100);
    assertEquals(r.headScan.stopReason, "complete");
    assertEquals(r.stopReason, "fetch_error");
    assertEquals(r.state.walk, before.walk);
    assertEquals(r.state.baselineStartedAt, before.baselineStartedAt);
    assertEquals(r.state.scope, before.scope);
    assertEquals(r.state.lastTick?.fetchError, "scope_lookup_failed");
    assertEquals(saved!.walk, before.walk);
  }
});

// ---------------------------------------------------------------------------
// Missing lastMessageAt (L1)
// ---------------------------------------------------------------------------
Deno.test("(L1) Items without lastMessageAt: one warning per tick (head scan + walk combined) and lastTick.missingLastMessageAt", async () => {
  const all = makeList(1893, "w");
  delete (all[3] as { lastMessageAt?: string }).lastMessageAt;            // on page 1 (head scan)
  (all[905] as { lastMessageAt: string }).lastMessageAt = "not a date";  // on the walk's first page
  const state = deepState(all);
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
  try {
    const clock = makeClock(0);
    const r = await tickWithHeadScan<Item>({
      async fetchPage(offset, limit, _s) { await clock.sleepMs(2_000); return { items: all.slice(offset, offset + limit), totalCount: all.length }; },
      async processItem() { await clock.sleepMs(500); },
      nowMs: clock.nowMs,
      async saveState() {},
    }, state, { ...DEFAULT_PAGER_OPTIONS });
    const missing = warns.filter((w) => w.includes("missing_lastMessageAt"));
    assertEquals(missing.length, 1, warns.join("\n"));
    assert(missing[0].includes("2 item(s)"), missing[0]);
    assert(missing[0].includes("first id=w3"), missing[0]);
    assertEquals(r.state.lastTick?.missingLastMessageAt, 2);
  } finally {
    console.warn = realWarn;
  }
});
