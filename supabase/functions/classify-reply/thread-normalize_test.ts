import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveSenderSignals,
  normalizeThread,
  pickLatestGenuineProspect,
  type RawThreadEntry,
} from "./thread-normalize.ts";

Deno.test("detects forwarded copies and relabels to sender", () => {
  const thread: RawThreadEntry[] = [
    { role: "sender", channel: "email", content: "Outbound pitch A", timestamp: "2026-09-10T10:00:00Z" },
    {
      role: "prospect",
      channel: "email",
      content: "-----Original Message-----\nFrom: Me <me@sourcecodeals.com>\nSubject: Hi",
      timestamp: "2026-09-10T10:05:00Z",
    },
  ];
  const signals = deriveSenderSignals({
    agentSenderName: "Alia Ballout",
    mailboxEmails: ["alia@sourcecodeals.com"],
    mailboxFromNames: ["Alia Ballout"],
  });
  const { normalized, relabelCount } = normalizeThread(thread, { channel: "email", signals });
  assertEquals(relabelCount, 1);
  assertEquals(normalized[1].role, "sender");
});

Deno.test("relabels by known sender domain match", () => {
  const thread: RawThreadEntry[] = [
    { role: "prospect", channel: "email", content: "Thanks,\n\nAlia Ballout\nSenior M&A Analyst\n@sourcecodeals.com", timestamp: "2026-09-10T10:10:00Z" },
  ];
  const signals = deriveSenderSignals({
    agentSenderName: "Alia Ballout",
    mailboxEmails: ["alia@sourcecodeals.com"],
    mailboxFromNames: ["Alia Ballout"],
  });
  const { normalized, relabelCount } = normalizeThread(thread, { channel: "email", signals });
  assertEquals(relabelCount, 1);
  assertEquals(normalized[0].role, "sender");
});

Deno.test("keeps genuine prospect and strips quoted chains for email", () => {
  const thread: RawThreadEntry[] = [
    {
      role: "prospect",
      channel: "email",
      content:
        "Yes next week works.\n\nFrom: Elliot Belton <elliot@company.com>\nSubject: Quick question\n\nEarlier outbound content...",
      timestamp: "2026-09-10T11:00:00Z",
    },
  ];
  const signals = deriveSenderSignals({ agentSenderName: "Elliot" });
  const { normalized, relabelCount } = normalizeThread(thread, { channel: "email", signals });
  assertEquals(relabelCount, 0);
  assertEquals(normalized[0].role, "prospect");
  assert(normalized[0].cleanContent.length < normalized[0].content.length); // stripped quoted part
  assert(normalized[0].cleanContent.toLowerCase().includes("yes next week works."));
});

Deno.test("picks latest genuine prospect by timestamp", () => {
  const thread: RawThreadEntry[] = [
    { role: "prospect", channel: "email", content: "First", timestamp: "2026-09-10T10:00:00Z" },
    { role: "sender", channel: "email", content: "Outbound", timestamp: "2026-09-10T10:02:00Z" },
    { role: "prospect", channel: "email", content: "Second", timestamp: "2026-09-10T10:05:00Z" },
  ];
  const signals = deriveSenderSignals({ agentSenderName: "Elliot" });
  const { normalized } = normalizeThread(thread, { channel: "email", signals });
  const { latest } = pickLatestGenuineProspect(normalized);
  assertEquals(latest?.cleanContent, "Second");
});

