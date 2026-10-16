// heyreach-inference: the one 'replied' row both HeyReach writers produce.
// Run: deno test supabase/functions/_shared/heyreach-inference_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildHeyReachRepliedEvent,
  heyReachRepliedEventsFromChatroom,
  isNearDuplicate,
  newestThreadTimestamp,
  writeHeyReachRepliedEvent,
} from "./heyreach-inference.ts";

const lang = () => ({ code: "en", method: "test" });
const base = {
  teamId: "team-1",
  agentConfigId: "cfg-1",
  conversationId: "conv-1",
  linkedinUrl: "https://www.linkedin.com/in/p",
  externalId: "conv-1",
  fullName: "P Q",
};

Deno.test("key = conversation : newest thread timestamp (ISO), as the webhook always wrote it", () => {
  const row = buildHeyReachRepliedEvent({
    ...base,
    thread: [
      { role: "sender", content: "hi", timestamp: "2026-10-01T10:00:00Z" },
      { role: "prospect", content: "yes", timestamp: "2026-10-01T11:00:00.5Z" },
    ],
    replyText: "yes",
    language: lang(),
  })!;
  assertEquals(row.source, "heyreach_webhook");
  assertEquals(row.event_type, "replied");
  assertEquals(row.source_row_id, "conv-1:2026-10-01T11:00:00.500Z");
  assertEquals(row.occurred_at, "2026-10-01T11:00:00.500Z");
  assertEquals(row.person_key, "https://www.linkedin.com/in/p");
  assertEquals(newestThreadTimestamp([{ role: "x", content: "", timestamp: "nope" }]), null);
});

Deno.test("no conversation id or no timestamp → no row (the webhook's existing skip)", () => {
  assertEquals(buildHeyReachRepliedEvent({ ...base, conversationId: null, thread: [{ role: "prospect", content: "a", timestamp: "2026-10-01T00:00:00Z" }], replyText: "a", language: lang() }), null);
  assertEquals(buildHeyReachRepliedEvent({ ...base, thread: [], replyText: "a", language: lang() }), null);
});

Deno.test("chatroom: one row per recent prospect message, keyed on the thread up to that message", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const rows = heyReachRepliedEventsFromChatroom(base, [
    { sender: "ME", body: "pitch", createdAt: "2026-08-01T00:00:00Z" },
    { sender: "THEM", body: "too old", createdAt: "2026-09-01T00:00:00Z" }, // > 30 days
    { sender: "ME", body: "follow up", createdAt: "2026-10-02T00:00:00Z" },
    { id: 77, sender: "THEM", body: "sounds good", createdAt: "2026-10-03T00:00:00Z" },
    { sender: "ME", body: "great, booking", createdAt: "2026-10-04T00:00:00Z" }, // after it: not in its key
  ], { maxAgeDays: 30, nowMs: now, limit: 5, detectLanguage: lang });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].source_row_id, "conv-1:2026-10-03T00:00:00.000Z");
  assertEquals((rows[0].metadata as Record<string, unknown>).reply_text, "sounds good");
  assertEquals((rows[0].metadata as Record<string, unknown>).provider_message_id, "77");
});

Deno.test("near duplicate: same conversation within 2 min under another key; exact key is not 'near'", () => {
  const row = { source_row_id: "conv-1:2026-10-03T00:00:00.000Z", occurred_at: "2026-10-03T00:00:00.000Z", metadata: { conversation_id: "conv-1" } };
  assertEquals(isNearDuplicate(row, [{ source_row_id: "conv-1:2026-10-03T00:01:30.000Z", occurred_at: "2026-10-03T00:01:30.000Z", metadata: { conversation_id: "conv-1" } }]), true);
  assertEquals(isNearDuplicate(row, [{ source_row_id: "conv-1:2026-10-03T00:03:00.000Z", occurred_at: "2026-10-03T00:03:00.000Z", metadata: { conversation_id: "conv-1" } }]), false);
  assertEquals(isNearDuplicate(row, [{ source_row_id: "conv-2:x", occurred_at: "2026-10-03T00:00:10.000Z", metadata: { conversation_id: "conv-2" } }]), false);
  assertEquals(isNearDuplicate(row, [{ ...row }]), false);
});

// Minimal PostgREST-shaped fake: records upserts, answers the dedupe read.
function fakeDb(existing: Array<Record<string, unknown>>, failRead = false) {
  const upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const q = {
    select: () => q, eq: () => q, is: () => q, gte: () => q, lte: () => q, abortSignal: () => q,
    limit: async () => (failRead ? { data: null, error: { message: "boom" } } : { data: existing, error: null }),
  };
  return {
    upserts,
    from: (_t: string) => ({
      ...q,
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        upserts.push({ row, opts });
        const p = Promise.resolve({ error: null });
        return Object.assign(p, { abortSignal: () => p });
      },
    }),
  };
}

const row = buildHeyReachRepliedEvent({
  ...base,
  thread: [{ role: "prospect", content: "yes", timestamp: "2026-10-03T00:00:00Z" }],
  replyText: "yes",
  language: lang(),
})!;

Deno.test("write: poller insert ignores duplicates; webhook keeps its upsert", async () => {
  const db = fakeDb([]);
  assertEquals(await writeHeyReachRepliedEvent(db, row, "insert"), "written");
  assertEquals(db.upserts[0].opts, { onConflict: "source,source_row_id,event_type", ignoreDuplicates: true });
  const db2 = fakeDb([]);
  assertEquals(await writeHeyReachRepliedEvent(db2, row, "upsert"), "written");
  assertEquals(db2.upserts[0].opts.ignoreDuplicates, false);
});

Deno.test("write: webhook already recorded it (exact key or within 2 min) → poller writes nothing", async () => {
  const exact = fakeDb([{ source_row_id: row.source_row_id, occurred_at: row.occurred_at, metadata: { conversation_id: "conv-1" } }]);
  assertEquals(await writeHeyReachRepliedEvent(exact, row, "insert"), "duplicate");
  assertEquals(exact.upserts.length, 0);
  const near = fakeDb([{ source_row_id: "conv-1:2026-10-03T00:00:40.000Z", occurred_at: "2026-10-03T00:00:40.000Z", metadata: { conversation_id: "conv-1" } }]);
  assertEquals(await writeHeyReachRepliedEvent(near, row, "insert"), "duplicate");
  // and the webhook arriving after the poller does not add a second row either
  assertEquals(await writeHeyReachRepliedEvent(near, row, "upsert"), "duplicate");
  assertEquals(near.upserts.length, 0);
});

Deno.test("write: dedupe read fails → nothing written, no throw", async () => {
  const db = fakeDb([], true);
  assertEquals(await writeHeyReachRepliedEvent(db, row, "insert"), "error");
  assertEquals(db.upserts.length, 0);
  assertEquals(await writeHeyReachRepliedEvent(db, null, "insert"), "skipped");
});
