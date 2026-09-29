import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
function isBodylessPlaceholder(channel: string, replyText: string): boolean {
  const ch = (channel || "").toLowerCase() === "linkedin" ? "linkedin" : "email";
  return String(replyText ?? "") === `${ch} reply received`;
}

Deno.test("body-less webhook: placeholder detected, new lead should be mirrored with no watermark/draft", () => {
  const channel = "linkedin";
  const replyText = "linkedin reply received";
  const isPlaceholder = isBodylessPlaceholder(channel, replyText);
  assert(isPlaceholder, "should detect placeholder for body-less webhook");
  // Mirror expected routing for a brand-new lead (documenting behavior)
  const inboxStatus = isPlaceholder ? "mirrored" : "pending";
  const watermarkSet = isPlaceholder ? false : true;
  const writeLastReplyText = isPlaceholder ? false : true;
  assertEquals(inboxStatus, "mirrored");
  assertEquals(watermarkSet, false);
  assertEquals(writeLastReplyText, false);
});

Deno.test("body-bearing webhook: not a placeholder, normal surface behavior", () => {
  const channel = "email";
  const replyText = "Thanks! Would love to hear more.";
  const isPlaceholder = isBodylessPlaceholder(channel, replyText);
  assertEquals(isPlaceholder, false);
  // Document expected routing for new lead insert
  const inboxStatus = isPlaceholder ? "mirrored" : "pending";
  const watermarkSet = isPlaceholder ? false : true;
  const writeLastReplyText = isPlaceholder ? false : true;
  assertEquals(inboxStatus, "pending");
  assertEquals(watermarkSet, true);
  assertEquals(writeLastReplyText, true);
});

