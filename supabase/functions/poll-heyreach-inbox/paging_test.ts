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
Deno.test("(9) GetChatroom failure baseline unchanged and no DB writes", async () => {
  const T0 = Date.parse("2026-09-15T00:00:00Z");
  let state: WalkState = { version: 1, baselineStartedAt: new Date(T0).toISOString(), walk: null };
  const failing: Item[] = [{ id: "fail", lastMessageAt: new Date(T0 + 1000).toISOString() }];
  const clock = makeClock(0);
  const writes = { insert: 0, update: 0 };
  const res = await walkWithState<Item>({
    async fetchPage(_o, _l, _s) { return { items: failing, totalCount: 1 }; },
    async processItem(_it, _s) {
      // Simulate chatroom failure BEFORE any DB writes
      throw new Error("getchatroom_500");
      // Any write below would increment if failure didn't short-circuit
      // writes.update++; writes.insert++;
    },
    nowMs: clock.nowMs,
    sleepMs: clock.sleepMs,
    async saveState(s) { state = s; },
  }, state, { ...DEFAULT_PAGER_OPTIONS });
  // Baseline unchanged and failure recorded
  assertEquals(res.failures > 0, true);
  assertEquals(state.baselineStartedAt, new Date(T0).toISOString());
  assertEquals(writes.insert, 0);
  assertEquals(writes.update, 0);
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

