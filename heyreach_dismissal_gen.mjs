//
// Ad-hoc investigation script from the 2026-08-13 HeyReach session. Read-only
// against the HeyReach API unless noted; nothing here writes to the database.
//
// Credentials (never hardcode):
//   PROD_DB='postgresql://postgres.lgnvolndyftsbcjprmic@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
//   export HR_KEY=$(psql "$PROD_DB" -Atc "select api_key_encrypted from outbound_integrations where platform='heyreach' and is_active;")
//
// Usage:  SCRATCH=<dir with dismiss_set.json + pending.json> node heyreach_dismissal_gen.mjs
//
// Emits apply_dismissal.sql (into SCRATCH) and heyreach_dismissal_rollback.sql
// (into cwd). Generates SQL only — applying it is a separate, deliberate step.
// CUTOFF_DAYS is the recency line below which a lead stays actionable; the
// 2026-08-13 run used 14, giving 249 dismissed / 4 kept pending.

import fs from 'node:fs';
const S = process.env.SCRATCH;
const d = JSON.parse(fs.readFileSync(S + '/dismiss_set.json', 'utf8'));
const leads = JSON.parse(fs.readFileSync(S + '/pending.json', 'utf8'));
const byId = new Map(leads.map(l => [l.id, l]));

const CUTOFF_DAYS = 14;
const set = d.filter(x => x.ageDays > CUTOFF_DAYS);
const kept = d.filter(x => x.ageDays <= CUTOFF_DAYS);

console.log(`dismiss: ${set.length}   keep-pending (<=${CUTOFF_DAYS}d): ${kept.length}`);
console.log('kept pending: ' + kept.map(k => `${k.name} (${k.ageDays}d)`).join(', '));

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const apply =
`-- Bulk move of stale HeyReach leads: Pending Approval -> Total Inbox.
--
-- last_surfaced_reply_at is set to the high-water mark across ALL HeyReach
-- conversations sharing the lead's linkedin_url, NOT max(reply_thread). The
-- two differ because agent_leads dedups on (user_id, linkedin_url) while
-- HeyReach holds several conversations per profile; the stored thread is only
-- whichever conversation the poller wrote last. Using the stored thread alone
-- would let the sibling conversation re-surface 8 of these on the next run.
--
-- Leads with activity in the last ${CUTOFF_DAYS} days are deliberately left pending.
BEGIN;

UPDATE agent_leads AS a
SET inbox_status = 'dismissed', last_surfaced_reply_at = v.wm, updated_at = now()
FROM (VALUES
${set.map(r => `  (${q(r.id)}::uuid, ${q(r.watermark)}::timestamptz)`).join(',\n')}
) AS v(id, wm)
WHERE a.id = v.id AND a.source = 'heyreach' AND a.inbox_status = 'pending';
`;
fs.writeFileSync(S + '/apply_dismissal.sql', apply);

const rollback =
`-- Rollback for the ${set.length}-lead HeyReach dismissal applied 2026-08-13.
-- Restores the exact prior inbox_status and last_surfaced_reply_at of every row
-- the dismissal touched. Run inside a transaction and inspect before COMMIT.
BEGIN;

UPDATE agent_leads AS a
SET inbox_status = v.st, last_surfaced_reply_at = v.wm
FROM (VALUES
${set.map(r => {
  const L = byId.get(r.id);
  const wm = L.last_surfaced_reply_at ? `${q(L.last_surfaced_reply_at)}::timestamptz` : 'NULL::timestamptz';
  return `  (${q(r.id)}::uuid, ${q(L.inbox_status)}, ${wm})`;
}).join(',\n')}
) AS v(id, st, wm)
WHERE a.id = v.id;

-- COMMIT;
`;
fs.writeFileSync('heyreach_dismissal_rollback.sql', rollback);
fs.writeFileSync(S + '/dismiss_ids.txt', set.map(r => r.id).join('\n'));
console.log('wrote apply_dismissal.sql + heyreach_dismissal_rollback.sql');
