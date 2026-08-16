// Live: call Apollo api_search DIRECTLY, so the mapper is validated against the
// real response shape rather than against the docs. 0 credits.
const KEY = process.env.APOLLO_API_KEY;
const res = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': KEY },
  body: JSON.stringify({ person_titles: ['CEO'], q_keywords: 'healthcare', page: 1, per_page: 5 }),
});
console.log('HTTP', res.status);
const text = await res.text();
if (!res.ok) { console.log(text.slice(0, 600)); process.exit(1); }
const data = JSON.parse(text);
console.log('top-level keys :', Object.keys(data).join(', '));
console.log('pagination     :', JSON.stringify(data.pagination));
const arr = data.people ?? data.contacts ?? [];
console.log('people array   :', Array.isArray(data.people) ? `people[${data.people.length}]` : 'ABSENT',
            '| contacts:', Array.isArray(data.contacts) ? data.contacts.length : 'absent');
if (arr.length) {
  const p = arr[0];
  console.log('\nfirst person, ALL keys:\n ', Object.keys(p).sort().join(', '));
  console.log('\nfields my mapper reads:');
  for (const f of ['id','first_name','last_name','last_name_obfuscated','title','has_email','has_direct_phone','city','state','country','email','phone']) {
    console.log(`   ${f.padEnd(22)} ${JSON.stringify(p[f])}`);
  }
  console.log('\n  organization:', p.organization ? Object.keys(p.organization).slice(0,10).join(', ') : JSON.stringify(p.organization_name ?? null));
  console.log('\nCREDIT-SENSITIVE CHECK — does search leak contact data?');
  console.log('   any email present?', arr.some(x => x.email));
  console.log('   any phone present?', arr.some(x => x.phone_numbers?.length || x.direct_phone));
}
