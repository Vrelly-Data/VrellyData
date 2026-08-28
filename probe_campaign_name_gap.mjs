#!/usr/bin/env node
// READ-ONLY. Verifies the inbox campaign-name fix against real data.
//
// Mirrors src/hooks/useCampaignNames.ts exactly: builds the same two
// external_campaign_id -> name maps (scoped by integration platform) and runs
// the same resolveCampaignName() precedence over every agent_leads row.
//
// Answers:
//   1. How many leads show NO campaign name today, by source?
//   2. How many of those the fix newly resolves, by source?
//   3. That ZERO reply_io leads change what they display.
//
// Usage:
//   PROJECT_REF=<ref> SR_KEY=<service-role-key> node probe_campaign_name_gap.mjs
//   (dev ref: iqxzetwuxykplzdjysiu   prod ref: lgnvolndyftsbcjprmic)
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const key = process.env.SR_KEY ?? fs.readFileSync(process.env.SR_KEY_FILE, 'utf8').trim();
const sb = createClient(`https://${process.env.PROJECT_REF}.supabase.co`, key, {
  auth: { persistSession: false },
});

async function pageAll(table, cols, tweak) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data);
    if (data.length < 1000) break;
  }
  return out;
}

// ---- Build the same maps the hook builds -----------------------------------
const integrations = await pageAll('outbound_integrations', 'id, platform, name, created_by');
const platformById = new Map(integrations.map((i) => [i.id, i.platform]));
const campaigns = await pageAll('synced_campaigns', 'name, external_campaign_id, integration_id');

const smartleadNames = new Map();
const heyreachNames = new Map();
for (const r of campaigns) {
  const name = r.name?.trim();
  if (!name || !r.external_campaign_id || !r.integration_id) continue;
  const target =
    platformById.get(r.integration_id) === 'smartlead' ? smartleadNames
    : platformById.get(r.integration_id) === 'heyreach' ? heyreachNames
    : null;
  if (target && !target.has(String(r.external_campaign_id))) {
    target.set(String(r.external_campaign_id), name);
  }
}
console.log(`synced_campaigns: ${campaigns.length} rows`);
console.log(`  smartlead map: ${smartleadNames.size} ids`);
console.log(`  heyreach  map: ${heyreachNames.size} ids`);

// ---- resolveCampaignName(), verbatim ---------------------------------------
function resolve(lead) {
  const stored = lead.last_campaign_name?.trim();
  if (stored) return { name: stored, via: 'stored' };
  if (lead.smartlead_campaign_id) {
    const n = smartleadNames.get(String(lead.smartlead_campaign_id));
    if (n) return { name: n, via: 'smartlead-id' };
  }
  const isHeyReach = lead.source === 'heyreach' || lead.heyreach_account_id != null;
  if (isHeyReach && lead.campaign_external_id) {
    const n = heyreachNames.get(String(lead.campaign_external_id));
    if (n) return { name: n, via: 'heyreach-id' };
  }
  return { name: null, via: null };
}

const leads = await pageAll(
  'agent_leads',
  'id, user_id, source, channel, last_campaign_name, smartlead_campaign_id, campaign_external_id, heyreach_account_id',
);
console.log(`\nagent_leads: ${leads.length} rows`);

// ---- 1 + 2: before/after, by source ----------------------------------------
const bySource = {};
for (const l of leads) {
  const k = l.source ?? '(null)';
  bySource[k] ??= { n: 0, showsNameToday: 0, newlyResolved: 0, stillBlank: 0, changedExisting: 0 };
  const b = bySource[k];
  b.n++;
  const before = l.last_campaign_name?.trim() || null;
  const after = resolve(l);
  if (before) {
    b.showsNameToday++;
    if (after.name !== before) b.changedExisting++; // must always be 0
  } else if (after.name) {
    b.newlyResolved++;
  } else {
    b.stillBlank++;
  }
}
console.log('\n== campaign line: before vs after, by source ==');
console.table(bySource);

// ---- 3: per-tenant, non-reply.io (so SourceCo is visible) ------------------
const byUser = {};
for (const l of leads) {
  if (l.source === 'reply_io') continue;
  const k = `${l.user_id.slice(0, 8)} / ${l.source ?? '(null)'}`;
  byUser[k] ??= { n: 0, showsNameToday: 0, newlyResolved: 0, stillBlank: 0 };
  byUser[k].n++;
  const before = l.last_campaign_name?.trim() || null;
  if (before) byUser[k].showsNameToday++;
  else if (resolve(l).name) byUser[k].newlyResolved++;
  else byUser[k].stillBlank++;
}
console.log('\n== non-reply.io leads by tenant ==');
console.table(byUser);

// ---- Why anything is still blank -------------------------------------------
const unresolvedReasons = {};
for (const l of leads) {
  if (l.last_campaign_name?.trim() || resolve(l).name) continue;
  const k = l.source ?? '(null)';
  unresolvedReasons[k] ??= { noIdAtAll: 0, slIdNotInMap: 0, hrIdNotInMap: 0, idButNotHeyReachSource: 0 };
  const r = unresolvedReasons[k];
  if (l.smartlead_campaign_id) r.slIdNotInMap++;
  else if (l.campaign_external_id && (l.source === 'heyreach' || l.heyreach_account_id != null)) r.hrIdNotInMap++;
  else if (l.campaign_external_id) r.idButNotHeyReachSource++;
  else r.noIdAtAll++;
}
console.log('\n== still-blank leads: why ==');
console.table(unresolvedReasons);

// ---- Sample of newly-resolved rows, for eyeballing --------------------------
console.log('\n== sample: newly resolved (up to 15) ==');
let shown = 0;
for (const l of leads) {
  if (l.last_campaign_name?.trim()) continue;
  const a = resolve(l);
  if (!a.name) continue;
  console.log(`  ${l.source}/${l.channel}  via=${a.via}  id=${l.smartlead_campaign_id ?? l.campaign_external_id}  -> "${a.name}"`);
  if (++shown >= 15) break;
}

// ---- Hard assertion --------------------------------------------------------
const changed = leads.filter((l) => {
  const before = l.last_campaign_name?.trim() || null;
  return before && resolve(l).name !== before;
});
console.log(`\nASSERT leads whose EXISTING campaign name changes: ${changed.length} (must be 0)`);
const replyChanged = leads.filter(
  (l) => l.source === 'reply_io' && !(l.last_campaign_name?.trim()) && resolve(l).name,
);
console.log(`ASSERT reply_io leads that newly show a name: ${replyChanged.length} (expected 0 — no reply.io path writes smartlead_campaign_id, and the heyreach map is gated on source)`);
