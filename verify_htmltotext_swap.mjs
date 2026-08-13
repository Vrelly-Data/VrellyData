// Verify the htmlToText swap against REAL Smartlead payloads before deploying.
// Imports the actual shared module (node --experimental-strip-types) and runs
// the OLD weak strip and the NEW htmlToText over the same live email_body.
import fs from 'node:fs';
import { htmlToText } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/html-to-text.ts';

const OLD = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const CSS_RE = /!important|@media|ExternalClass|MsoNormal|ReadMsgBody|text-size-adjust|border-collapse|mso-|font-family:|line-height:\s*[0-9]/i;
const ENT_RE = /&(nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|copy|reg|trade|deg|middot|bull|zwnj|shy);|&#x?[0-9a-fA-F]+;/;
const TAG_RE = /<\/?(div|p|span|table|tbody|tr|td|style|script|br|img|a|font|body|html|head|meta|ul|ol|li|h[1-6]|strong|em|center)\b[^>]*>/i;

const KEY = process.env.SL_KEY;
const targets = JSON.parse(fs.readFileSync(process.env.TARGETS_FILE, 'utf8'));

let checked = 0, oldCss = 0, oldEnt = 0, oldTag = 0, newCss = 0, newEnt = 0, newTag = 0;
let shown = 0;

for (const t of targets) {
  const url = new URL(`https://server.smartlead.ai/api/v1/campaigns/${t.campaign_id}/leads/${t.lead_id}/message-history`);
  url.searchParams.set('api_key', KEY);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { console.log(`  ${t.full_name}: message-history HTTP ${res.status}`); continue; }
  const body = await res.json().catch(() => null);
  const msgs = Array.isArray(body) ? body : Array.isArray(body?.history) ? body.history : [];
  for (const m of msgs) {
    const raw = m.email_body ?? m.body ?? '';
    if (!raw) continue;
    const o = OLD(raw), n = htmlToText(raw);
    checked++;
    if (CSS_RE.test(o)) oldCss++;
    if (ENT_RE.test(o)) oldEnt++;
    if (TAG_RE.test(o)) oldTag++;
    if (CSS_RE.test(n)) newCss++;
    if (ENT_RE.test(n)) newEnt++;
    if (TAG_RE.test(n)) newTag++;
    if (shown < 3 && (CSS_RE.test(o) || ENT_RE.test(o))) {
      shown++;
      console.log(`\n=== ${t.full_name} — ${m.type} @ ${m.time} (raw ${raw.length} chars) ===`);
      console.log(`  OLD: ${JSON.stringify(o.slice(0, 190))}`);
      console.log(`  NEW: ${JSON.stringify(n.slice(0, 190))}`);
    }
  }
  await new Promise(r => setTimeout(r, 400));
}

console.log(`\n===== ${checked} real Smartlead messages cleaned both ways =====`);
console.log(`                     OLD weak strip   NEW htmlToText`);
console.log(`  CSS leakage        ${String(oldCss).padStart(6)}          ${String(newCss).padStart(6)}`);
console.log(`  entity leakage     ${String(oldEnt).padStart(6)}          ${String(newEnt).padStart(6)}`);
console.log(`  surviving tags     ${String(oldTag).padStart(6)}          ${String(newTag).padStart(6)}`);
console.log(`\nRESULT: ${newCss === 0 && newEnt === 0 && newTag === 0 ? 'PASS — no leakage of any kind survives htmlToText' : 'FAIL — leakage remains, do not deploy'}`);
