// Controlled A/B on the SAME deployed classify-reply (v50), isolating exactly
// one variable: whether the outbound that preceded the prospect's first reply
// is available.
//
//   ARM A "old behaviour"  — thread_history sliced from the first prospect
//                            message onward. This is byte-for-byte what the
//                            model received before the fix, because the old
//                            code discarded everything before that index.
//   ARM B "new behaviour"  — the full thread, so the leading outbound reaches
//                            the system prompt.
//
// lead_id omitted in both arms → no write-back to the lead.
import fs from 'node:fs';
const PROJECT = 'https://lgnvolndyftsbcjprmic.supabase.co';
const AK = fs.readFileSync(process.env.AK_FILE, 'utf8').trim();
const fx = JSON.parse(fs.readFileSync(process.env.FIXTURE_FILE, 'utf8'))[0];

const thread = fx.reply_thread ?? [];
const fp = thread.findIndex((m) => m.role === 'prospect');
const arms = {
  'A (old: leading outbound discarded)': fp >= 0 ? thread.slice(fp) : [],
  'B (new: leading outbound preserved)': thread,
};

console.log(`Lead: ${fx.full_name} — ${thread.length} msgs, first prospect at ${fp}`);
console.log(`Reply: ${JSON.stringify(String(fx.last_reply_text).replace(/\s+/g, ' '))}`);
console.log(`\nThe outbound the old code threw away (${fp} msgs):`);
for (let i = 0; i < fp; i++) {
  console.log(`  [${i}] ${JSON.stringify(String(thread[i].content).replace(/\s+/g, ' ').slice(0, 190))}`);
}

for (const [label, th] of Object.entries(arms)) {
  const res = await fetch(`${PROJECT}/functions/v1/classify-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AK },
    body: JSON.stringify({
      reply_text: fx.last_reply_text, thread_history: th,
      channel: fx.channel, user_id: fx.user_id, agent_context: fx.agent_context,
    }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`\n================ ARM ${label} ================`);
  console.log(`intent=${j.intent} conf=${j.intent_confidence} is_objection=${j.is_objection}`);
  console.log(`angle : ${j.prospect_read?.suggested_angle}`);
  console.log(`DRAFT :\n  ${String(j.suggested_response).replace(/\n/g, '\n  ')}`);
}
