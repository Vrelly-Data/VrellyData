const KEY = process.env.APOLLO_API_KEY;
const call = async (body) => {
  const r = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
    method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-cache','x-api-key':KEY},
    body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(()=>({})) };
};
const { data } = await call({ person_titles:['CEO','CTO'], q_keywords:'software', page:1, per_page:25 });
const people = data.people ?? [];
console.log(`records: ${people.length}   total_entries: ${data.total_entries}`);
const types = {};
for (const p of people) for (const [k,v] of Object.entries(p)) {
  const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  (types[k] ??= new Set()).add(`${t}${t==='string'&&v.length<8?`(${JSON.stringify(v)})`:''}`);
}
console.log('\nfield -> observed types across all records:');
for (const k of Object.keys(types).sort()) console.log(`  ${k.padEnd(24)} ${[...types[k]].join(' | ')}`);

console.log('\n--- pagination probe: is total_entries the only count? ---');
console.log('  has .pagination?', 'pagination' in data, '| total_entries:', data.total_entries);

console.log('\n--- page 2 returns different people? ---');
const p2 = await call({ person_titles:['CEO','CTO'], q_keywords:'software', page:2, per_page:5 });
const ids1 = new Set(people.slice(0,5).map(p=>p.id));
const ids2 = (p2.data.people??[]).map(p=>p.id);
console.log('  page2 ids overlap page1:', ids2.filter(i=>ids1.has(i)).length, 'of', ids2.length);
