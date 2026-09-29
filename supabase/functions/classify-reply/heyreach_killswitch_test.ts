import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldSuppressHeyreachDrafting } from "../_shared/flags.ts";

function read(fileUrl: URL): string {
  return Deno.readTextFileSync(fileUrl);
}

Deno.test("shouldSuppressHeyreachDrafting logic", () => {
  // Default env OFF in tests — suppression should trigger for LinkedIn/HeyReach
  assertEquals(shouldSuppressHeyreachDrafting("linkedin", null), true);
  assertEquals(shouldSuppressHeyreachDrafting("email", "heyreach"), true);
  assertEquals(shouldSuppressHeyreachDrafting("email", "reply_io"), false);
  assertEquals(shouldSuppressHeyreachDrafting("email", null), false);
});

Deno.test("classify-reply gates drafts and auto-send behind the kill switch", () => {
  const src = read(new URL("./index.ts", import.meta.url));

  // Draft persistence path must be gated by suppressDrafting
  assert(
    /if\s*\(!call2Failed\s*&&\s*!suppressDrafting\)/.test(src),
    "draft_response/inbox_status update must be gated by suppressDrafting",
  );

  // Auto-send path to send-heyreach-message must be gated by suppressDrafting
  const autoBlock = src.split("\n").slice(1235, 1310).join("\n"); // around auto-mode block region
  assert(
    /isAllowed\s*&&\s*hasDraft\s*&&\s*!isOptedOut\s*&&\s*!suppressDrafting/.test(autoBlock),
    "auto-send should include !suppressDrafting guard",
  );
  assert(src.includes("send-heyreach-message"), "sanity: file still contains send-heyreach-message path");
});

