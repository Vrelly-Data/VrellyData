// Replay OLD vs NEW name derivation over every stored production payload,
// in chronological order, simulating last-write-wins per prospect.
import fs from 'node:fs';
const ev = JSON.parse(fs.readFileSync(process.env.F,'utf8'))
  .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
const OLD=(p)=>(p.to_name ?? null);
const NEW=(p)=>{ const email=(p.sl_lead_email||'').toLowerCase()||null;
  const to=(p.to_email||'').trim().toLowerCase()||null;
  const nm=(p.to_name||'').trim()||null;
  return (email && to && to===email) ? nm : null; };
// Seed BOTH with the name already stored, because the deployed fix omits
// full_name when it has nothing trustworthy — the stored value survives. The
// first replay skipped that and made preserved names look like data loss.
const stored = JSON.parse(fs.readFileSync(process.env.STORED,'utf8'));
const oldS={}, newS={};
for (const r of stored) { if (r.email) { oldS[r.email.toLowerCase()]=r.full_name; newS[r.email.toLowerCase()]=r.full_name; } }
let rejected=0;
for (const p of ev) {
  const k=(p.sl_lead_email||'').toLowerCase(); if(!k) continue;
  const o=OLD(p); if(o) oldS[k]=o;
  const n=NEW(p); if(n) newS[k]=n; else if(p.to_name) rejected++;
}
const keys=[...new Set([...Object.keys(oldS),...Object.keys(newS)])].sort();
const changed=keys.filter(k=>oldS[k]!==newS[k]);
console.log(`events replayed        : ${ev.length}`);
console.log(`names rejected as ours : ${rejected}`);
console.log(`prospects with a name  : old ${Object.keys(oldS).length} -> new ${Object.keys(newS).length}`);
console.log(`FINAL NAME DIFFERS     : ${changed.length}\n`);
for (const k of changed) console.log(`  ${k.padEnd(38)} OLD ${JSON.stringify(oldS[k]||null).padEnd(28)} NEW ${JSON.stringify(newS[k]||null)}`);
const focus=['costa@actioncolors.com','emmett@paiscpa.com','nbrown@ironrockproperties.com','denise@denisecastrocpa.com','john@duracleancarpet.com','clyde.jensen@sfsmobile.com'];
console.log('\n=== the cases you named ===');
for (const k of focus) console.log(`  ${k.padEnd(34)} OLD ${JSON.stringify(oldS[k]??null).padEnd(26)} NEW ${JSON.stringify(newS[k]??null)}`);
