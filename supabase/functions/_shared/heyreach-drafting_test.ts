import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { HEYREACH_DRAFTING_ENV, heyreachClassifyGate, isHeyReachDraftingEnabled } from "./heyreach-drafting.ts";

Deno.test("HeyReach drafting flag: env var name", () => {
  assertEquals(HEYREACH_DRAFTING_ENV, "HEYREACH_DRAFTING_ENABLED");
});

Deno.test("HeyReach drafting flag: only the exact string 'true' enables it (default OFF)", () => {
  assertEquals(isHeyReachDraftingEnabled("true"), true);
  for (const v of [undefined, null, "", "TRUE", "True", " true", "true ", "1", "yes", "on", "false", "0"]) {
    assertEquals(isHeyReachDraftingEnabled(v), false, `value ${JSON.stringify(v)} must be OFF`);
  }
});

Deno.test("heyreachClassifyGate: flag off + fresh surfaced reply → no classify (drafting_disabled)", () => {
  assertEquals(heyreachClassifyGate({ surface: true, willClassify: true }, false), { classify: false, reason: "drafting_disabled" });
});

Deno.test("heyreachClassifyGate: flag on + fresh surfaced reply → classify", () => {
  assertEquals(heyreachClassifyGate({ surface: true, willClassify: true }, true), { classify: true, reason: "classify" });
});

Deno.test("heyreachClassifyGate: flag on + stale surfaced reply → no classify (stale)", () => {
  assertEquals(heyreachClassifyGate({ surface: true, willClassify: false }, true), { classify: false, reason: "stale" });
  assertEquals(heyreachClassifyGate({ surface: true, willClassify: false }, false), { classify: false, reason: "stale" });
});

Deno.test("heyreachClassifyGate: not surfaced → no classify regardless of flag", () => {
  assertEquals(heyreachClassifyGate({ surface: false, willClassify: false }, true), { classify: false, reason: "not_surfaced" });
  // Defensive: an inconsistent decision (willClassify without surface) still never classifies.
  assertEquals(heyreachClassifyGate({ surface: false, willClassify: true }, true), { classify: false, reason: "not_surfaced" });
});
