const SUPABASE_URL = 'https://lgnvolndyftsbcjprmic.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbnZvbG5keWZ0c2JjanBybWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzc4NDAsImV4cCI6MjA4NzcxMzg0MH0.Y84AiuDMsDQHCP9RnlKJzy8LFa6KJ3_7u0CK6jwDBog'

async function callRpc(fnName, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json()
}

const filters = [
  { name: 'job_titles',          param: 'p_job_titles',          value: ['Marketing Manager'] },
  { name: 'keywords',            param: 'p_keywords',            value: ['sales'] },
  { name: 'seniority_levels',    param: 'p_seniority_levels',    value: ['Director'] },
  { name: 'industries',          param: 'p_industries',          value: ['Technology'] },
  { name: 'cities',              param: 'p_cities',              value: ['New York'] },
  { name: 'departments',         param: 'p_departments',         value: ['Marketing'] },
  { name: 'company_size_ranges', param: 'p_company_size_ranges', value: ['51-200'] },
  { name: 'has_email',           param: 'p_has_personal_email',  value: true },
  { name: 'has_phone',           param: 'p_has_phone',           value: true },
  { name: 'has_linkedin',        param: 'p_has_linkedin',        value: true },
  { name: 'company_names',       param: 'p_company_names',       value: ['Google'] },
]

let passed = 0, failed = 0

console.log('\n=== People Builder Filter Tests ===\n')

for (const filter of filters) {
  const params = { [filter.param]: filter.value }
  const countParams = { ...params }
  const resultsParams = { ...params, p_limit: 10, p_offset: 0 }

  try {
    const [countData, resultsData] = await Promise.all([
      callRpc('search_prospects_count', countParams),
      callRpc('search_prospects_results', resultsParams),
    ])

    const count = countData?.[0]?.total_count ?? countData?.total_count ?? 0
    const numResults = Array.isArray(resultsData) ? resultsData.length : 0
    const ok = count > 0 && numResults > 0
    const status = ok ? 'PASS' : 'FAIL'

    console.log(`[${status}] ${filter.name} = ${JSON.stringify(filter.value)}`)
    console.log(`       count: ${count}, results: ${numResults}`)

    if (ok) passed++; else failed++
  } catch (err) {
    console.log(`[FAIL] ${filter.name} = ${JSON.stringify(filter.value)}`)
    console.log(`       ERROR: ${err.message}`)
    failed++
  }
}

console.log(`\n=== Summary: ${passed} PASS, ${failed} FAIL out of ${filters.length} filters ===\n`)
