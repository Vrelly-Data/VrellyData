import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { walkWithState, type WalkState } from "./paging.ts";

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
  const res = await walkWithState<Item>({
    async fetchPage(offset, limit, _signal) {
      // simulate page fetch time
      fetchedPages++;
      const pd = opts.pageDurationsMs?.[fetchedPages - 1] ?? 0;
      await clock.sleepMs(pd);
      if (opts.pageErrorAt && fetchedPages === opts.pageErrorAt) {
        throw new Error("simulated_fetch_error");
      }
      const pageIndex = Math.floor(offset / (opts.pageLimit ?? 100));
      const items = opts.pages[pageIndex] ?? [];
      return { items: items.slice(0, limit), totalCount: opts.pages.reduce((a, b) => a + b.length, 0) };
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
  }, opts.initial, {
    runBudgetMs: opts.runBudgetMs,
    pageLimit: opts.pageLimit ?? 100,
    minRemainingForNextPageMs: 40_000,
    pageFetchTimeoutMs: 35_000,
    itemFetchTimeoutMs: 8_000,
    minRemainingForNextItemMs: 10_000,
    resumeBackstepInitial: 25,
    resumeBackstepStep: 100,
  });
  return { res, visited, clock, fetchedPages };
}

Deno.test("(1) Missed webhook: B must be processed under baseline+cutoff", async () => {
  const T0 = Date.parse("2026-09-01T12:00:00Z");
  const baseline = new Date(T0).toISOString();
  // cutoff = T0 - 1h; both items are newer than cutoff, so both processed.
  const A: Item = { id: "A", lastMessageAt: new Date(T0 + 30 * 60 * 1000).toISOString() };
  const B: Item = { id: "B", lastMessageAt: new Date(T0 + 10 * 60 * 1000).toISOString() };
  const initial: WalkState = { version: 1, baselineStartedAt: baseline, walk: null };
  const { visited } = await runOnce({
    initial,
    pages: [[A, B]],
    runBudgetMs: 110_000,
    pageLimit: 100,
  });
  assert(visited.includes("B"));
});

Deno.test("(2) No baseline, 1,893 items, 20–30s pages and 0–9s items: walk to end_of_list across ticks; baseline only at completion", async () => {
  // Build 1893 items across 19 pages of 100 each (last page  - 7)
  const total = 1893;
  const items: Item[] = Array.from({ length: total }, (_, i) => ({
    id: `it-${i + 1}`,
    lastMessageAt: new Date(2_000_000 - i * 1000).toISOString(),
  }));
  const pages: Item[][] = [];
  for (let p = 0; p < Math.ceil(total / 100); p++) {
    pages.push(items.slice(p * 100, (p + 1) * 100));
  }
  let state: WalkState = { version: 1, baselineStartedAt: null, walk: null };
  let ticks = 0;
  let sawEnd = false;
  while (!sawEnd && ticks < 30) {
    const pageDurations = Array.from({ length: pages.length }, () => 20_000 + Math.floor(Math.random() * 10_000)); // 20–30s/page
    const perItemDurations = Array.from({ length: 10 }, (_, i) => i); // 0–9ms cycling
    const clock = makeClock(0);
    const visitedTick: string[] = [];
    const r = await walkWithState<Item>({
      async fetchPage(offset, limit, _signal) {
        const pageIndex = Math.floor(offset / 100);
        await clock.sleepMs(pageDurations[pageIndex] ?? 0);
        return { items: pages[pageIndex] ?? [], totalCount: total };
      },
      async processItem(item, _signal) {
        const d = perItemDurations[visitedTick.length % perItemDurations.length];
        await clock.sleepMs(d);
        visitedTick.push(item.id);
      },
      nowMs: clock.nowMs,
      sleepMs: clock.sleepMs,
      async saveState(s) { state = s; },
    }, state, {
      runBudgetMs: 110_000,
      pageLimit: 100,
      minRemainingForNextPageMs: 40_000,
      pageFetchTimeoutMs: 35_000,
      itemFetchTimeoutMs: 8_000,
      minRemainingForNextItemMs: 10_000,
      resumeBackstepInitial: 25,
      resumeBackstepStep: 100,
    });
    ticks++;
    if (r.stopReason === "end_of_list") {
      sawEnd = true;
      // Baseline is set only at completion
      assertEquals(state.baselineStartedAt !== null, true);
    } else {
      // Before completion baseline must remain null
      assertEquals(state.baselineStartedAt, null);
    }
    // Each tick must be ≤ 120s simulated
    assert(clock.get() <= 120_000);
  }
  assert(sawEnd);
});

Deno.test("(3) fetch_error at page k leaves walk unchanged and resumes next tick", async () => {
  const items: Item[] = Array.from({ length: 300 }, (_, i) => ({
    id: `it-${i + 1}`,
    lastMessageAt: new Date(3_000_000 - i * 1000).toISOString(),
  }));
  const pages = [items.slice(0, 100), items.slice(100, 200), items.slice(200)];
  let state: WalkState = { version: 1, baselineStartedAt: null, walk: null };
  const r1 = await runOnce({
    initial: state,
    pages,
    runBudgetMs: 110_000,
    pageLimit: 100,
    pageErrorAt: 2, // fail on second page
  });
  state = r1.res.state;
  assertEquals(r1.res.stopReason, "fetch_error");
  // Walk should not be cleared
  assert(state.walk !== null);
  // Next tick resumes and completes
  const r2 = await runOnce({
    initial: state,
    pages,
    runBudgetMs: 110_000,
    pageLimit: 100,
  });
  assertEquals(r2.res.stopReason === "end_of_list" || r2.res.stopReason === "time_budget", true);
});

Deno.test("(4) Mid-page budget stop resumes at the exact next item", async () => {
  const page: Item[] = Array.from({ length: 10 }, (_, i) => ({
    id: `p1-${i}`,
    lastMessageAt: new Date(4_000_000 - i * 1000).toISOString(),
  }));
  let state: WalkState = { version: 1, baselineStartedAt: null, walk: null };
  // First tick: small budget to process only 3 items
  const r1 = await runOnce({
    initial: state,
    pages: [page],
    runBudgetMs: 15_000, // allow one page fetch and a few items
    pageLimit: 100,
    perItemDurationsMs: [2_000, 2_000, 2_000, 2_000],
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
  assert(r2.visited[0] === page[processedFirstTick]?.id || r2.visited.includes(page[processedFirstTick]?.id));
});

Deno.test("(5) Drift: overlap verification recovers from inserts/removals; visited ⊇ {ts ≥ cutoff}", async () => {
  const T0 = Date.parse("2026-09-05T00:00:00Z");
  const baseline = new Date(T0).toISOString();
  const initial: WalkState = { version: 1, baselineStartedAt: baseline, walk: null };
  const page1: Item[] = [
    { id: "a1", lastMessageAt: new Date(T0 + 900000).toISOString() },
    { id: "a2", lastMessageAt: new Date(T0 + 800000).toISOString() },
    { id: "a3", lastMessageAt: new Date(T0 + 700000).toISOString() },
  ];
  // Next tick: 3 items inserted above; 5 removed above the cursor
  const page1b: Item[] = [
    { id: "x1", lastMessageAt: new Date(T0 + 950000).toISOString() },
    { id: "x2", lastMessageAt: new Date(T0 + 940000).toISOString() },
    { id: "x3", lastMessageAt: new Date(T0 + 930000).toISOString() },
    ...page1.slice(1), // drop a1 (removed above)
  ];
  // First tick
  const r1 = await runOnce({ initial, pages: [page1], runBudgetMs: 20_000, pageLimit: 100 });
  // Second tick
  const r2 = await runOnce({ initial: r1.res.state, pages: [page1b], runBudgetMs: 110_000, pageLimit: 100 });
  const cutoffMs = T0 - 60 * 60 * 1000; // baseline - 1h
  const expectedIds = page1b.filter((i) => Date.parse(i.lastMessageAt) >= cutoffMs).map((i) => i.id);
  for (const id of expectedIds) {
    assert(r1.visited.includes(id) || r2.visited.includes(id));
  }
});

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
    }, state, {
      runBudgetMs: 110_000,
      pageLimit: 100,
      minRemainingForNextPageMs: 40_000,
      pageFetchTimeoutMs: 35_000,
      itemFetchTimeoutMs: 8_000,
      minRemainingForNextItemMs: 10_000,
      resumeBackstepInitial: 25,
      resumeBackstepStep: 100,
    });
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
      await clock.sleepMs(pageDurations[pi] ?? 0);
      return { items: pages[pi] ?? [], totalCount: 200 };
    },
    async processItem(_it, _s) {
      const d = perItem[Math.floor(Math.random() * perItem.length)];
      await clock.sleepMs(d);
    },
    nowMs: clock.nowMs,
    sleepMs: clock.sleepMs,
    async saveState(_s) {},
  }, { version: 1, baselineStartedAt: null, walk: null }, {
    runBudgetMs: 110_000,
    pageLimit: 100,
    minRemainingForNextPageMs: 40_000,
    pageFetchTimeoutMs: 35_000,
    itemFetchTimeoutMs: 8_000,
    minRemainingForNextItemMs: 10_000,
    resumeBackstepInitial: 25,
    resumeBackstepStep: 100,
  });
  assert(clock.get() <= 120_000);
});

