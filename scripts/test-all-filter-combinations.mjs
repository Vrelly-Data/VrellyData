const SUPABASE_URL = 'https://lgnvolndyftsbcjprmic.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbnZvbG5keWZ0c2JjanBybWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzc4NDAsImV4cCI6MjA4NzcxMzg0MH0.Y84AiuDMsDQHCP9RnlKJzy8LFa6KJ3_7u0CK6jwDBog'

async function callRpc(fnName, params, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status} ${res.statusText}: ${text}`)
    }
    return res.json()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error('TIMEOUT (>10000ms)')
    throw err
  }
}

const testCombinations = [
  // --- Single filters ---
  { name: 'keywords only', params: { p_keywords: ['biotech'] } },
  { name: 'job_titles only', params: { p_job_titles: ['founder'] } },
  { name: 'seniority_levels only', params: { p_seniority_levels: ['Director'] } },
  { name: 'industries only', params: { p_industries: ['Technology'] } },
  { name: 'cities only', params: { p_cities: ['New York'] } },
  { name: 'departments only', params: { p_departments: ['Marketing'] } },
  { name: 'company_size_ranges only', params: { p_company_size_ranges: ['51-200'] } },
  { name: 'has_email only', params: { p_has_personal_email: true } },
  { name: 'has_phone only', params: { p_has_phone: true } },
  { name: 'has_linkedin only', params: { p_has_linkedin: true } },

  // --- Two-filter combinations ---
  { name: 'keywords + job_titles', params: { p_keywords: ['biotech'], p_job_titles: ['founder'] } },
  { name: 'keywords + industry', params: { p_keywords: ['biotech'], p_industries: ['Technology'] } },
  { name: 'keywords + city', params: { p_keywords: ['biotech'], p_cities: ['New York'] } },
  { name: 'keywords + seniority', params: { p_keywords: ['biotech'], p_seniority_levels: ['Director'] } },
  { name: 'keywords + department', params: { p_keywords: ['biotech'], p_departments: ['Marketing'] } },
  { name: 'job_titles + seniority', params: { p_job_titles: ['founder'], p_seniority_levels: ['Director'] } },
  { name: 'job_titles + industry', params: { p_job_titles: ['founder'], p_industries: ['Technology'] } },
  { name: 'job_titles + city', params: { p_job_titles: ['founder'], p_cities: ['New York'] } },
  { name: 'seniority + city', params: { p_seniority_levels: ['Director'], p_cities: ['New York'] } },
  { name: 'department + city', params: { p_departments: ['Marketing'], p_cities: ['New York'] } },

  // --- Three-filter combinations ---
  { name: 'keywords + job_titles + industry', params: { p_keywords: ['biotech'], p_job_titles: ['founder'], p_industries: ['Technology'] } },
  { name: 'keywords + job_titles + city', params: { p_keywords: ['biotech'], p_job_titles: ['founder'], p_cities: ['New York'] } },
  { name: 'keywords + job_titles + company_size', params: { p_keywords: ['biotech'], p_job_titles: ['founder'], p_company_size_ranges: ['51-200'] } },
  { name: 'seniority + department + city', params: { p_seniority_levels: ['Director'], p_departments: ['Marketing'], p_cities: ['New York'] } },

  // --- Four-filter combination ---
  { name: 'job_titles + department + seniority + city', params: { p_job_titles: ['founder'], p_departments: ['Marketing'], p_seniority_levels: ['Director'], p_cities: ['New York'] } },

  // --- All filters together ---
  {
    name: 'ALL filters combined',
    params: {
      p_keywords: ['biotech'],
      p_job_titles: ['founder'],
      p_seniority_levels: ['Director'],
      p_industries: ['Technology'],
      p_cities: ['New York'],
      p_departments: ['Marketing'],
      p_company_size_ranges: ['51-200'],
      p_has_personal_email: true,
      p_has_phone: true,
      p_has_linkedin: true,
    },
  },
]

let passed = 0
let failed = 0
const results = []

console.log('\n========================================')
console.log('  People Builder - Filter Combination Tests')
console.log('========================================\n')
console.log(`Running ${testCombinations.length} test combinations...\n`)

for (const test of testCombinations) {
  const params = { ...test.params, p_limit: 10, p_offset: 0 }
  const start = performance.now()

  try {
    const data = await callRpc('search_prospects_results', params)
    const elapsed = Math.round(performance.now() - start)
    const numResults = Array.isArray(data) ? data.length : 0
    const status = elapsed < 10000 && numResults >= 0 ? 'PASS' : 'FAIL'

    if (status === 'PASS') passed++; else failed++

    console.log(`[${status}] ${test.name}`)
    console.log(`       Time: ${elapsed}ms | Results: ${numResults}`)
    results.push({ name: test.name, status, elapsed, numResults })
  } catch (err) {
    const elapsed = Math.round(performance.now() - start)
    failed++
    console.log(`[FAIL] ${test.name}`)
    console.log(`       Time: ${elapsed}ms | ERROR: ${err.message}`)
    results.push({ name: test.name, status: 'FAIL', elapsed, error: err.message })
  }

  console.log('')
}

console.log('========================================')
console.log('  Summary')
console.log('========================================')
console.log(`Total:  ${testCombinations.length}`)
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
console.log('')

console.log('--- Results Table ---')
console.log('Status | Time (ms) | Results | Combination')
console.log('-------|-----------|---------|------------')
for (const r of results) {
  const res = r.error ? `ERR: ${r.error}` : String(r.numResults)
  console.log(`${r.status.padEnd(6)} | ${String(r.elapsed).padStart(9)} | ${res.padStart(7)} | ${r.name}`)
}
console.log('')
