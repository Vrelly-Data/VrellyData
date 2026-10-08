// add-contacts-to-sequence dedup (REAL index.ts, fake PostgREST + fake
// Reply.io/Smartlead; synthetic data only).
//
// Proves the rule the Vrelly source depends on: the same email OR the same
// LinkedIn profile is never enrolled twice for a client — whether the earlier
// push was an Apollo or a Vrelly one, from this audience or another, or the
// duplicate sits in the same batch. Also: a Vrelly push is keyed by
// prospect_id (apollo_person_id null), and title / company / location reach
// the platform.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_KEY, FakeSupabase, json, loadHandler, testOpts, withFakes, type Row } from "../_shared/testing/fake_platform.ts";

const handler = await loadHandler(new URL("./index.ts", import.meta.url).href);

const USER = "00000000-0000-4000-8000-0000000000u1";
const AUD = "aud-1";
const OTHER_AUD = "aud-2";
const CAMP = "camp-1";
const SL_CAMP = "camp-sl";

function db(pushes: Row[] = []) {
  return new FakeSupabase({
    agent_audiences: [
      { id: AUD, user_id: USER, max_per_run: 25, max_total: null, total_pushed: 0 },
      { id: OTHER_AUD, user_id: USER, max_per_run: 25, max_total: null, total_pushed: 0 },
    ],
    synced_campaigns: [
      { id: CAMP, external_campaign_id: "777", name: "Seq", source: "reply_io", integration_id: "int-1" },
      { id: SL_CAMP, external_campaign_id: "888", name: "SL", source: "smartlead", integration_id: "int-2" },
    ],
    outbound_integrations: [
      { id: "int-1", api_key_encrypted: "rk", is_active: true },
      { id: "int-2", api_key_encrypted: "sk", is_active: true },
    ],
    agent_leads: [],
    agent_audience_pushes: pushes,
  });
}

let nextContact = 1000;
const replyProvider = (req: Request, url: URL) => {
  if (url.hostname === "api.reply.io" && url.pathname === "/v3/contacts" && req.method === "POST") {
    return json({ id: ++nextContact }, 201);
  }
  if (url.hostname === "api.reply.io" && url.pathname.endsWith("/move-to-sequence")) return json({});
  if (url.hostname === "server.smartlead.ai") return json({ upload_count: 1, upload_status: [{ lead_id: 55 }] });
  return undefined;
};

async function push(d: FakeSupabase, contacts: Row[], opts: { audience?: string; campaign?: string; platform?: string } = {}) {
  const { result, rec } = await withFakes(d, replyProvider, async () => {
    const res = await handler(new Request("http://local/add-contacts-to-sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
      body: JSON.stringify({
        user_id: USER, audience_id: opts.audience ?? AUD, run_id: null,
        platform: opts.platform ?? "reply.io", synced_campaign_id: opts.campaign ?? CAMP, contacts,
      }),
    }));
    return { status: res.status, body: await res.json() };
  });
  return { ...result, rec };
}

const outcomes = (b: { results: Row[] }) => b.results.map((r) => `${r.email}:${r.outcome}`);
const prior = (extra: Row): Row => ({
  id: `p-${Math.random()}`, audience_id: OTHER_AUD, user_id: USER, apollo_person_id: null, prospect_id: null,
  email_key: null, linkedin_key: null, platform: "reply.io", ...extra,
});

Deno.test({
  name: "dedup: an email already pushed (by any audience, any source) is skipped",
  ...testOpts,
  async fn() {
    const d = db([prior({ apollo_person_id: "apollo-1", email_key: "jane@acme.test" })]);
    const r = await push(d, [{ prospect_id: "11111111-1111-4111-8111-111111111111", email: "  Jane@Acme.test ", first_name: "Jane" }]);
    assertEquals(r.status, 200);
    assertEquals(outcomes(r.body), ["  Jane@Acme.test :skipped_duplicate"]);
    assertEquals(r.rec.providerCalls.length, 0, "nothing sent to Reply.io");
  },
});

Deno.test({
  name: "dedup: same LinkedIn under a DIFFERENT email is skipped (URL normalized)",
  ...testOpts,
  async fn() {
    const d = db([prior({ email_key: "old@acme.test", linkedin_key: "linkedin.com/in/jane-doe" })]);
    const r = await push(d, [{
      prospect_id: "22222222-2222-4222-8222-222222222222", email: "new@other.test",
      linkedin_url: "HTTPS://www.LinkedIn.com/in/Jane-Doe/?trk=x",
    }]);
    assertEquals(outcomes(r.body), ["new@other.test:skipped_duplicate"]);
    assertEquals(r.rec.providerCalls.length, 0);
  },
});

Deno.test({
  name: "dedup: same prospect_id is skipped even if its email changed",
  ...testOpts,
  async fn() {
    const pid = "33333333-3333-4333-8333-333333333333";
    const d = db([prior({ prospect_id: pid, email_key: "before@acme.test" })]);
    const r = await push(d, [{ prospect_id: pid, email: "after@acme.test" }]);
    assertEquals(outcomes(r.body), ["after@acme.test:skipped_duplicate"]);
  },
});

Deno.test({
  name: "dedup: duplicates inside one batch — same email, or same LinkedIn — enrol once",
  ...testOpts,
  async fn() {
    const d = db();
    const r = await push(d, [
      { prospect_id: "44444444-4444-4444-8444-444444444441", email: "a@x.test", linkedin_url: "linkedin.com/in/a" },
      { prospect_id: "44444444-4444-4444-8444-444444444442", email: "A@X.test" },
      { prospect_id: "44444444-4444-4444-8444-444444444443", email: "b@x.test", linkedin_url: "https://www.linkedin.com/in/a/" },
      { prospect_id: "44444444-4444-4444-8444-444444444444", email: "c@x.test" },
    ]);
    assertEquals(outcomes(r.body), [
      "a@x.test:pushed", "A@X.test:skipped_duplicate", "b@x.test:skipped_duplicate", "c@x.test:pushed",
    ]);
    assertEquals((d.tables.agent_audience_pushes as Row[]).length, 2);
  },
});

Deno.test({
  name: "dedup: a second run of the same contacts pushes nobody",
  ...testOpts,
  async fn() {
    const d = db();
    const contacts = [
      { prospect_id: "55555555-5555-4555-8555-555555555551", email: "p@x.test", linkedin_url: "linkedin.com/in/p" },
      { prospect_id: "55555555-5555-4555-8555-555555555552", email: "q@x.test" },
    ];
    const first = await push(d, contacts);
    assertEquals(first.body.pushed, 2);
    const second = await push(d, contacts, { audience: OTHER_AUD });
    assertEquals(second.body.pushed, 0);
    assertEquals(second.body.tally, { skipped_duplicate: 2 });
    assertEquals(second.rec.providerCalls.length, 0);
  },
});

Deno.test({
  name: "Vrelly push: keyed by prospect_id with apollo_person_id null; title/company/location reach Reply.io",
  ...testOpts,
  async fn() {
    const d = db();
    const pid = "66666666-6666-4666-8666-666666666666";
    const r = await push(d, [{
      prospect_id: pid, email: "Kim@Lender.test", first_name: "Kim", last_name: "Lee",
      linkedin_url: "https://linkedin.com/in/kimlee", title: "CEO", company_name: "Lender Co",
      city: "Austin", state: "TX", country: "US",
    }]);
    assertEquals(outcomes(r.body), ["Kim@Lender.test:pushed"]);
    const row = (d.tables.agent_audience_pushes as Row[])[0];
    assertEquals(row.prospect_id, pid);
    assertEquals(row.apollo_person_id, null);
    assertEquals(row.email_key, "kim@lender.test");
    assertEquals(row.linkedin_key, "linkedin.com/in/kimlee");
    const create = r.rec.providerCalls.find((c) => c.url.endsWith("/v3/contacts"))!;
    assertEquals(create.body, {
      email: "Kim@Lender.test", firstName: "Kim", lastName: "Lee",
      linkedInUrl: "https://linkedin.com/in/kimlee", title: "CEO", company: "Lender Co",
      city: "Austin", state: "TX", country: "US",
    });
  },
});

Deno.test({
  name: "Smartlead push carries company, LinkedIn, location and title",
  ...testOpts,
  async fn() {
    const d = db();
    const r = await push(d, [{
      prospect_id: "77777777-7777-4777-8777-777777777777", email: "s@x.test", first_name: "S", last_name: "T",
      linkedin_url: "linkedin.com/in/st", title: "VP Sales", company_name: "X Inc", company_domain: "x.test",
      city: "Leeds", state: null, country: "United Kingdom",
    }], { platform: "smartlead", campaign: SL_CAMP });
    assertEquals(r.body.pushed, 1);
    const call = r.rec.providerCalls.find((c) => c.url.includes("server.smartlead.ai"))!;
    assert(!JSON.stringify(call.body).includes("sk"), "api key is in the query string, not the body");
    assertEquals((call.body as { lead_list: Row[] }).lead_list[0], {
      first_name: "S", last_name: "T", email: "s@x.test", company_name: "X Inc",
      linkedin_profile: "linkedin.com/in/st", location: "Leeds, United Kingdom", website: "x.test",
      custom_fields: { job_title: "VP Sales" },
    });
  },
});
