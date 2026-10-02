import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldSuppressHeyreachDrafting } from "../_shared/flags.ts";

function read(fileUrl: URL): string {
  return Deno.readTextFileSync(fileUrl);
}

Deno.test("shouldSuppressHeyreachDrafting logic (source-only; channel irrelevant)", () => {
  // Ensure OFF for this test
  Deno.env.set("HEYREACH_DRAFTING_ENABLED", "");
  assertEquals(shouldSuppressHeyreachDrafting("heyreach"), true);
  assertEquals(shouldSuppressHeyreachDrafting("reply_io"), false); // Reply.io LinkedIn-step leads keep drafting
  assertEquals(shouldSuppressHeyreachDrafting("smartlead"), false);
  assertEquals(shouldSuppressHeyreachDrafting(null), false);
  assertEquals(shouldSuppressHeyreachDrafting(undefined), false);
  assertEquals(shouldSuppressHeyreachDrafting.length, 1, "gate must take the stored source only (no channel param)");
  // ON should disable suppression
  Deno.env.set("HEYREACH_DRAFTING_ENABLED", "true");
  assertEquals(shouldSuppressHeyreachDrafting("heyreach"), false);
  // Cleanup
  Deno.env.delete("HEYREACH_DRAFTING_ENABLED");
});

Deno.test("classify-reply gates drafts and auto-send behind the kill switch", () => {
  const src = read(new URL("./index.ts", import.meta.url));

  // Draft persistence path must be gated by suppressDrafting
  assert(
    /if\s*\(!call2Failed\s*&&\s*!suppressDrafting\)/.test(src),
    "draft_response/inbox_status update must be gated by suppressDrafting",
  );

  // Auto-send path to send-heyreach-message must be gated by suppressDrafting
  // (whole-file match; a fixed line-number window breaks whenever index.ts shifts)
  assert(
    /isAllowed\s*&&\s*hasDraft\s*&&\s*!isOptedOut\s*&&\s*!suppressDrafting/.test(src),
    "auto-send should include !suppressDrafting guard",
  );
  assert(src.includes("send-heyreach-message"), "sanity: file still contains send-heyreach-message path");
});

