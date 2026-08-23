// Exercise add-contacts-to-sequence's GATES on dev, without enrolling anyone.
//
// Every case below is designed to be rejected BEFORE the platform call, so no
// real prospect is pushed into a real Smartlead/Reply.io campaign. The push
// path itself is deliberately NOT exercised here — that is irreversible and
// needs a throwaway campaign and an explicit decision.
const DEV = 'https://iqxzetwuxykplzdjysiu.supabase.co';
const SVC = process.env.SVC, ANON = process.env.ANON, TOKEN = process.env.TOKEN, USERID = process.env.USERID;

const rest = async (path, opts = {}) => {
  const r = await fetch(`${DEV}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json',
               Prefer: 'return=representation', ...(opts.headers || {}) },
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};
// Destination is per-push now, so it is injected into every call unless the
// case is specifically testing its absence.
const push = async (payload) => {
  if (payload.__noDest) { delete payload.__noDest; }
  else payload = { platform, synced_campaign_id: campaignId, ...payload };
  const r = await fetch(`${DEV}/functions/v1/add-contacts-to-sequence`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// ---- fixture ---------------------------------------------------------------
const cfg = await rest(`agent_configs?user_id=eq.${USERID}&select=id&limit=1`);
let configId = cfg.body?.[0]?.id;
if (!configId) {
  const any = await rest('agent_configs?select=id,user_id&limit=1');
  console.log('NOTE: no agent_config for the test user; using', any.body?.[0]?.user_id);
  configId = any.body?.[0]?.id;
}
// MUST match the audience's platform: agent_audiences.platform 'smartlead'
// maps to synced_campaigns.source 'smartlead' ('reply.io' -> 'reply_io').
// The first version of this fixture took limit=1 regardless of source, which
// silently built a mismatched audience — harmless only because no test reached
// the platform call. The new consistency guard catches it, so pick properly.
// Derive the audience platform FROM the campaign, rather than assuming.
// synced_campaigns.source is 'smartlead' | 'reply_io'; agent_audiences.platform
// is 'smartlead' | 'reply.io'. Dev currently holds only reply_io campaigns, so
// hardcoding 'smartlead' built a mismatched fixture — which the new consistency
// guard correctly rejected.
const SOURCE_TO_PLATFORM = { smartlead: 'smartlead', reply_io: 'reply.io' };
const camp = await rest('synced_campaigns?select=id,external_campaign_id,source&limit=1');
const campaignId = camp.body?.[0]?.id;
const campaignSource = camp.body?.[0]?.source;
const platform = SOURCE_TO_PLATFORM[campaignSource];
// A campaign of the OTHER source, for the mismatch test. May not exist in dev.
const otherSource = campaignSource === 'smartlead' ? 'reply_io' : 'smartlead';
const other = await rest(`synced_campaigns?source=eq.${otherSource}&select=id&limit=1`);
const otherCampaignId = other.body?.[0]?.id;
console.log(`fixture: agent_config=${configId ? 'ok' : 'MISSING'}  campaign=${campaignId ? campaignSource : 'MISSING'} -> platform=${platform}`);
if (!configId || !campaignId || !platform) { console.log('cannot build fixture — aborting'); process.exit(0); }

const aud = await rest('agent_audiences', {
  method: 'POST',
  body: JSON.stringify({
    user_id: USERID, agent_config_id: configId, name: '__verify__ push gates',
    max_per_run: 5,
  }),
});
if (aud.status !== 201) { console.log('audience insert failed:', aud.status, JSON.stringify(aud.body).slice(0,300)); process.exit(1); }
const audienceId = aud.body[0].id;
console.log(`audience created: ${audienceId}\n`);

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };

// ---- 1. ownership: someone else's audience id -------------------------------
let r = await push({ audience_id: '00000000-0000-0000-0000-000000000000', contacts: [{ email: 'a@b.com' }] });
check('unknown audience id -> 404', r.status === 404, `HTTP ${r.status}`);

// ---- 2. empty contacts ------------------------------------------------------
r = await push({ audience_id: audienceId, contacts: [] });
check('empty contacts -> 400', r.status === 400, `HTTP ${r.status}`);

// ---- 3. contact with no email ----------------------------------------------
r = await push({ audience_id: audienceId, contacts: [{ apollo_person_id: 'p_noemail', name: 'No Email' }] });
check('no email -> skipped_no_email', r.body?.results?.[0]?.outcome === 'skipped_no_email',
      JSON.stringify(r.body?.tally));

// ---- 4. OPTED OUT -----------------------------------------------------------
const OPT = '__verify__optout@example.com';
const lead = await rest('agent_leads', { method: 'POST', body: JSON.stringify({
  user_id: USERID, agent_config_id: configId, external_id: '__verify__optout',
  full_name: '__verify__ OptOut', email: OPT, disposition_tag: 'opted_out',
  channel: 'email', source: 'reply_io', inbox_status: 'dismissed' }) });
if (lead.status !== 201) console.log('  (opted-out lead insert failed:', lead.status, JSON.stringify(lead.body).slice(0,200), ')');
r = await push({ audience_id: audienceId, contacts: [{ apollo_person_id: 'p_optout', email: OPT, name: 'Opt Out' }] });
check('opted_out lead -> skipped_opted_out', r.body?.results?.[0]?.outcome === 'skipped_opted_out',
      JSON.stringify(r.body?.results?.[0]));

// ---- 5. DUPLICATE (pre-claimed) --------------------------------------------
const DUP = '__verify__dup@example.com';
await rest('agent_audience_pushes', { method: 'POST', body: JSON.stringify({
  audience_id: audienceId, user_id: USERID, apollo_person_id: 'p_dup',
  email_key: DUP, synced_campaign_id: campaignId }) });
r = await push({ audience_id: audienceId, contacts: [{ apollo_person_id: 'p_dup', email: DUP, name: 'Dup Person' }] });
check('already pushed -> skipped_duplicate', r.body?.results?.[0]?.outcome === 'skipped_duplicate',
      JSON.stringify(r.body?.results?.[0]));

// ---- 5b. duplicate by EMAIL under a different apollo id ---------------------
r = await push({ audience_id: audienceId, contacts: [{ apollo_person_id: 'p_dup_other_id', email: DUP, name: 'Dup Email' }] });
check('same email, new apollo id -> skipped_duplicate', r.body?.results?.[0]?.outcome === 'skipped_duplicate',
      JSON.stringify(r.body?.results?.[0]));

// ---- 6. CAP exhausted -------------------------------------------------------
await rest(`agent_audiences?id=eq.${audienceId}`, { method: 'PATCH',
  body: JSON.stringify({ max_total: 1, total_pushed: 1 }) });
r = await push({ audience_id: audienceId, contacts: [{ apollo_person_id: 'p_cap', email: '__verify__cap@example.com' }] });
check('max_total reached -> skipped_cap', r.body?.results?.[0]?.outcome === 'skipped_cap',
      JSON.stringify(r.body?.results?.[0]));

// ---- 6b. platform / campaign source MISMATCH -------------------------------
// Dev holds only reply_io campaigns, so the other-source campaign is CREATED
// here rather than skipped. An earlier version reported this as PASS when it
// had simply been skipped — a false pass on the one gate that, if broken, could
// enrol live prospects into the wrong platform's sequence.
let mismatchCampaignId = otherCampaignId;
let createdMismatchCampaign = false;
if (!mismatchCampaignId) {
  const src = await rest(`synced_campaigns?id=eq.${campaignId}&select=integration_id,team_id`);
  const seed = src.body?.[0];
  const made = await rest('synced_campaigns', { method: 'POST', body: JSON.stringify({
    integration_id: seed?.integration_id, team_id: seed?.team_id,
    external_campaign_id: '__verify__mismatch', name: '__verify__ mismatch campaign',
    source: otherSource }) });
  if (made.status === 201) { mismatchCampaignId = made.body[0].id; createdMismatchCampaign = true; }
  else console.log('  (could not create mismatch campaign:', made.status, JSON.stringify(made.body).slice(0,160), ')');
}
if (mismatchCampaignId) {
  const mism = await rest('agent_audiences', { method: 'POST', body: JSON.stringify({
    user_id: USERID, agent_config_id: configId, name: '__verify__ mismatch',
    max_per_run: 5 }) });
  if (mism.status === 201) {
    const r2 = await push({ audience_id: mism.body[0].id, platform,
      synced_campaign_id: mismatchCampaignId,
      contacts: [{ apollo_person_id: 'p_mm', email: '__verify__mm@example.com' }] });
    check(`${platform} audience + ${otherSource} campaign -> 400`, r2.status === 400,
          `HTTP ${r2.status} ${JSON.stringify(r2.body).slice(0,140)}`);
    await rest(`agent_audiences?id=eq.${mism.body[0].id}`, { method: 'DELETE' });
  } else check(`${platform} audience + ${otherSource} campaign -> 400`, false,
               `could not create mismatch audience: ${mism.status}`);
  if (createdMismatchCampaign) await rest(`synced_campaigns?id=eq.${mismatchCampaignId}`, { method: 'DELETE' });
} else {
  check(`${platform} audience + ${otherSource} campaign -> 400`, false,
        'NOT EXERCISED - could not obtain an other-source campaign');
}

// ---- 6c. destination is REQUIRED per push ----------------------------------
r = await push({ __noDest: true, audience_id: audienceId, synced_campaign_id: campaignId,
                 contacts: [{ apollo_person_id: 'p_np', email: '__verify__np@example.com' }] });
check('push without platform -> 400', r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0,90)}`);

r = await push({ __noDest: true, audience_id: audienceId, platform,
                 contacts: [{ apollo_person_id: 'p_nc', email: '__verify__nc@example.com' }] });
check('push without synced_campaign_id -> 400', r.status === 400, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0,90)}`);

// ---- 7. no stray ledger rows from skipped contacts -------------------------
const ledger = await rest(`agent_audience_pushes?audience_id=eq.${audienceId}&select=apollo_person_id,platform,synced_campaign_id`);
const ids = (ledger.body || []).map(x => x.apollo_person_id).sort();
check('skipped contacts leave NO ledger rows', ids.length === 1 && ids[0] === 'p_dup',
      `ledger=${JSON.stringify(ids)}`);

console.log('=== GATE RESULTS ===');
for (const x of results) console.log(`  ${x.ok ? 'PASS' : 'FAIL'}  ${x.name.padEnd(46)} ${x.ok ? '' : x.detail}`);
console.log(results.every(x => x.ok) ? '\nALL GATES PASS' : `\n${results.filter(x=>!x.ok).length} FAILURE(S)`);

// ---- cleanup ---------------------------------------------------------------
await rest(`agent_audience_pushes?audience_id=eq.${audienceId}`, { method: 'DELETE' });
await rest(`agent_audiences?id=eq.${audienceId}`, { method: 'DELETE' });
await rest(`agent_leads?external_id=eq.__verify__optout`, { method: 'DELETE' });
const left = await rest(`agent_audiences?name=like.__verify__*&select=id`);
console.log(`\ncleanup: ${Array.isArray(left.body) ? left.body.length : '?'} __verify__ audiences remaining`);
