// Signal custom fields reach the platform (REAL index.ts, fake PostgREST +
// fake Reply.io/Smartlead; synthetic data only). And: a contact WITHOUT them
// is pushed exactly as before (no extra Reply.io call).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";
import { cleanCustomFields } from "./custom_fields.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const USER = "00000000-0000-4000-8000-0000000000c1";
const AUD = "aud-cf";
const fields = { signal_type: "510k_cleared", signal_title: "Acme cleared K261234", signal_date: "2026-09-27", signal_url: "https://fda.example/K261234" };

function db() {
  return new FakeSupabase({
    agent_audiences: [{ id: AUD, user_id: USER, max_per_run: 25, max_total: null, total_pushed: 0 }],
    synced_campaigns: [
      { id: "camp-r", external_campaign_id: "777", name: "Seq", source: "reply_io", integration_id: "int-1" },
      { id: "camp-s", external_campaign_id: "888", name: "SL", source: "smartlead", integration_id: "int-2" },
    ],
    outbound_integrations: [
      { id: "int-1", api_key_encrypted: "rk", is_active: true },
      { id: "int-2", api_key_encrypted: "sk", is_active: true },
    ],
    agent_leads: [],
    agent_audience_pushes: [],
  });
}

function provider(opts: { patchStatus?: number } = {}) {
  return (req: Request, url: URL) => {
    if (url.hostname === "api.reply.io" && url.pathname === "/v3/contacts" && req.method === "POST") return json({ id: 4242 }, 201);
    if (url.hostname === "api.reply.io" && url.pathname === "/v3/contacts/4242" && req.method === "PATCH") {
      return opts.patchStatus && opts.patchStatus >= 400 ? json({ title: "bad field" }, opts.patchStatus) : json({});
    }
    if (url.hostname === "api.reply.io" && url.pathname.endsWith("/move-to-sequence")) return json({});
    if (url.hostname === "server.smartlead.ai") return json({ upload_count: 1, upload_status: [{ lead_id: 55 }] });
    return undefined;
  };
}

async function push(d: FakeSupabase, contacts: Row[], platform: string, campaign: string, prov = provider()) {
  const { result, rec } = await withFakes(d, prov, async () => {
    const res = await handler(new Request("http://local/add-contacts-to-sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify({ user_id: USER, audience_id: AUD, run_id: null, platform, synced_campaign_id: campaign, contacts }),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

Deno.test({
  name: "custom fields: Reply.io gets them PATCHed onto the contact BEFORE the move to the sequence",
  ...testOpts,
  async fn() {
    const r = await push(db(), [{ prospect_id: "11111111-1111-4111-8111-111111111111", email: "ann@acme.test", first_name: "Ann", title: "CEO", custom_fields: fields }], "reply.io", "camp-r");
    assertEquals(r.body.pushed, 1);
    const calls = r.rec.providerCalls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    assertEquals(calls, ["POST /v3/contacts", "PATCH /v3/contacts/4242", "POST /v3/contacts/4242/move-to-sequence"]);
    assertEquals((r.rec.providerCalls[1].body as Row).customFields, [
      { name: "signal_type", value: "510k_cleared" },
      { name: "signal_title", value: "Acme cleared K261234" },
      { name: "signal_date", value: "2026-09-27" },
      { name: "signal_url", value: "https://fda.example/K261234" },
    ]);
  },
});

Deno.test({
  name: "custom fields: a failed Reply.io field write does not enrol, and releases the claim",
  ...testOpts,
  async fn() {
    const d = db();
    const r = await push(d, [{ email: "bo@beta.test", first_name: "Bo", custom_fields: fields }], "reply.io", "camp-r", provider({ patchStatus: 400 }));
    assertEquals(r.body.pushed, 0);
    assertEquals(r.body.results[0].outcome, "failed");
    assert(String(r.body.results[0].error).includes("custom fields 400"));
    assert(!r.rec.providerCalls.some((c) => c.url.endsWith("/move-to-sequence")), "never moved into the sequence");
    assertEquals(d.tables.agent_audience_pushes.length, 0, "claim released");
  },
});

Deno.test({
  name: "custom fields: Smartlead gets them in the lead's custom_fields, beside job_title",
  ...testOpts,
  async fn() {
    const r = await push(db(), [{ apollo_person_id: "ap-1", email: "cy@gamma.test", first_name: "Cy", title: "VP Sales", custom_fields: fields }], "smartlead", "camp-s");
    assertEquals(r.body.pushed, 1);
    const lead = ((r.rec.providerCalls[0].body as Row).lead_list as Row[])[0];
    assertEquals(lead.custom_fields, { ...fields, job_title: "VP Sales" });
  },
});

Deno.test({
  name: "custom fields: a contact without them is pushed exactly as before (no PATCH)",
  ...testOpts,
  async fn() {
    const r = await push(db(), [{ prospect_id: "22222222-2222-4222-8222-222222222222", email: "di@delta.test", first_name: "Di" }], "reply.io", "camp-r");
    assertEquals(r.body.pushed, 1);
    assertEquals(r.rec.providerCalls.map((c) => c.method), ["POST", "POST"]);
  },
});

Deno.test("cleanCustomFields: safe names, strings, bounded", () => {
  assertEquals(cleanCustomFields(null), null);
  assertEquals(cleanCustomFields(["x"]), null);
  assertEquals(cleanCustomFields({ "Bad Name": "x", ok_name: 5, gone: null }), { ok_name: "5" });
  assertEquals(cleanCustomFields({ long: "x".repeat(900) })!.long.length, 500);
});
