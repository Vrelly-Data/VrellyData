// Backfill last_surfaced_reply_at on the pre-existing operator-dismissed
// HeyReach leads that still carry a NULL watermark. With NULL, the poller's
// newerThanPrior is trivially true, so the ONLY thing keeping these dismissals
// from being silently undone is the skippedSameText guard. Same high-water rule
// as the bulk dismissal: max over every HeyReach conversation sharing the url,
// floored by the stored thread's newest message.
//
// Ad-hoc investigation script from the 2026-08-13 HeyReach session. Read-only
// against the HeyReach API unless noted; nothing here writes to the database.
//
// Credentials (never hardcode):
//   PROD_DB='postgresql://postgres.lgnvolndyftsbcjprmic@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
//   export HR_KEY=$(psql "$PROD_DB" -Atc "select api_key_encrypted from outbound_integrations where platform='heyreach' and is_active;")
//
// Usage:  LEADS_FILE=null_wm.json OUT_FILE=backfill.sql HR_KEY=... \
//           node heyreach_backfill_null_watermarks.mjs
//
// Emits SQL only. Covers already-dismissed leads carrying a NULL watermark,
// where newerThanPrior is trivially true and only the skippedSameText guard
// stops the dismissal being silently undone. 2026-08-13: 29 rows, 18 of them
// with a prospect-newest thread and therefore genuinely exposed.

import fs from 'node:fs';
const KEY = process.env.HR_KEY, API = 'https://api.heyreach.io/api/public';
const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));

const all = []; let offset = 0, total = null;
while (total === null || offset < total) {
  const r = await fetch(`${API}/inbox/GetConversationsV2`, {
    method: 'POST',
    headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ filters: { linkedInAccountIds: [], campaignIds: [], searchString: '' }, offset, limit: 100 }),
  });
  const d = await r.json(); const items = d.items || []; total = d.totalCount || 0;
  all.push(...items); offset += items.length; if (!items.length) break;
  await new Promise(s => setTimeout(s, 200));
}
const byUrl = new Map();
for (const c of all) {
  const u = (c.correspondentProfile?.profileUrl || '').trim(); if (!u) continue;
  const ms = Date.parse(c.lastMessageAt || '');
  const cur = byUrl.get(u) || { maxMs: -1, n: 0 };
  cur.n++; if (Number.isFinite(ms) && ms > cur.maxMs) cur.maxMs = ms;
  byUrl.set(u, cur);
}

const rows = [], skipped = [];
for (const L of leads) {
  const api = byUrl.get(L.linkedin_url);
  const threadMs = Date.parse(L.thread_newest || '');
  const eff = Math.max(Number.isFinite(threadMs) ? threadMs : -1, api ? api.maxMs : -1);
  if (eff < 0) { skipped.push(L); continue; }
  rows.push({ id: L.id, name: L.full_name, wm: new Date(eff).toISOString(), convos: api?.n ?? 0,
              understated: (api?.maxMs ?? -1) > (Number.isFinite(threadMs) ? threadMs : -1) });
}
console.log(`watermark computable for ${rows.length}/${leads.length}; skipped (no timestamp anywhere): ${skipped.length}`);
for (const s of skipped) console.log(`   SKIP ${s.full_name} — ${s.linkedin_url} (thread_len=${s.thread_len})`);
const u = rows.filter(r => r.understated);
console.log(`watermark taken from a sibling conversation: ${u.length}`);
for (const r of u) console.log(`   ${r.name} (convos=${r.convos}) -> ${r.wm}`);

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
fs.writeFileSync(process.env.OUT_FILE,
`-- Backfill last_surfaced_reply_at on pre-existing dismissed HeyReach leads
-- whose watermark was NULL. See gen_backfill_29.mjs header for the rule.
BEGIN;
UPDATE agent_leads AS a
SET last_surfaced_reply_at = v.wm
FROM (VALUES
${rows.map(r => `  (${q(r.id)}::uuid, ${q(r.wm)}::timestamptz)`).join(',\n')}
) AS v(id, wm)
WHERE a.id = v.id AND a.source = 'heyreach'
  AND a.inbox_status = 'dismissed' AND a.last_surfaced_reply_at IS NULL;
`);
console.log(`wrote ${rows.length} rows -> ${process.env.OUT_FILE}`);
