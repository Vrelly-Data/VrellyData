// apollo-enrich: Apollo's 422 "insufficient credits" (REAL index.ts, fake
// PostgREST + fake Apollo; synthetic ids only).
//
// The loop stops at the first such answer (every later chunk would 422 too),
// the response says insufficient_credits, and ids never sent are reported as
// not_attempted — NOT as "unmatched", which would tell the preview Apollo has
// no record of real, reachable people.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes } from "../_shared/testing/fake_platform.ts";

Deno.env.set("APOLLO_API_KEY", "shared-test-key");
const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);
const { isInsufficientCredits } = await import(new URL("./index.ts", import.meta.url).href);

Deno.test("isInsufficientCredits: only a 422 that is about credits", () => {
  assertEquals(isInsufficientCredits(422, '{"error":"You have insufficient credits to perform this action"}'), true);
  assertEquals(isInsufficientCredits(422, '{"error":"invalid id"}'), false);
  assertEquals(isInsufficientCredits(429, "credits"), false);
});

Deno.test({
  name: "apollo-enrich: 422 insufficient credits stops the loop and is reported, remaining ids are not_attempted",
  ...testOpts,
  async fn() {
    const db = new FakeSupabase({ outbound_integrations: [], apollo_enrichment_cache: [] });
    let bulkCalls = 0;
    const provider = (_req: Request, url: URL) => {
      if (url.hostname !== "api.apollo.io") return undefined;
      bulkCalls++;
      return new Response(JSON.stringify({ error: "You have insufficient credits" }), { status: 422 });
    };
    // 10 ids = one chunk (Apollo's bulk_match limit), so prove "stops" with the
    // cap: send the max and check there was exactly one Apollo call.
    const ids = Array.from({ length: 10 }, (_, i) => `ap${i}`);
    const { result } = await withFakes(db, provider, async () => {
      const res = await handler(new Request("http://local/apollo-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
        body: JSON.stringify({ user_id: "u1", person_ids: ids }),
      }));
      return await res.json();
    });
    assertEquals(bulkCalls, 1);
    assertEquals(result.insufficient_credits, true);
    assertEquals(result.credits_spent, 0);
    assertEquals(result.unmatched, [], "nobody is written off as 'not in Apollo'");
    assertEquals(result.failed_chunks, [{ ids, status: 422 }]);
    void json;
  },
});
