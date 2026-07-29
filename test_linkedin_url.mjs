#!/usr/bin/env node
// Unit test for normalizeLinkedInUrl (src/lib/linkedin.ts), transpiled from the
// real source so it cannot drift. Cases are drawn from the shapes actually
// present in prod's agent_leads.linkedin_url column.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const js = execFileSync('node_modules/.bin/esbuild', ['--loader=ts', '--format=esm'],
  { input: fs.readFileSync('src/lib/linkedin.ts', 'utf8') }).toString();
const { normalizeLinkedInUrl } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

let failures = 0;
const eq = (label, input, expected) => {
  const got = normalizeLinkedInUrl(input);
  if (got !== expected) { failures++; console.log(`FAIL ${label}\n  input    ${JSON.stringify(input)}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(expected)}`); }
  else console.log(`ok   ${label}`);
};

// The overwhelmingly common shape — 2,287 of 2,288 prod rows. Must pass through.
eq('absolute https passes through unchanged',
  'https://www.linkedin.com/in/abe-giesbrecht-40617637',
  'https://www.linkedin.com/in/abe-giesbrecht-40617637');

// The one genuinely malformed prod row. A naive `https://` + value would make
// "https://ttps://www.linkedin.com/..." — a guaranteed 404.
eq('repairs the truncated scheme found in prod',
  'ttps://www.linkedin.com/in/chandrapendyala',
  'https://www.linkedin.com/in/chandrapendyala');

eq('bare host gets a scheme', 'linkedin.com/in/jane', 'https://linkedin.com/in/jane');
eq('bare host with www', 'www.linkedin.com/in/jane', 'https://www.linkedin.com/in/jane');
eq('protocol-relative', '//www.linkedin.com/in/jane', 'https://www.linkedin.com/in/jane');
eq('regional subdomain preserved', 'https://de.linkedin.com/in/hans', 'https://de.linkedin.com/in/hans');
eq('http upgraded host is kept as https', 'http://www.linkedin.com/in/jane', 'https://www.linkedin.com/in/jane');
eq('surrounding whitespace trimmed', '  https://www.linkedin.com/in/jane  ', 'https://www.linkedin.com/in/jane');
eq('company page path', 'https://www.linkedin.com/company/acme', 'https://www.linkedin.com/company/acme');

// Requirement: render nothing rather than a dead icon.
eq('null  -> null', null, null);
eq('undefined -> null', undefined, null);
eq('empty string -> null', '', null);
eq('whitespace only -> null', '   ', null);

// Safety: an href must never carry a script-bearing scheme.
eq('javascript: refused', 'javascript:alert(1)', null);
eq('data: refused', 'data:text/html,<script>alert(1)</script>', null);
eq('mailto: refused', 'mailto:a@b.com', null);

// Non-linkedin absolute URLs are left alone (some rows hold a personal site).
eq('other absolute url passes through', 'https://example.com/me', 'https://example.com/me');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
