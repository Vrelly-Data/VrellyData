import pg from 'pg';

const client = new pg.Client({
  host: 'aws-1-us-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.lgnvolndyftsbcjprmic',
  password: 'VrellyData123!',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log('Connected to Supabase Postgres');

await client.query('SET statement_timeout = 0');
console.log('statement_timeout set to 0');

const progressInterval = setInterval(async () => {
  try {
    const res = await client.query(`
      SELECT phase, blocks_done, blocks_total,
             CASE WHEN blocks_total > 0
               THEN round(100.0 * blocks_done / blocks_total, 1)
               ELSE 0
             END AS pct
      FROM pg_stat_progress_create_index
      WHERE relid = 'public.prospects'::regclass
      LIMIT 1
    `);
    if (res.rows.length > 0) {
      const { phase, blocks_done, blocks_total, pct } = res.rows[0];
      console.log(`[progress] phase=${phase}  blocks=${blocks_done}/${blocks_total}  ${pct}%`);
    } else {
      console.log('[progress] waiting for index creation to appear in pg_stat_progress_create_index...');
    }
  } catch {
    // ignore progress query errors
  }
}, 30_000);

console.log('Creating index CONCURRENTLY (this may take a while)...');

try {
  await client.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_keyword_fts
    ON public.prospects
    USING gin(to_tsvector('english',
      coalesce(job_title,'') || ' ' ||
      coalesce(company_name,'') || ' ' ||
      coalesce(company_industry,'') || ' ' ||
      coalesce(company_description,'')
    ))
  `);
  console.log('Index created successfully!');
} catch (err) {
  console.error('Index creation failed:', err.message);
} finally {
  clearInterval(progressInterval);
  await client.end();
  console.log('Connection closed.');
}
