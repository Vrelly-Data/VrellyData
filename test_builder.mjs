import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://lgnvolndyftsbcjprmic.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbnZvbG5keWZ0c2JjanBybWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzc4NDAsImV4cCI6MjA4NzcxMzg0MH0.Y84AiuDMsDQHCP9RnlKJzy8LFa6KJ3_7u0CK6jwDBog'
)

let passed = 0, failed = 0, warned = 0

async function test(name, params, expectMin = 1) {
  const start = Date.now()
  try {
    const [countRes, resultsRes] = await Promise.all([
      supabase.rpc('search_prospects_count', params),
      supabase.rpc('search_prospects_results', { ...params, p_limit: 10, p_offset: 0 })
    ])
    const ms = Date.now() - start
    
    if (countRes.error) { console.log(`❌ ${name}: COUNT ERROR - ${countRes.error.message} (${ms}ms)`); failed++; return }
    if (resultsRes.error) { console.log(`❌ ${name}: RESULTS ERROR - ${resultsRes.error.message} (${ms}ms)`); failed++; return }
    
    const count = countRes.data?.[0]?.total_count ?? 0
    const isEstimate = countRes.data?.[0]?.is_estimate ?? false
    const actualResults = resultsRes.data?.length ?? 0
    const countLabel = isEstimate ? `~${Number(count).toLocaleString()}` : Number(count).toLocaleString()
    
    if (count === 0 && actualResults === 0) {
      console.log(`⚠️  ${name}: 0 results (${ms}ms)`)
      warned++
    } else if (count < expectMin) {
      console.log(`⚠️  ${name}: count=${countLabel}, actual=${actualResults} — below expected ${expectMin} (${ms}ms)`)
      warned++
    } else {
      console.log(`✅ ${name}: count=${countLabel}, actual=${actualResults} rows returned (${ms}ms)`)
      passed++
    }
  } catch (e) {
    console.log(`❌ ${name}: EXCEPTION - ${e.message}`)
    failed++
  }
}

console.log('\n🧪 Vrelly Builder — Full Variation Test\n')

// === SINGLE FILTERS ===
console.log('--- Single Filters ---')
await test('Job Title: CEO', { p_job_titles: ['CEO'] }, 1000)
await test('Job Title: founder', { p_job_titles: ['founder'] }, 1000)
await test('Job Title: marketing manager', { p_job_titles: ['marketing manager'] }, 100)
await test('Seniority: Cxo', { p_seniority_levels: ['Cxo'] }, 100000)
await test('Seniority: Director', { p_seniority_levels: ['Director'] }, 10000)
await test('Seniority: Manager', { p_seniority_levels: ['Manager'] }, 10000)
await test('Department: Sales', { p_departments: ['Sales'] }, 1000)
await test('Department: Marketing', { p_departments: ['Marketing'] }, 1000)
await test('Department: Engineering', { p_departments: ['Engineering'] }, 1000)
await test('Industry: Retail', { p_industries: ['Retail'] }, 10000)
await test('Industry: Financial Services', { p_industries: ['Financial Services'] }, 10000)
await test('Industry: Information Technology', { p_industries: ['Information Technology'] }, 1000)
await test('Industry: Healthcare', { p_industries: ['Healthcare'] }, 1000)
await test('City: New York', { p_cities: ['New York'] }, 10000)
await test('City: Los Angeles', { p_cities: ['Los Angeles'] }, 1000)
await test('City: Chicago', { p_cities: ['Chicago'] }, 1000)
await test('City: London', { p_cities: ['London'] }, 100)
await test('Country: United States', { p_countries: ['United States'] }, 100000)
await test('Gender: Male', { p_gender: ['M'] }, 100000)
await test('Gender: Female', { p_gender: ['F'] }, 100000)
await test('Skills: leadership', { p_person_skills: ['leadership'] }, 10000)
await test('Skills: sales', { p_person_skills: ['sales'] }, 10000)
await test('Skills: python', { p_person_skills: ['python'] }, 1000)
await test('Interests: technology', { p_person_interests: ['technology'] }, 1000)
await test('Technologies: salesforce', { p_technologies: ['salesforce'] }, 1000)
await test('Technologies: hubspot', { p_technologies: ['hubspot'] }, 100)
await test('Technologies: gmail', { p_technologies: ['gmail'] }, 1000)
await test('Income: $100k-$150k', { p_income: ['$100,000 to $149,999'] }, 10000)
await test('Income: $250k+', { p_income: ['$250,000+'] }, 1000)
await test('Net Worth: $1M+', { p_net_worth: ['$1,000,000 or more'] }, 10000)
await test('Company Size: 1-10', { p_company_size_ranges: ['1-10'] }, 10000)
await test('Company Size: 1001-5000', { p_company_size_ranges: ['1001-5000'] }, 10000)
await test('Company Size: 10000+', { p_company_size_ranges: ['10000+'] }, 10000)
await test('Has Personal Email', { p_has_personal_email: true }, 100000)
await test('Has Business Email', { p_has_business_email: true }, 100000)
await test('Has Phone', { p_has_phone: true }, 100000)
await test('Has LinkedIn', { p_has_linkedin: true }, 100000)
await test('Has Facebook', { p_has_facebook: true }, 10000)
await test('Has Company Twitter', { p_has_company_twitter: true }, 10000)
await test('Has Company Facebook', { p_has_company_facebook: true }, 10000)

// === TWO-FILTER COMBINATIONS ===
console.log('\n--- Two-Filter Combinations ---')
await test('CEO + LinkedIn', { p_job_titles: ['CEO'], p_has_linkedin: true }, 100)
await test('Director + Marketing dept', { p_seniority_levels: ['Director'], p_departments: ['Marketing'] }, 100)
await test('Retail + Business Email', { p_industries: ['Retail'], p_has_business_email: true }, 1000)
await test('NYC + CxO', { p_cities: ['New York'], p_seniority_levels: ['Cxo'] }, 100)
await test('Male + Income $100k+', { p_gender: ['M'], p_income: ['$100,000 to $149,999'] }, 1000)
await test('Salesforce + Business Email', { p_technologies: ['salesforce'], p_has_business_email: true }, 100)
await test('Financial Services + Director', { p_industries: ['Financial Services'], p_seniority_levels: ['Director'] }, 100)
await test('Leadership skill + Manager', { p_person_skills: ['leadership'], p_seniority_levels: ['Manager'] }, 100)
await test('US + CxO', { p_countries: ['United States'], p_seniority_levels: ['Cxo'] }, 1000)
await test('Large company + LinkedIn', { p_company_size_ranges: ['10000+'], p_has_linkedin: true }, 1000)

// === THREE-FILTER COMBINATIONS ===
console.log('\n--- Three-Filter Combinations ---')
await test('Marketing + Director + NYC', { p_job_titles: ['marketing'], p_seniority_levels: ['Director'], p_cities: ['New York'] }, 10)
await test('CEO + US + Male', { p_job_titles: ['CEO'], p_countries: ['United States'], p_gender: ['M'] }, 100)
await test('Retail + Email + LinkedIn', { p_industries: ['Retail'], p_has_business_email: true, p_has_linkedin: true }, 1000)
await test('Sales dept + Manager + Email', { p_departments: ['Sales'], p_seniority_levels: ['Manager'], p_has_business_email: true }, 100)
await test('Salesforce + CxO + Email', { p_technologies: ['salesforce'], p_seniority_levels: ['Cxo'], p_has_business_email: true }, 10)
await test('Female + Director + Finance', { p_gender: ['F'], p_seniority_levels: ['Director'], p_industries: ['Financial Services'] }, 10)
await test('NYC + Tech industry + Email', { p_cities: ['New York'], p_industries: ['Information Technology'], p_has_business_email: true }, 10)

// === FOUR+ FILTER COMBINATIONS ===
console.log('\n--- Four+ Filter Combinations ---')
await test('Biotech CEO + US + Email + LinkedIn', { p_keywords: ['biotech'], p_job_titles: ['CEO'], p_countries: ['United States'], p_has_business_email: true, p_has_linkedin: true }, 1)
await test('Marketing VP + NYC + Email + Salesforce', { p_job_titles: ['VP marketing'], p_cities: ['New York'], p_has_business_email: true, p_technologies: ['salesforce'] }, 1)
await test('Director + Finance + US + Large co + LinkedIn', { p_seniority_levels: ['Director'], p_industries: ['Financial Services'], p_countries: ['United States'], p_company_size_ranges: ['1001-5000'], p_has_linkedin: true }, 10)

// === EXCLUSION FILTERS ===
console.log('\n--- Exclusion Filters ---')
await test('CEO exclude founder', { p_job_titles: ['CEO'], p_exclude_job_titles: ['founder'] }, 100)
await test('Retail exclude banking', { p_industries: ['Retail'], p_exclude_industries: ['banking'] }, 1000)
await test('NYC exclude LA', { p_cities: ['New York'], p_exclude_cities: ['Los Angeles'] }, 1000)

// === KEYWORDS ===
console.log('\n--- Keywords ---')
await test('Keyword: biotech', { p_keywords: ['biotech'] }, 100)
await test('Keyword: AI', { p_keywords: ['AI'] }, 100)
await test('Keyword: SaaS', { p_keywords: ['SaaS'] }, 100)
await test('Multiple keywords: biotech AI', { p_keywords: ['biotech', 'AI'] }, 100)

console.log(`\n📊 Results: ${passed} passed, ${warned} warnings, ${failed} failed\n`)
