// Static guard for the HeyReach ingestion files (replaces the #87 kill-switch
// grep test). HeyReach drafting is back behind HEYREACH_DRAFTING_ENABLED
// (default OFF), so classify-reply may be referenced again, but only from the
// two gated call sites. Behaviour is covered by the handler-level tests in
// poll-heyreach-inbox/index_chatroom_test.ts and
// heyreach-webhook/drafting_gate_test.ts; this file pins the structure:
//   - no ingestion file ever calls a SEND function or touches draft columns
//     (drafts are written only inside classify-reply);
//   - paging.ts and recover-heyreach-leads never classify at all;
//   - poller and webhook each have exactly one classify-reply invocation, and
//     each reads the flag through isHeyReachDraftingEnabled and gates through
//     heyreachClassifyGate.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function read(rel: string): string {
  return Deno.readTextFileSync(new URL(rel, import.meta.url));
}

function containsAny(hay: string, needles: (string | RegExp)[]): boolean {
  return needles.some((n) => (typeof n === "string" ? hay.includes(n) : n.test(hay)));
}

const INGESTION_FILES = [
  "./poll-heyreach-inbox/index.ts",
  "./poll-heyreach-inbox/paging.ts",
  "./heyreach-webhook/index.ts",
  "./recover-heyreach-leads/index.ts",
];

const SEND_OR_DRAFT: (string | RegExp)[] = [
  /send-agent-reply/,
  /send-heyreach-message/,
  /send-smartlead-email/,
  /functions\.invoke\(/,
  /draft_response/,
  /draft_audit/,
];

const CLASSIFY: (string | RegExp)[] = ["classify-reply", /fireClassifyReply/];

Deno.test("HeyReach ingestion never calls a send function or writes/reads draft columns", () => {
  for (const f of INGESTION_FILES) {
    assertEquals(containsAny(read(f), SEND_OR_DRAFT), false, `send/draft reference found in ${f}`);
  }
  // Matcher self-check, so dropping a pattern fails this test.
  for (const sample of [
    "POST /functions/v1/send-heyreach-message",
    "POST /functions/v1/send-agent-reply",
    "POST /functions/v1/send-smartlead-email",
    "supabase.functions.invoke('x')",
    "update({ draft_response: text })",
    "insert into draft_audit",
  ]) {
    assertEquals(containsAny(sample, SEND_OR_DRAFT), true, sample);
  }
});

Deno.test("paging.ts and recover-heyreach-leads never classify", () => {
  for (const f of ["./poll-heyreach-inbox/paging.ts", "./recover-heyreach-leads/index.ts"]) {
    assertEquals(containsAny(read(f), CLASSIFY), false, `classify reference found in ${f}`);
  }
  assertEquals(containsAny("POST /functions/v1/classify-reply", CLASSIFY), true);
  assertEquals(containsAny("fireClassifyReply({})", CLASSIFY), true);
});

Deno.test("poller and webhook: exactly one classify-reply invocation each, behind the drafting flag + gate", () => {
  const poller = read("./poll-heyreach-inbox/index.ts");
  const webhook = read("./heyreach-webhook/index.ts");

  assertEquals((poller.match(/fireClassifyReply\(\{/g) ?? []).length, 1, "poller: one fireClassifyReply call");
  assertEquals((poller.match(/functions\/v1\//g) ?? []).length, 0, "poller: no direct function URL");
  assertEquals((webhook.match(/functions\/v1\/classify-reply/g) ?? []).length, 1, "webhook: one classify-reply fetch");
  assertEquals((webhook.match(/fireClassifyReply/g) ?? []).length, 0);
  assertEquals((webhook.match(/functions\/v1\//g) ?? []).length, 1, "webhook: no other function URL");

  for (const [name, src] of [["poller", poller], ["webhook", webhook]] as const) {
    assert(src.includes("isHeyReachDraftingEnabled(Deno.env.get(HEYREACH_DRAFTING_ENV))"), `${name}: flag read via helper`);
    assert(/heyreachClassifyGate\(decision, draftingEnabled\)/.test(src), `${name}: gated via heyreachClassifyGate`);
    assert(/if \(classifyGate\.classify\) \{/.test(src), `${name}: classify only when gate.classify`);
    assert(src.includes("(HeyReach drafting off)"), `${name}: flag-off reason is logged`);
    // The invocation comes after the gate check in source order.
    const gateAt = src.indexOf("if (classifyGate.classify) {");
    const callAt = name === "poller" ? src.indexOf("fireClassifyReply({") : src.indexOf("functions/v1/classify-reply");
    assert(gateAt > 0 && callAt > gateAt, `${name}: classify call sits inside the gate`);
  }
});
