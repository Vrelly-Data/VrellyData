// Simple sanity checks for copy fingerprint normalization.
// Run with: deno run --allow-read --allow-net=none verify_copy_fingerprint.mjs
import { normalizeOutboundCopy, computeCopyFingerprint } from "./supabase/functions/_shared/copy-fingerprint.ts";

function assertEqual(a, b, msg) {
  if (a !== b) {
    console.error("FAIL:", msg, "\n  left:", a, "\n right:", b);
    Deno.exit(1);
  }
}

const variants = [
  { body: "Hello world", subject: null },
  { body: " Hello   world ", subject: null },
  { body: "Hello\nworld", subject: null },
  { body: "HELLO WORLD", subject: null },
];

const normalized = variants.map(v => normalizeOutboundCopy(v.body, v.subject));
// All variants normalize to the same string
for (const s of normalized) assertEqual(s, normalized[0], "Normalization mismatch");

const fp = await computeCopyFingerprint(variants[0].body, variants[0].subject);
for (const v of variants.slice(1)) {
  const f = await computeCopyFingerprint(v.body, v.subject);
  assertEqual(f, fp, "Fingerprint mismatch across trivial variations");
}

console.log("PASS: copy fingerprint normalization is stable across trivial variations");

