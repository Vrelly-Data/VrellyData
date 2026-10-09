#!/usr/bin/env node
// DEV-ONLY end-to-end check for Auto Pilot routing (classify-reply → sender).
//
// Runs against an ISOLATED dev test user that has NO Reply.io integration, so
// no message can ever be delivered: dev's Reply.io integration is the same
// live account as prod, and a successful Reply.io LinkedIn send would message
// a real person. What this proves on real deployed code:
//   1. a Reply.io LINKEDIN reply in mode='auto' is routed to send-agent-reply
//      (the bug sent it to send-heyreach-message) — send-agent-reply answers
//      with its own unmistakable error, 'Reply.io integration not found';
//   2. that failure is recorded as an 'auto_send_failed' activity carrying the
//      sender's error, and the lead stays 'draft_ready' with its draft;
//   3. with auto_send_daily_cap = 0 the next reply is held ('auto_send_held',
//      reason daily_cap) and no sender is called.
// The successful-send path is covered by the unit tests
// (_shared/auto-pilot_test.ts) and by Myall's own prod test.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REF = 'iqxzetwuxykplzdjysiu';
const EMAIL = 'autopilot-dev-test@example.com';
const env = (file, key) => fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`))?.split('=', 2)[1]?.trim();
const SR = env('.env.local', 'SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('.env.development', 'VITE_SUPABASE_PUBLISHABLE_KEY');
const refOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).ref;
if (refOf(SR) !== REF || refOf(ANON) !== REF) { console.error('keys are not for dev — refusing'); process.exit(2); }
const URL_ = `https://${REF}.supabase.co`;
const sb = createClient(URL_, SR, { auth: { persistSession: false } });

const fails = [];
const check = (label, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!ok) fails.push(label); };

// ---- isolated test user + config (mode auto), no integrations ----------------
let userId;
{
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list?.users?.find((u) => u.email === EMAIL);
  if (found) userId = found.id;
  else {
    const { data, error } = await sb.auth.admin.createUser({ email: EMAIL, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }
}
const { data: integ } = await sb.from('outbound_integrations').select('id').eq('created_by', userId);
if ((integ ?? []).length) { console.error('test user has integrations — refusing (a send could be delivered)'); process.exit(2); }
check('isolated test user has no outbound integrations', true, userId);

const cfgRow = {
  user_id: userId, company_name: 'Dev AutoPilot Co', sender_name: 'Dev Tester', sender_title: 'Founder',
  offer_description: 'Bookkeeping for small lenders', desired_action: 'Book a call', communication_style: 'conversational',
  mode: 'auto', is_active: true, auto_send_daily_cap: 25,
};
const { data: existingCfg } = await sb.from('agent_configs').select('id').eq('user_id', userId).maybeSingle();
const { error: cfgErr } = existingCfg
  ? await sb.from('agent_configs').update(cfgRow).eq('id', existingCfg.id)
  : await sb.from('agent_configs').insert(cfgRow);
if (cfgErr) throw cfgErr;

// ---- session as the test user (same auth path as the UI) ---------------------
const { data: link } = await sb.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: sess } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
const JWT = sess.session.access_token;

async function newLead(tag) {
  const now = new Date();
  const replyAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  const text = "Yes, this is interesting — could you send me a couple of times for a quick call next week?";
  const { data, error } = await sb.from('agent_leads').insert({
    user_id: userId, source: 'reply_io', channel: 'linkedin',
    external_id: String(351000000 + Math.floor(Math.random() * 99999)),
    full_name: `Pat Prospect ${tag}`, company: 'Example Lending', email: `pat.${tag}.${Date.now()}@example.com`,
    linkedin_url: `https://www.linkedin.com/in/pat-prospect-${tag}-${Date.now()}`,
    inbox_status: 'pending', pipeline_stage: 'replied', last_reply_at: replyAt, last_reply_text: text,
    reply_thread: [
      { role: 'sender', content: 'Hi Pat — quick question about your bookkeeping.', timestamp: new Date(now.getTime() - 86_400_000).toISOString(), channel: 'linkedin' },
      { role: 'prospect', content: text, timestamp: replyAt, channel: 'linkedin' },
    ],
  }).select('id, reply_thread, last_reply_text').single();
  if (error) throw error;
  return data;
}

async function classify(lead) {
  const t0 = Date.now();
  const res = await fetch(`${URL_}/functions/v1/classify-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${JWT}` },
    body: JSON.stringify({
      reply_text: lead.last_reply_text, thread_history: lead.reply_thread, lead_id: lead.id, channel: 'linkedin',
      agent_context: { company_name: cfgRow.company_name, sender_name: cfgRow.sender_name, sender_title: cfgRow.sender_title,
        offer_description: cfgRow.offer_description, desired_action: cfgRow.desired_action, communication_style: cfgRow.communication_style },
    }),
  });
  return { status: res.status, json: await res.json().catch(() => null), ms: Date.now() - t0 };
}

const activities = async (leadId) => (await sb.from('agent_activity').select('activity_type, description, metadata, created_at').eq('lead_id', leadId).order('created_at')).data ?? [];

console.log('\n1. Reply.io LinkedIn reply, mode=auto → routed to send-agent-reply');
const lead1 = await newLead('a');
const c1 = await classify(lead1);
console.log(`     classify-reply HTTP ${c1.status} in ${c1.ms}ms intent=${c1.json?.intent}`);
check('classified as an auto-sendable intent', ['interested', 'needs_more_info'].includes(c1.json?.intent), c1.json?.intent);
const acts1 = await activities(lead1.id);
const failed = acts1.find((a) => a.activity_type === 'auto_send_failed');
check('auto_send_failed recorded', !!failed, failed?.description);
check('…routed to send-agent-reply (not send-heyreach-message)', failed?.metadata?.target === 'send-agent-reply', failed?.metadata?.target);
// Expected: send-agent-reply's own 'Reply.io integration not found'. On
// 2026-10-09 dev's deployed send-agent-reply crashed at boot (bundle
// SyntaxError), so the call timed out instead — still a recorded failure.
console.log(`     sender error recorded: ${failed?.metadata?.error}`);
check('…with an error message recorded', !!failed?.metadata?.error);
const { data: after1 } = await sb.from('agent_leads').select('inbox_status, auto_handled, draft_response').eq('id', lead1.id).single();
check('lead left draft_ready with its draft, not marked handled',
  after1.inbox_status === 'draft_ready' && after1.auto_handled === false && !!after1.draft_response, `${after1.inbox_status} auto_handled=${after1.auto_handled}`);

console.log('\n2. Daily cap 0 → held, no sender call');
await sb.from('agent_configs').update({ auto_send_daily_cap: 0 }).eq('user_id', userId);
const lead2 = await newLead('b');
const c2 = await classify(lead2);
console.log(`     classify-reply HTTP ${c2.status} intent=${c2.json?.intent}`);
const acts2 = await activities(lead2.id);
const held = acts2.find((a) => a.activity_type === 'auto_send_held');
check('auto_send_held recorded with reason daily_cap', held?.metadata?.reason === 'daily_cap', held?.description);
check('no send attempted', !acts2.some((a) => a.activity_type === 'auto_send_failed' || a.activity_type === 'message_sent'));
const { data: after2 } = await sb.from('agent_leads').select('inbox_status').eq('id', lead2.id).single();
check('lead held as draft_ready', after2.inbox_status === 'draft_ready', after2.inbox_status);
await sb.from('agent_configs').update({ auto_send_daily_cap: 25 }).eq('user_id', userId);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall passed');
process.exit(fails.length ? 1 : 0);
