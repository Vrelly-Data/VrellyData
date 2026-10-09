// Dry-run the Agent Audience dispatcher against a Supabase environment.
//
// Usage:
//   SUPABASE_URL=https://xyz.supabase.co \
//   AGENT_KEY=... \
//   node scripts/test-dispatch-agent-audiences.mjs
//
// The function answers with a JSON payload describing what would be dispatched
// without invoking any runs. No credits are spent and nobody is enrolled.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.AGENT_KEY;

if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and AGENT_KEY in your environment.');
  process.exit(1);
}

const r = await fetch(`${URL}/functions/v1/dispatch-agent-audiences`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-agent-key': KEY },
  body: JSON.stringify({ dry_run: true }),
});

const text = await r.text();
console.log('HTTP', r.status);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}

