import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = [
  Deno.env.get('ALLOWED_ORIGIN') || 'https://vrelly.com',
  'https://www.vrelly.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  };
}

// Fetch ALL of a user's agent_leads, paginating past PostgREST's 1000-row
// default so the Pipeline board + counts cover the client's full volume (not a
// capped subset). Bounded by MAX_PAGES as a runaway safeguard.
const MAX_PAGES = 25; // 25 * 1000 = 25k leads
// deno-lint-ignore no-explicit-any
async function fetchAllLeads(
  supabase: any,
  userId: string,
  select: string,
  order?: { col: string; asc: boolean },
): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase.from('agent_leads').select(select).eq('user_id', userId);
    if (order) q = q.order(order.col, { ascending: order.asc });
    const { data, error } = await q.range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify JWT token
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      console.error('[get-agent-inbox] Auth failed:', authError?.message ?? 'no user');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authUserId = user.id;

    // Use service role for data queries
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json().catch(() => ({}));
    const view = body.view || 'inbox';

    // Inbox tab filter. 'pending_approval' = awaiting human action;
    // 'total_inbox' = action already taken (sent/replied/dismissed).
    const PENDING_APPROVAL_STATUSES = ['pending', 'draft_ready'];
    const TOTAL_INBOX_STATUSES = ['sent', 'replied', 'dismissed'];
    const statusGroup: string = body.statusGroup ?? 'pending_approval';

    // Build aggregate counts (used in all views). Paginated so per-stage
    // totals are EXACT for clients over 1000 leads — these drive both the stat
    // tiles and (via by_pipeline_category) the board column totals.
    const leads = await fetchAllLeads(
      supabase,
      authUserId,
      'pipeline_stage, inbox_status, intent, auto_handled',
    );
    const counts = {
      total: leads.length,
      // The 8 canonical deal stages.
      by_stage: {
        replied: leads.filter((l: any) => l.pipeline_stage === 'replied').length,
        in_progress: leads.filter((l: any) => l.pipeline_stage === 'in_progress').length,
        sent_proposal: leads.filter((l: any) => l.pipeline_stage === 'sent_proposal').length,
        call_scheduled: leads.filter((l: any) => l.pipeline_stage === 'call_scheduled').length,
        no_show: leads.filter((l: any) => l.pipeline_stage === 'no_show').length,
        closed_won: leads.filter((l: any) => l.pipeline_stage === 'closed_won').length,
        closed_lost: leads.filter((l: any) => l.pipeline_stage === 'closed_lost').length,
      },
      needs_attention: leads.filter((l: any) =>
        l.inbox_status === 'pending' || l.inbox_status === 'draft_ready'
      ).length,
      auto_handled: leads.filter((l: any) => l.auto_handled === true).length,
      by_intent: {
        interested: leads.filter((l: any) => l.intent === 'interested').length,
        not_interested: leads.filter((l: any) => l.intent === 'not_interested').length,
        needs_more_info: leads.filter((l: any) => l.intent === 'needs_more_info').length,
        out_of_office: leads.filter((l: any) => l.intent === 'out_of_office').length,
        unknown: leads.filter((l: any) => l.intent === 'unknown' || !l.intent).length,
      },
      by_status_group: {
        pending_approval: leads.filter((l: any) =>
          PENDING_APPROVAL_STATUSES.includes(l.inbox_status),
        ).length,
        total_inbox: leads.filter((l: any) =>
          TOTAL_INBOX_STATUSES.includes(l.inbox_status),
        ).length,
      },
      // Pipeline columns — the 8 canonical stages, mirroring the board (tags
      // == stages). Keyed 1:1 on pipeline_stage.
      by_pipeline_category: {
        replied: leads.filter((l: any) => l.pipeline_stage === 'replied').length,
        in_progress: leads.filter((l: any) => l.pipeline_stage === 'in_progress').length,
        sent_proposal: leads.filter((l: any) => l.pipeline_stage === 'sent_proposal').length,
        call_scheduled: leads.filter((l: any) => l.pipeline_stage === 'call_scheduled').length,
        no_show: leads.filter((l: any) => l.pipeline_stage === 'no_show').length,
        closed_won: leads.filter((l: any) => l.pipeline_stage === 'closed_won').length,
        closed_lost: leads.filter((l: any) => l.pipeline_stage === 'closed_lost').length,
      },
    };

    if (view === 'inbox') {
      const statusList =
        statusGroup === 'total_inbox' ? TOTAL_INBOX_STATUSES : PENDING_APPROVAL_STATUSES;

      // Deterministic newest-first ordering. The PRIMARY key differs by tab:
      //   total_inbox      → last_message_at: MAX over reply_thread[] excluding
      //                      role:'system', floored by last_reply_at/created_at,
      //                      maintained by the zz_agent_leads_set_last_message_at
      //                      trigger. This is the newest message in EITHER
      //                      direction — every send path appends to reply_thread,
      //                      so our own sends and prospect replies both count.
      //
      //                      Was updated_at (0313fef), on the assumption that a
      //                      Send Reply bumps it while last_reply_at stays put.
      //                      True, but updated_at is a ROW-TOUCH stamp: the
      //                      */15 poll-reply-inbox cron writes it explicitly
      //                      (index.ts:461), re-stamping every thread it walks
      //                      whether or not anything changed — and nothing
      //                      suppresses that, since agent_leads_skip_noop is
      //                      NOT attached on dev or prod despite the repo's
      //                      migrations. Ordering tracked poll batches, not
      //                      conversations — 18/50 rows correctly placed on
      //                      Avania, median 23.9h skew.
      //   pending_approval → last_reply_at first. Actionability is driven by the
      //                      prospect's latest reply, so keep it prospect-driven.
      // Remaining keys: the other timestamp, then created_at (floor for freshly-
      // imported leads), then id (final tie-breaker so identical-timestamp rows
      // don't flip order on each 30s refetch). nullsFirst: false keeps
      // null-timestamp rows off the top of DESC order.
      const primarySort = statusGroup === 'total_inbox' ? 'last_message_at' : 'last_reply_at';
      const secondarySort = statusGroup === 'total_inbox' ? 'last_reply_at' : 'last_message_at';

      // Paging. Was a hard .limit(50) since the original Phase 2 commit
      // (676b48c): the tab badge reported the FULL group total while the list
      // rendered 50, so the remainder was unreachable — 241 of Avania's 291
      // Total Inbox leads at the time of writing. The badge was right; the list
      // was the lie.
      //
      // MAX_PAGE is a real ceiling, not a silent one: hasMore is reported
      // independently of it, so a caller that has hit the cap can still tell
      // there is more behind it and say so. Sized against live data — the
      // largest total_inbox group across all prod tenants is 291 (Avania), so
      // 500 clears every client today with headroom. A group that ever exceeds
      // it needs real offset paging in the UI, which `offset` below already
      // supports server-side.
      const MAX_PAGE = 500;
      const limit = Math.min(
        Math.max(parseInt(String(body.limit ?? 50), 10) || 50, 1),
        MAX_PAGE,
      );
      const offset = Math.max(parseInt(String(body.offset ?? 0), 10) || 0, 0);

      const { data: inboxLeads, error } = await supabase
        .from('agent_leads')
        .select('*')
        .eq('user_id', authUserId)
        .in('inbox_status', statusList)
        .order(primarySort, { ascending: false, nullsFirst: false })
        .order(secondarySort, { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Reuses the exact totals the tab badges already render, so "Load more"
      // and the badge can never disagree — they are the same number.
      const groupTotal =
        statusGroup === 'total_inbox'
          ? counts.by_status_group.total_inbox
          : counts.by_status_group.pending_approval;
      const hasMore = offset + (inboxLeads?.length ?? 0) < groupTotal;

      return new Response(
        JSON.stringify({ leads: inboxLeads, counts, hasMore, total: groupTotal }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (view === 'pipeline') {
      // ALL leads (paginated, was capped at 200) so every column populates and
      // its count reflects the true stage total. Cards render lazily via the
      // board's per-column "Show more".
      const pipelineLeads = await fetchAllLeads(supabase, authUserId, '*', {
        col: 'updated_at',
        asc: false,
      });

      return new Response(JSON.stringify({ leads: pipelineLeads, counts }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (view === 'activity') {
      const type = body.type || null;
      const from = body.from || null;
      const to = body.to || null;
      const search = body.search || null;
      const limit = Math.min(parseInt(body.limit || '100', 10), 500);

      let query = supabase
        .from('agent_activity')
        .select('*')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (type) {
        query = query.eq('activity_type', type);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }
      if (search) {
        query = query.or(
          `lead_name.ilike.%${search}%,lead_company.ilike.%${search}%,description.ilike.%${search}%`
        );
      }

      const { data: activities, error } = await query;

      if (error) throw error;

      return new Response(JSON.stringify({ leads: activities, counts }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid view parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('get-agent-inbox error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
