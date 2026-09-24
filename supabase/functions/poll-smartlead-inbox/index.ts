import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  fetchSmartleadThread,
  loadSenderNameLookup,
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
// 200ms. Raising this to 400ms made rate limiting SEVEN TIMES WORSE
// (429s went 3 -> 21 of 98, refreshed 95 -> 79), which rules out per-request
// spacing as the constraint: Smartlead is enforcing a longer rolling window,
// and the slower run simply overlapped more of the previous run's budget.
// Total recent volume is what matters, so the mitigation is the hourly cadence
// and the per-run cap, not the gap between calls. ~3 stragglers per run is
// acceptable — they refresh on the next pass.
const DELAY_MS = 200;
const ACTIVE_WINDOW_DAYS = 7;
const MAX_NEW_LEADS_PER_RUN = 60; // backfill cap per integration

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Order-independent fingerprint of a thread, for change detection only.
// Keys are read explicitly so jsonb's key reordering cannot make two identical
// threads compare unequal.
function canonical(thread: ThreadMessage[] | null | undefined): string {
  if (!Array.isArray(thread)) return '';
  return thread
    .map((m) =>
      [m?.role ?? '', m?.timestamp ?? '', m?.fromName ?? '', m?.content ?? ''].join('\u0001'),
    )
    .join('\u0002');
}

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

    const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400_000).toISOString();
    // `empty` is its own counter on purpose. The first prod run reported
    // scanned=98 with every other counter at 0 and success:true, because a
    // 200-with-no-usable-body fell through as neither refresh nor error. That
    // silence is what hid a response-shape mismatch for the length of an
    // investigation — an empty result must be countable.
    const result = { scanned: 0, refreshed: 0, unchanged: 0, flagged: 0, empty: 0, errors: 0, rateLimited: 0, webhooksEnsured: 0, newLeads: 0 };

    for (const integration of integrations ?? []) {
      const apiKey = integration.api_key_encrypted as string | undefined;
      if (!apiKey) continue;

      // User-scoped, per integration. The first version loaded ONE global map
      // for all tenants — email_sender_mailboxes is not unique on
      // mailbox_email, so that could attribute one client's outbound to another
      // client's sender. Shared with smartlead-webhook so both scope alike.
      const senderNameFor = await loadSenderNameLookup(supabase, integration.created_by);

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
            else result.empty++;
            await sleep(DELAY_MS);
            continue;
          }

          // Skip the write when nothing changed — avoids pointless updated_at
          // churn on every lead every hour. (agent_leads' no-op guard is not
          // attached in either environment, so an unconditional update really
          // would re-stamp every row.)
          //
          // Compared FIELD BY FIELD, not via JSON.stringify of the raw values.
          // Postgres returns jsonb with keys reordered (by length, then
          // bytewise) while this code builds them in declaration order, so
          // stringifying both never matched and this skip never once fired —
          // every run rewrote all ~98 leads. Observed as unchanged:0 on a re-run
          // that should have been almost entirely unchanged.
          const before = canonical(lead.reply_thread as ThreadMessage[] | null);
          const after = canonical(res.thread);
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

      // ── Safety net A: re-ensure webhooks for all capture-enabled campaigns ──
      try {
        const { data: enabledCampaigns } = await supabase
          .from('synced_campaigns')
          .select('external_campaign_id')
          .eq('source', 'smartlead')
          .eq('capture_enabled', true)
          .eq('team_id', integration.team_id);
        const ids = (enabledCampaigns ?? []).map((r) => String((r as { external_campaign_id: string }).external_campaign_id)).filter(Boolean);
        if (ids.length > 0) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const agentApiKey = Deno.env.get('AGENT_API_KEY') || '';
          const res = await fetch(`${supabaseUrl}/functions/v1/setup-smartlead-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-agent-key': agentApiKey },
            body: JSON.stringify({ integrationId: integration.id, campaignIds: ids }),
          });
          if (res.ok) result.webhooksEnsured += ids.length;
          else {
            console.warn('[poll-smartlead-inbox] ensure-webhooks call failed:', await res.text().catch(() => String(res.status)));
          }
        }
      } catch (e) {
        console.warn('[poll-smartlead-inbox] ensure-webhooks threw (non-fatal):', e instanceof Error ? e.message : String(e));
      }

      // ── Safety net B: detect replies for leads not yet in agent_leads ───────
      try {
        // 1) Build a set of existing Smartlead emails for this user (dedupe target)
        const { data: existing } = await supabase
          .from('agent_leads')
          .select('email_address')
          .eq('source', 'smartlead')
          .eq('channel', 'email')
          .eq('user_id', integration.created_by);
        const have = new Set<string>((existing ?? []).map((r) => String((r as { email_address: string | null }).email_address ?? '').trim().toLowerCase())).add('');

        // 2) Load capture-enabled campaigns with names (for last_campaign_name)
        const { data: enabledNamed } = await supabase
          .from('synced_campaigns')
          .select('external_campaign_id, name')
          .eq('source', 'smartlead')
          .eq('capture_enabled', true)
          .eq('team_id', integration.team_id);
        const byId = new Map<string, { name: string }>();
        for (const r of enabledNamed ?? []) {
          const id = String((r as { external_campaign_id: string }).external_campaign_id);
          const name = String((r as { name: string | null }).name ?? '') || `Campaign ${id}`;
          byId.set(id, { name });
        }

        // 3) Iterate campaigns, page Smartlead leads, and backfill only when a reply exists and not in agent_leads
        const SMARTLEAD_API_BASE = 'https://server.smartlead.ai/api/v1';
        const smartleadGet = async (path: string): Promise<Response> => {
          const url = new URL(`${SMARTLEAD_API_BASE}${path}`);
          url.searchParams.set('api_key', apiKey!);
          return fetch(url.toString(), { headers: { Accept: 'application/json' } });
        };

        let created = 0;
        outer: for (const [campaignId, meta] of byId.entries()) {
          // page through leads
          let offset = 0;
          const limit = 100;
          for (;;) {
            const res = await smartleadGet(`/campaigns/${encodeURIComponent(campaignId)}/leads?limit=${limit}&offset=${offset}`);
            if (!res.ok) {
              console.warn(`[poll-smartlead-inbox] leads list ${res.status} for campaign ${campaignId}`);
              break;
            }
            const body = await res.json().catch(() => ({} as any));
            const rows: Array<{ campaign_lead_map_id?: string|number; lead?: { id?: string|number; email?: string|null } }> =
              Array.isArray(body?.data) ? body.data : [];
            if (rows.length === 0) break;

            for (const row of rows) {
              const leadId = row?.lead?.id != null ? String(row.lead.id) : null;
              const email = (row?.lead?.email ?? '').trim().toLowerCase();
              if (!leadId || !email || have.has(email)) continue;

              // Fetch canonical thread and check for any prospect message
              let hist = await fetchSmartleadThread({
                apiKey,
                campaignId,
                leadId,
                localThread: null,
                senderNameFor,
              });
              if (hist.status === 429) {
                await sleep(1500);
                hist = await fetchSmartleadThread({
                  apiKey,
                  campaignId,
                  leadId,
                  localThread: null,
                  senderNameFor,
                });
              }
              const thread = hist.thread ?? [];
              const hasProspect = Array.isArray(thread) && thread.some((m) => m?.role === 'prospect' && (m?.content ?? '').trim().length > 0);
              if (!hasProspect) {
                await sleep(50);
                continue;
              }
              // Derive last prospect message
              let lastProspectText = '';
              let lastProspectAt = hist.latestProspectTimestamp ?? null;
              for (let i = thread.length - 1; i >= 0; i--) {
                if (thread[i]?.role === 'prospect') {
                  lastProspectText = (thread[i]?.content ?? '').trim();
                  if (!lastProspectAt) lastProspectAt = thread[i]?.timestamp ?? null;
                  break;
                }
              }
              // Build upsert row (minimal — same shape webhook seeds, no classify here)
              const leadRow: Record<string, unknown> = {
                user_id: integration.created_by,
                external_id: email, // natural id for email channel
                email,
                email_address: email,
                channel: 'email',
                source: 'smartlead',
                smartlead_lead_id: leadId,
                smartlead_campaign_id: campaignId,
                smartlead_email_stats_id: hist.latestProspectStatsId ?? null,
                last_campaign_name: meta.name,
                reply_message_id: hist.latestProspectMessageId ?? null,
                last_reply_text: lastProspectText,
                last_reply_at: lastProspectAt ?? new Date().toISOString(),
                reply_thread: thread as ThreadMessage[],
                inbox_status: 'pending',
              };
              const { data: up, error: upErr } = await (supabase as any)
                .from('agent_leads')
                .upsert(leadRow, { onConflict: 'user_id,email_address' })
                .select('id')
                .single();
              if (upErr) {
                console.warn('[poll-smartlead-inbox] upsert new lead failed (non-fatal):', upErr.message || upErr);
              } else {
                created++;
                have.add(email);
              }
              if (created >= MAX_NEW_LEADS_PER_RUN) break outer;
              await sleep(100);
            }

            offset += rows.length;
            if (rows.length < limit) break;
            await sleep(150);
          }
        }
        result.newLeads += created;
      } catch (e) {
        console.warn('[poll-smartlead-inbox] unknown-lead sweep threw (non-fatal):', e instanceof Error ? e.message : String(e));
      }
    }

    console.log('[poll-smartlead-inbox]', JSON.stringify(result));
    return json({ success: true, ...result });
  } catch (e) {
    console.error('[poll-smartlead-inbox] fatal:', e);
    return json({ error: (e as Error).message }, 500);
  }
});
