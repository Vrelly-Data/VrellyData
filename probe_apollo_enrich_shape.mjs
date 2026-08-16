// LIVE bulk_match with exactly 2 ids. This SPENDS REAL CREDITS (1 per record
// where credit-consuming data is found). Validates the mapper against the real
// response shape — the docs were wrong about api_search in three places.
import { mapEnrichedPerson } from '/Users/myall/Projects/VrellyData/supabase/functions/_shared/apollo.ts';
const KEY = process.env.APOLLO_API_KEY;
const IDS = ['60d4d40ad384b9000195d103', '66fab8f4bb67e20001a33c87'];

const res = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': KEY },
  body: JSON.stringify({ reveal_personal_emails: false, reveal_phone_number: false,
                         details: IDS.map(id => ({ id })) }),
});
console.log('HTTP', res.status);
const text = await res.text();
if (!res.ok) { console.log(text.slice(0, 500)); process.exit(1); }
const data = JSON.parse(text);
console.log('top-level keys:', Object.keys(data).join(', '));
const arr = data.matches ?? data.people ?? [];
console.log('array used   :', Array.isArray(data.matches) ? `matches[${data.matches.length}]`
                            : Array.isArray(data.people) ? `people[${data.people.length}]` : 'NEITHER');
if (!arr.length) { console.log('no records returned'); process.exit(0); }

const p = arr[0];
console.log('\nfirst record — fields my mapper reads:');
for (const f of ['id','first_name','last_name','name','title','email','email_status','linkedin_url',
                 'city','state','country','revealed_for_current_team','contact_id']) {
  const v = p[f];
  console.log(`   ${f.padEnd(26)} ${typeof v} ${JSON.stringify(typeof v === 'string' && v.length > 42 ? v.slice(0,42)+'…' : v)}`);
}
console.log('   organization.name          ', JSON.stringify(p.organization?.name));
console.log('   organization.primary_domain', JSON.stringify(p.organization?.primary_domain));

console.log('\n=== MAPPER OUTPUT (local, no extra API call) ===');
for (const raw of arr) {
  const m = mapEnrichedPerson(raw);
  console.log(JSON.stringify({ id:m.apollo_person_id, name:m.name, email:m.email, email_status:m.email_status,
    linkedin_url:m.linkedin_url, org:m.organization_name, domain:m.organization_domain,
    revealed:m.revealed_for_current_team, contact_id:m.contact_id }));
}
const billable = arr.map(mapEnrichedPerson).filter(m => m.email || m.linkedin_url).length;
console.log(`\ncredits this call (records with email or linkedin): ${billable} of ${IDS.length} requested`);
console.log('phone requested? NO  personal emails requested? NO');
