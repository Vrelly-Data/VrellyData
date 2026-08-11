import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  fetchSmartleadThread,
  type ThreadMessage,
} from '../_shared/smartlead-thread.ts';

const allowedOrigins = ['https://vrelly.com', 'https://www.vrelly.com'];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-key',
  };
}

// ---------------------------------------------------------------------------
// Smartlead backstop poll — catches outbound Vrelly never sees.
//
// Smartlead only ever fires EMAIL_REPLY (the only type registered, and the only
// one ever received in production). A reply sent directly in Smartlead's UI —
// by a human or by Smartlead's own "Reply Agent" AI — produces no event we
// subscribe to. The webhook picks such messages up only as a side effect, by
// refetching full history on the NEXT inbound; a reply sent after the last
// inbound stays invisible indefinitely. On SourceCo that left 61 leads showing
// a prospect reply and no answer, while zero replies had ever been sent through
// Vrelly at all.
//
// Reply.io needs no equivalent: its poller walks an activity-ordered thread
// list, so externally-sent outbound is picked up within one cycle (1,434 such
// leads captured in prod). Smartlead exposes no activity-ordered list — only
// per-lead message-history — hence one HTTP call per lead, and hence the
// deliberately conservative cadence and windowing below.
//
// Cron auth via x-agent-key; manual trigger via user JWT.
// ---------------------------------------------------------------------------

// One call per lead with no bulk variant, so the run is sized, not unbounded.
// Smartlead publishes no rate limit we could verify (nothing in their API
// reference or help centre, and no 429 handling anywhere else in this repo), so
// this assumes one exists: sequential calls, a delay between them, a single
// backoff on 429, and a hard ceiling per run.
const MAX_LEADS_PER_RUN = 100;
const DELAY_MS = 200;
const ACTIVE_WINDOW_DAYS = 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    const authHeader = req.headers.get('authorization');
    const isCron = !!agentKey && !!expectedKey && agentKey === expectedKey;
    if (!isCron && !authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: integrations, error: intErr } = await supabase
      .from('outbound_integrations')
      .select('id, created_by, team_id, api_key_encrypted')
      .eq('is_active', true)
      .eq('platform', 'smartlead');
    if (intErr) return json({ error: intErr.message }, 500);

    // Mailbox -> sender-name map, so our outbound groups by SENDER rather than
    // per-mailbox (mirrors what smartlead-webhook does on the inbound path).
    const { data: mailboxes } = await supabase
      .from('email_sender_mailboxes')
      .select('mailbox_email, sender_name')
      .not('sender_name', 'is', null);
    const senderByMailbox = new Map<string, string>();
    for (const m of mailboxes ?? []) {
      const email = (m.mailbox_email as string | null)?.toLowerCase();
      const name = m.sender_name as string | null;
      if (email && name) senderByMailbox.set(email, name);
    }
    const senderNameFor = (from: string | null) =>
      from ? senderByMailbox.get(from.toLowerCase()) ?? null : null;

    const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400_000).toISOString();
    const result = { scanned: 0, refreshed: 0, unchanged: 0, flagged: 0, errors: 0, rateLimited: 0 };

    for (const integration of integrations ?? []) {
      const apiKey = integration.api_key_encrypted as string | undefined;
      if (!apiKey) continue;

      // Candidates: recently-active leads, UNION anything still awaiting action
      // regardless of age. The second half is the point of the job — a stale
      // draft on an already-answered thread is the actual harm.
      const { data: leads, error: leadsErr } = await supabase
        .from('agent_leads')
        .select('id, smartlead_campaign_id, smartlead_lead_id, reply_thread, inbox_status, notes')
        .eq('source', 'smartlead')
        .not('smartlead_campaign_id', 'is', null)
        .not('smartlead_lead_id', 'is', null)
        .or(`last_message_at.gte.${since},inbox_status.in.(pending,draft_ready)`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(MAX_LEADS_PER_RUN);
      if (leadsErr) {
        console.error('[poll-smartlead-inbox] lead query failed:', leadsErr.message);
        result.errors++;
        continue;
      }

      for (const lead of leads ?? []) {
        result.scanned++;
        try {
          let res = await fetchSmartleadThread({
            apiKey,
            campaignId: String(lead.smartlead_campaign_id),
            leadId: String(lead.smartlead_lead_id),
            localThread: lead.reply_thread as ThreadMessage[] | null,
            senderNameFor,
          });

          // Single backoff on 429 — not a cascade. Same posture as
          // poll-reply-inbox: one retry, then give up and move on.
          if (res.status === 429) {
            result.rateLimited++;
            await sleep(2000);
            res = await fetchSmartleadThread({
              apiKey,
              campaignId: String(lead.smartlead_campaign_id),
              leadId: String(lead.smartlead_lead_id),
              localThread: lead.reply_thread as ThreadMessage[] | null,
              senderNameFor,
            });
          }

          if (!res.thread) {
            if (res.status !== 200) result.errors++;
            await sleep(DELAY_MS);
            continue;
          }

          // Skip the write when nothing changed — avoids pointless updated_at
          // churn on every lead every hour. (agent_leads' no-op guard is not
          // attached in either environment, so an unconditional update really
          // would re-stamp every row.)
          const before = JSON.stringify(lead.reply_thread ?? null);
          const after = JSON.stringify(res.thread);
          if (before === after) {
            result.unchanged++;
            await sleep(DELAY_MS);
            continue;
          }

          const update: Record<string, unknown> = { reply_thread: res.thread };

          // FLAG, DO NOT AUTO-DISMISS. When the newest message is ours, the
          // prospect has already been answered outside Vrelly and any pending
          // draft is stale — but deciding the lead is finished is a human call,
          // so the status is left alone and a note is appended instead.
          const stale =
            res.endsWithOutbound &&
            (lead.inbox_status === 'pending' || lead.inbox_status === 'draft_ready');
          if (stale) {
            const marker = '[auto] Replied outside Vrelly — draft may be stale.';
            const notes = (lead.notes as string | null) ?? '';
            if (!notes.includes(marker)) {
              update.notes = notes ? `${notes}\n${marker}` : marker;
            }
            result.flagged++;
          }

          const { error: upErr } = await supabase
            .from('agent_leads')
            .update(update)
            .eq('id', lead.id);
          if (upErr) {
            console.error(`[poll-smartlead-inbox] update failed for ${lead.id}:`, upErr.message);
            result.errors++;
          } else {
            result.refreshed++;
          }
        } catch (e) {
          console.error('[poll-smartlead-inbox] lead threw:', (e as Error).message);
          result.errors++;
        }
        await sleep(DELAY_MS);
      }
    }

    console.log('[poll-smartlead-inbox]', JSON.stringify(result));
    return json({ success: true, ...result });
  } catch (e) {
    console.error('[poll-smartlead-inbox] fatal:', e);
    return json({ error: (e as Error).message }, 500);
  }
});
