import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { walkWithState, type WalkState, DEFAULT_PAGER_OPTIONS } from "./paging.ts";

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
    sleepMs: clock.sleepMs,
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
    sleepMs: clock.sleepMs,
    async saveState(s) { state = s; },
  }, state, { ...DEFAULT_PAGER_OPTIONS });
  // Baseline unchanged and failure recorded
  assertEquals(res.failures > 0, true);
  assertEquals(state.baselineStartedAt, new Date(T0).toISOString());
});

// (10): Missing or zero totalCount walks all 250 items
Deno.test("(10) Zero totalCount walks all 250 items", async () => {
  const all: Item[] = Array.from({ length: 250 }, (_, i) => ({
    id: `c${i + 1}`,
    lastMessageAt: new Date(6_000_000 - i * 1000).toISOString(),
  }));
  const clock = makeClock(0);
  let processed = 0;
  const r = await walkWithState<Item>({
    async fetchPage(offset, limit, _s) {
      await clock.sleepMs(20_000);
      const items = all.slice(offset, offset + limit);
      return { items, totalCount: 0 }; // zero totalCount
    },
    async processItem(_it, _s) { processed++; },
    nowMs: clock.nowMs,
    sleepMs: clock.sleepMs,
    async saveState(_s) {},
  }, { version: 1, baselineStartedAt: null, walk: null }, { ...DEFAULT_PAGER_OPTIONS });
  assertEquals(processed, 250);
  assertEquals(r.stopReason, "end_of_list");
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
      sleepMs: clock.sleepMs,
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
    sleepMs: clock.sleepMs,
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
    sleepMs: clock.sleepMs,
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
});

Deno.test("(2b) 1,893 items at a fixed 8s per item: still reaches end_of_list with strictly increasing offset", async () => {
  const rnd = mulberry32(8);
  const { visited } = await walkToEnd(1893, () => 8_000, rnd, 400);
  assertEquals(new Set(visited).size, 1893);
  assertEquals(visited.length, 1893);
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
    sleepMs: clock.sleepMs,
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
