// Signal custom fields reach the platform (REAL index.ts, fake PostgREST +
// fake Reply.io/Smartlead; synthetic data only). And: a contact WITHOUT them
// is pushed exactly as before (no extra Reply.io call).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";
import { cleanCustomFields } from "./custom_fields.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const USER = "00000000-0000-4000-8000-0000000000c1";
const AUD = "aud-cf";
const fields = { signal_type: "fda_clearance", signal_title: "Acme cleared K261234", signal_date: "2026-09-27", signal_url: "https://fda.example/K261234" };

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

function provider(opts: { patchStatus?: number; listStatus?: number; existing?: string[]; createStatus?: number } = {}) {
  let nextId = 4242;
  return (req: Request, url: URL) => {
    if (url.hostname === "api.reply.io" && url.pathname === "/v3/custom-fields" && req.method === "GET") {
      return opts.listStatus ? json({ title: "boom" }, opts.listStatus) : json((opts.existing ?? []).map((t, i) => ({ id: i + 1, title: t })));
    }
    if (url.hostname === "api.reply.io" && url.pathname === "/v3/custom-fields" && req.method === "POST") {
      return opts.createStatus ? json({ code: "x" }, opts.createStatus) : json({ id: 99 }, 201);
    }
    if (url.hostname === "api.reply.io" && url.pathname === "/v3/contacts" && req.method === "POST") return json({ id: nextId++ }, 201);
    if (url.hostname === "api.reply.io" && /^\/v3\/contacts\/\d+$/.test(url.pathname) && req.method === "PATCH") {
      return opts.patchStatus && opts.patchStatus >= 400 ? json({ title: "bad field" }, opts.patchStatus) : json({});
    }
    if (url.hostname === "api.reply.io" && url.pathname.endsWith("/move-to-sequence")) return json({});
    if (url.hostname === "server.smartlead.ai") return json({ upload_count: 1, upload_status: [{ lead_id: 55 }] });
    return undefined;
  };
}

const calls = (rec: { providerCalls: { method: string; url: string }[] }) =>
  rec.providerCalls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

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
  name: "custom fields: Reply.io — missing fields are registered once, PATCHed BEFORE the move",
  ...testOpts,
  async fn() {
    const r = await push(db(), [
      { prospect_id: "11111111-1111-4111-8111-111111111111", email: "ann@acme.test", first_name: "Ann", title: "CEO", custom_fields: fields },
      { prospect_id: "33333333-3333-4333-8333-333333333333", email: "eve@acme.test", first_name: "Eve", custom_fields: fields },
    ], "reply.io", "camp-r", provider({ existing: ["signal_type", "Custom_Message"] }));
    assertEquals(r.body.pushed, 2);
    assertEquals(calls(r.rec), [
      "POST /v3/contacts",
      "GET /v3/custom-fields", "POST /v3/custom-fields", "POST /v3/custom-fields", "POST /v3/custom-fields",
      "PATCH /v3/contacts/4242", "POST /v3/contacts/4242/move-to-sequence",
      // second contact: no second registration round trip
      "POST /v3/contacts", "PATCH /v3/contacts/4243", "POST /v3/contacts/4243/move-to-sequence",
    ]);
    const created = r.rec.providerCalls.filter((c) => c.method === "POST" && c.url.endsWith("/v3/custom-fields")).map((c) => (c.body as Row).title);
    assertEquals(created, ["signal_date", "signal_title", "signal_url"]); // signal_type already existed
    assertEquals(r.rec.providerCalls.filter((c) => c.url.endsWith("/v3/custom-fields") && c.method === "GET").length, 1);
    const patch = r.rec.providerCalls.find((c) => c.method === "PATCH")!;
    assertEquals((patch.body as Row).customFields, [
      { name: "signal_type", value: "fda_clearance" },
      { name: "signal_title", value: "Acme cleared K261234" },
      { name: "signal_date", value: "2026-09-27" },
      { name: "signal_url", value: "https://fda.example/K261234" },
    ]);
    const order = calls(r.rec);
    assert(order.indexOf("PATCH /v3/contacts/4242") < order.indexOf("POST /v3/contacts/4242/move-to-sequence"));
    assertEquals(r.body.results.map((x: Row) => x.warning ?? null), [null, null]);
  },
});

Deno.test({
  name: "custom fields: Reply.io — all fields already registered → no create calls",
  ...testOpts,
  async fn() {
    const r = await push(db(), [{ email: "ann@acme.test", first_name: "Ann", custom_fields: fields }], "reply.io", "camp-r",
      provider({ existing: ["signal_type", "signal_title", "signal_date", "signal_url"] }));
    assertEquals(r.body.pushed, 1);
    assertEquals(calls(r.rec), ["POST /v3/contacts", "GET /v3/custom-fields", "PATCH /v3/contacts/4242", "POST /v3/contacts/4242/move-to-sequence"]);
  },
});

Deno.test({
  name: "custom fields: Reply.io — registration fails → enrolled WITHOUT the fields, warning logged, no PATCH",
  ...testOpts,
  async fn() {
    const d = db();
    const r = await push(d, [{ email: "bo@beta.test", first_name: "Bo", custom_fields: fields }], "reply.io", "camp-r", provider({ createStatus: 403 }));
    assertEquals(r.body.pushed, 1);
    assertEquals(r.body.results[0].outcome, "pushed");
    assertEquals(r.body.results[0].warning, "custom fields not registered in Reply.io");
    assert(!r.rec.providerCalls.some((c) => c.method === "PATCH"));
    assert(r.rec.providerCalls.some((c) => c.url.endsWith("/move-to-sequence")), "still moved into the sequence");
    assertEquals(d.tables.agent_audience_pushes.length, 1, "claim kept — the person is enrolled");
    assert(r.rec.logs.some((l) => l.includes("WARNING Reply.io custom fields not registered")));
  },
});

Deno.test({
  name: "custom fields: Reply.io — the field write fails → still enrolled, warning logged",
  ...testOpts,
  async fn() {
    const d = db();
    const r = await push(d, [{ email: "cy@gamma.test", first_name: "Cy", custom_fields: fields }], "reply.io", "camp-r",
      provider({ existing: ["signal_type", "signal_title", "signal_date", "signal_url"], patchStatus: 400 }));
    assertEquals(r.body.pushed, 1);
    assertEquals(r.body.results[0].warning, "custom fields not written (400)");
    assert(r.rec.providerCalls.some((c) => c.url.endsWith("/move-to-sequence")));
    assertEquals(d.tables.agent_audience_pushes.length, 1);
    assert(r.rec.logs.some((l) => l.includes("WARNING Reply.io custom field write 400")));
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
    assertEquals(calls(r.rec), ["POST /v3/contacts", "POST /v3/contacts/4242/move-to-sequence"]);
  },
});

Deno.test("cleanCustomFields: safe names, strings, bounded", () => {
  assertEquals(cleanCustomFields(null), null);
  assertEquals(cleanCustomFields(["x"]), null);
  assertEquals(cleanCustomFields({ "Bad Name": "x", ok_name: 5, gone: null }), { ok_name: "5" });
  assertEquals(cleanCustomFields({ long: "x".repeat(900) })!.long.length, 500);
});
