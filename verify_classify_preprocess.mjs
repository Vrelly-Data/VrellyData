// Does swapping classify-reply's step-1 HTML strip for the shared htmlToText
// change what the MODEL actually sees?
//
// classify-reply feeds the AI's reasoning, so the bar is not "cleaner" — it is
// "no worse". The specific hazard: steps 3-5 (quoted-chain, signature and
// closing markers) are LINE-STRUCTURE sensitive, and htmlToText collapses
// whitespace differently from the inline block it replaces. If a quote marker
// stops matching, an entire quoted thread survives into the prompt.
//
// This runs OLD and NEW over real prod reply bodies and diffs the final output.
import fs from 'node:fs';
import { htmlToText } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/html-to-text.ts';

// ---- steps 2-6, identical in both variants (verbatim from classify-reply) ---
function tail(s) {
  s = s.replace(/##-\s*Please type your reply above this line\s*-##[\s\S]*$/i, '');
  const quoteMarkers = [
    /^On\s+.+?\swrote:\s*$/m,
    /^From:\s.+?\nSent:\s/m,
    /^From:\s.+?\nDate:\s/m,
    /^_{20,}\s*$/m,
    /^>\s.+$/m,
  ];
  let eq = -1;
  for (const re of quoteMarkers) { const m = s.search(re); if (m >= 0 && (eq === -1 || m < eq)) eq = m; }
  const quoteCut = eq >= 0;
  if (quoteCut) s = s.slice(0, eq);

  const sigMarkers = [
    /^--\s*$/m, /^Sent from my iPhone\b/im, /^Sent from my iPad\b/im,
    /^Get Outlook for (iOS|Android)\b/im, /^Sent from Outlook\b/im,
  ];
  let es = -1;
  for (const re of sigMarkers) { const m = s.search(re); if (m >= 0 && (es === -1 || m < es)) es = m; }
  const sigCut = es >= 0;
  if (sigCut) s = s.slice(0, es);

  const closingRe = /^(Best|Thanks|Thank you|Regards|Best regards|Kind regards|Cheers|Sincerely|Yours)[,!.]?\s*\n\s*[A-Za-z][A-Za-z\s.\-']{0,60}\s*$/im;
  const cm = s.search(closingRe);
  const closingCut = cm >= 0;
  if (closingCut) s = s.slice(0, cm);

  return { out: s.replace(/\n{3,}/g, '\n\n').trim(), quoteCut, sigCut, closingCut };
}

// ---- OLD: gated inline strip, 6 entities, no numeric/named forms -----------
function OLD(text) {
  if (!text) return { out: '', quoteCut: false, sigCut: false, closingCut: false };
  let s = text;
  if (/<[a-z][^>]*>/i.test(s)) {
    s = s
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  }
  return tail(s);
}

// ---- NEW: shared htmlToText, ungated (its own fast path handles plain text) -
function NEW(text) {
  if (!text) return { out: '', quoteCut: false, sigCut: false, closingCut: false };
  return tail(htmlToText(text));
}

const ENT_RE = /&(nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|copy|reg|trade|deg|middot|bull|zwnj|shy);|&#x?[0-9a-fA-F]+;/;
const CSS_RE = /!important|@media|ExternalClass|MsoNormal|ReadMsgBody|text-size-adjust|border-collapse|mso-/i;

const samples = JSON.parse(fs.readFileSync(process.env.SAMPLES_FILE, 'utf8'));
let identical = 0, differ = 0;
let oldEnt = 0, newEnt = 0, oldCss = 0, newCss = 0;
let quoteLost = 0, quoteGained = 0, sigLost = 0, closingLost = 0;
let newLonger = 0, newShorter = 0;
const regressions = [], improvements = [];

for (const s of samples) {
  const src = s.text ?? '';
  if (!src.trim()) continue;
  const o = OLD(src), n = NEW(src);
  if (o.out === n.out) { identical++; } else { differ++; }
  if (ENT_RE.test(o.out)) oldEnt++;
  if (ENT_RE.test(n.out)) newEnt++;
  if (CSS_RE.test(o.out)) oldCss++;
  if (CSS_RE.test(n.out)) newCss++;

  // A marker that fired for OLD but not NEW means less got cut → more junk to the model.
  if (o.quoteCut && !n.quoteCut) { quoteLost++; regressions.push({ kind: 'quote-marker lost', s, o, n }); }
  if (!o.quoteCut && n.quoteCut) quoteGained++;
  if (o.sigCut && !n.sigCut) { sigLost++; regressions.push({ kind: 'signature-marker lost', s, o, n }); }
  if (o.closingCut && !n.closingCut) { closingLost++; regressions.push({ kind: 'closing-marker lost', s, o, n }); }
  if (n.out.length > o.out.length * 1.25 + 40) { newLonger++; regressions.push({ kind: 'output grew >25%', s, o, n }); }
  if (o.out.length > n.out.length * 1.25 + 40) { newShorter++; improvements.push({ kind: 'output shrank >25%', s, o, n }); }
}

console.log(`samples: ${samples.length}   identical output: ${identical}   differing: ${differ}`);
console.log(`\n                        OLD     NEW`);
console.log(`  entity leakage      ${String(oldEnt).padStart(5)}   ${String(newEnt).padStart(5)}`);
console.log(`  CSS leakage         ${String(oldCss).padStart(5)}   ${String(newCss).padStart(5)}`);
console.log(`\nMARKER BEHAVIOUR (cutting LESS than before = regression)`);
console.log(`  quote marker lost   : ${quoteLost}     gained: ${quoteGained}`);
console.log(`  signature lost      : ${sigLost}`);
console.log(`  closing lost        : ${closingLost}`);
console.log(`  output grew >25%    : ${newLonger}     shrank >25%: ${newShorter}`);

for (const r of regressions.slice(0, 6)) {
  console.log(`\n--- REGRESSION: ${r.kind} — ${r.s.label}`);
  console.log(`  OLD (${r.o.out.length}): ${JSON.stringify(r.o.out.slice(0, 220))}`);
  console.log(`  NEW (${r.n.out.length}): ${JSON.stringify(r.n.out.slice(0, 220))}`);
}
for (const r of improvements.slice(0, 3)) {
  console.log(`\n--- IMPROVEMENT: ${r.kind} — ${r.s.label}`);
  console.log(`  OLD (${r.o.out.length}): ${JSON.stringify(r.o.out.slice(0, 200))}`);
  console.log(`  NEW (${r.n.out.length}): ${JSON.stringify(r.n.out.slice(0, 200))}`);
}
console.log(`\nVERDICT: ${quoteLost === 0 && sigLost === 0 && closingLost === 0 && newLonger === 0 && newEnt === 0 && newCss === 0
  ? 'PASS — nothing cut less, no leakage survives' : 'REVIEW — see regressions above'}`);
