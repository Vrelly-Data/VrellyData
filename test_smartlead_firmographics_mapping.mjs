#!/usr/bin/env node
// ============================================================================
// test_smartlead_firmographics_mapping.mjs
//
// Verifies Smartlead custom_fields firmographic extraction and that the
// smartlead-webhook people upsert no longer assigns firmographic columns to
// explicit null (coalesce/write-only semantics).
//
// Usage: node test_smartlead_firmographics_mapping.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SRC = 'supabase/functions/smartlead-webhook/index.ts';
const src = fs.readFileSync(SRC, 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${label}`);
};

// 1) Extract and test the mapping function
const fnStart = src.indexOf('function extractSmartleadFirmographics(');
const fnEnd = src.indexOf('}\n', fnStart) + 2;
if (fnStart < 0 || fnEnd < 0) {
  failures++; console.log('FAIL could not locate extractSmartleadFirmographics in source');
} else {
  const block =
    src.slice(fnStart, fnEnd) +
    '\nexport { extractSmartleadFirmographics };';
  const js = execFileSync('node_modules/.bin/esbuild', ['--loader=ts', '--format=esm'], { input: block }).toString();
  const { extractSmartleadFirmographics } =
    await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

  const cf = {
    Title: 'Head of Growth',
    City: 'Austin',
    'Company Size': '51-200',
    Industry: 'Biotech',
    'Company Phone': ' (512) 555-0199 ',
    Phone: ' 512-555-0100 ',
    random_field: 'ignore me',
  };
  const got = extractSmartleadFirmographics(cf);
  check('extract maps custom_fields case-insensitively',
    { job_title: got.job_title, city: got.city, company_size: got.company_size, industry: got.industry, phone: got.phone, company_phone: got.company_phone },
    { job_title: 'Head of Growth', city: 'Austin', company_size: '51-200', industry: 'Biotech', phone: '512-555-0100', company_phone: '(512) 555-0199' },
  );

  const blanks = extractSmartleadFirmographics({ Title: '  ', Phone: '0', 'Company Phone': '' });
  check('extract ignores blanks and sentinel "0"', blanks, {});
}

// 2) Static guard: people upsert must NOT assign firmographics to null anymore
const upsertStart = src.indexOf('supabase.from("people").upsert(');
const upsertEnd = src.indexOf(')', upsertStart + 1);
if (upsertStart < 0 || upsertEnd < 0) {
  failures++; console.log('FAIL could not locate people upsert block');
} else {
  const block = src.slice(upsertStart, upsertEnd);
  const forbidden = ['industry: null', 'city: null', 'state: null', 'country: null', 'company_size: null', 'company_phone: null', 'phone: null'];
  const present = forbidden.filter(sig => block.includes(sig));
  check('people upsert uses coalesce (no explicit null firmographics)', present, []);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);

