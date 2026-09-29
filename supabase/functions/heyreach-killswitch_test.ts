import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function read(fileUrl: URL): string {
  return Deno.readTextFileSync(fileUrl);
}

function containsAny(hay: string, needles: (string | RegExp)[]): boolean {
  return needles.some((n) => (typeof n === "string" ? hay.includes(n) : n.test(hay)));
}

Deno.test("kill switch: no classify/draft/send invocations in HeyReach ingestion", () => {
  const files = [
    new URL("./poll-heyreach-inbox/index.ts", import.meta.url),
    new URL("./poll-heyreach-inbox/paging.ts", import.meta.url),
    new URL("./heyreach-webhook/index.ts", import.meta.url),
    new URL("./recover-heyreach-leads/index.ts", import.meta.url),
  ];
  const forbidden: (string | RegExp)[] = [
    "classify-reply",
    /fireClassifyReply/,
    /functions\.invoke\(/,
    /send-agent-reply/,
    /send-heyreach-message/,
    // Draft columns: HeyReach ingestion must not write or read drafts.
    /draft_response/,
    /draft_audit/,
  ];
  for (const url of files) {
    const src = read(url);
    const bad = containsAny(src, forbidden);
    assertEquals(bad, false, `Forbidden reference found in ${url.pathname}`);
  }
  // Negative self-check: ensure the matcher would flag a sample classify string
  const sample = "POST /functions/v1/classify-reply";
  assertEquals(containsAny(sample, forbidden), true);
  // ...and the draft columns, so dropping either pattern fails this test.
  assertEquals(containsAny("update({ draft_response: text })", forbidden), true);
  assertEquals(containsAny("insert into draft_audit", forbidden), true);
});

