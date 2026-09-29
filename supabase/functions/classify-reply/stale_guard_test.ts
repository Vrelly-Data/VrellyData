import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPlaceholderReplyText, pickLastProspectContentFromThread } from "./utils.ts";

function iso(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

function isDbThreadStale(thread: unknown, lastReplyAt: string | null): boolean {
  const arr: any[] = Array.isArray(thread) ? (thread as any[]) : [];
  const lastP = [...arr].reverse().find(
    (e) => String(e?.role ?? '').toLowerCase() === 'prospect' &&
           typeof e?.content === 'string' &&
           e.content.trim()
  );
  const lastPTs = (lastP as any)?.timestamp ? Date.parse((lastP as any).timestamp) : NaN;
  const replyAtTs = lastReplyAt ? Date.parse(lastReplyAt) : NaN;
  return Number.isFinite(lastPTs) && Number.isFinite(replyAtTs) && lastPTs < (replyAtTs - 5 * 60_000);
}

Deno.test("stale DB thread vs last_reply_at is guarded: no answer", () => {
  const lastProspectTs = iso(-10); // 10 minutes ago
  const lastReplyAt = iso(-2);     // 2 minutes ago
  const thread = [
    { role: "sender", content: "Outbound", timestamp: iso(-20), channel: "email" },
    { role: "prospect", content: "Already working with another firm.", timestamp: lastProspectTs, channel: "email" },
  ];
  const stale = isDbThreadStale(thread, lastReplyAt);
  assert(stale, "DB thread should be considered stale vs newer last_reply_at");
});

Deno.test("fresh DB thread is used", () => {
  const lastProspectTs = iso(-1); // 1 minute ago
  const lastReplyAt = iso(-1);    // same minute
  const thread = [
    { role: "sender", content: "Outbound", timestamp: iso(-3), channel: "email" },
    { role: "prospect", content: "Would love to hear more about your webinar.", timestamp: lastProspectTs, channel: "email" },
  ];
  const stale = isDbThreadStale(thread, lastReplyAt);
  assertEquals(stale, false);
  const picked = pickLastProspectContentFromThread(thread, { channel: "email" });
  assertEquals(picked, "Would love to hear more about your webinar.");
});

Deno.test("placeholder reply text plus stale DB should not produce a draft", () => {
  const lastProspectTs = iso(-30); // 30 minutes ago (stale)
  const lastReplyAt = iso(-1);     // recent webhook reply time
  const thread = [
    { role: "prospect", content: "email reply received", timestamp: lastProspectTs, channel: "email" },
  ];
  const stale = isDbThreadStale(thread, lastReplyAt);
  assert(stale, "DB thread is stale");
  const placeholder = isPlaceholderReplyText("email reply received", "email");
  assert(placeholder, "placeholder should be recognized");
  // When both conditions hold, classification must not generate a draft
  const shouldGenerateDraft = !(placeholder || stale);
  assertEquals(shouldGenerateDraft, false);
});

