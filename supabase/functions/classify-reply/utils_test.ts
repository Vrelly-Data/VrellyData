import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPlaceholderReplyText, pickLastProspectContentFromThread } from "./utils.ts";

Deno.test("isPlaceholderReplyText detects canned placeholders", () => {
  assert(isPlaceholderReplyText("email reply received", "email"));
  assert(isPlaceholderReplyText("Email Reply Received", "email"));
  assert(isPlaceholderReplyText("linkedin reply received", "linkedin"));
  assert(isPlaceholderReplyText("LinkedIn Reply Received", "linkedin"));
  // Channel-specific phrase
  assert(isPlaceholderReplyText("email reply received", "linkedin") === true);
  // Real content should not be treated as placeholder
  assert(isPlaceholderReplyText("Yes let's find time next week.", "email") === false);
});

Deno.test("pickLastProspectContentFromThread returns latest prospect message", () => {
  const thread = [
    { role: "sender", content: "Outbound pitch", channel: "email", timestamp: "2026-09-10T10:00:00Z" },
    { role: "prospect", content: "Sounds interesting.", channel: "email", timestamp: "2026-09-10T10:02:00Z" },
    { role: "sender", content: "We can help with X.", channel: "email", timestamp: "2026-09-10T10:03:00Z" },
    { role: "prospect", content: "Yes let’s find time next week. What’s a good day?", channel: "email", timestamp: "2026-09-10T10:05:00Z" },
  ];
  const picked = pickLastProspectContentFromThread(thread, { channel: "email" });
  assertEquals(picked, "Yes let’s find time next week. What’s a good day?");
});

Deno.test("pickLastProspectContentFromThread respects channel when provided", () => {
  const thread = [
    { role: "prospect", content: "Email reply here", channel: "email", timestamp: "2026-09-10T10:00:00Z" },
    { role: "prospect", content: "LinkedIn reply here", channel: "linkedin", timestamp: "2026-09-10T10:05:00Z" },
  ];
  // When asking for email, returns the email one despite a newer LinkedIn message
  const pickedEmail = pickLastProspectContentFromThread(thread, { channel: "email" });
  assertEquals(pickedEmail, "Email reply here");
  // When asking for linkedin, returns the linkedin one
  const pickedLi = pickLastProspectContentFromThread(thread, { channel: "linkedin" });
  assertEquals(pickedLi, "LinkedIn reply here");
});

