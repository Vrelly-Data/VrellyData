import { decideAuth } from "./gate.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("decideAuth: garbage Bearer token yields unauthorized before lookups", async () => {
  const headers = new Headers({ Authorization: "Bearer definitely-not-a-service-key-or-valid-jwt" });
  const res = await decideAuth(headers, async () => false); // simulate getUser() failed
  assertEquals(res, "unauthorized");
});

Deno.test("decideAuth: valid user token path", async () => {
  const headers = new Headers({ Authorization: "Bearer user.jwt.token" });
  const res = await decideAuth(headers, async () => true); // simulate getUser() success
  assertEquals(res, "user");
});

Deno.test("decideAuth: service caller wins", async () => {
  Deno.env.set("AGENT_API_KEY", "s3cret");
  const headers = new Headers({ "x-agent-key": "s3cret" });
  const res = await decideAuth(headers, async () => {
    // Should not be called when service path is detected
    throw new Error("getUser should not be invoked for service auth");
  });
  assertEquals(res, "service");
});

