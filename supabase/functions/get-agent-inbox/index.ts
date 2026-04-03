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

    // Build aggregate counts (used in all views)
    const { data: allLeads } = await supabase
      .from('agent_leads')
      .select('pipeline_stage, inbox_status, intent, auto_handled')
      .eq('user_id', authUserId);

    const leads = allLeads || [];
    const counts = {
      total: leads.length,
      by_stage: {
        contacted: leads.filter((l: any) => l.pipeline_stage === 'contacted').length,
        replied: leads.filter((l: any) => l.pipeline_stage === 'replied').length,
        engaged: leads.filter((l: any) => l.pipeline_stage === 'engaged').length,
        meeting_booked: leads.filter((l: any) => l.pipeline_stage === 'meeting_booked').length,
        closed: leads.filter((l: any) => l.pipeline_stage === 'closed').length,
        dead: leads.filter((l: any) => l.pipeline_stage === 'dead').length,
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
    };

    if (view === 'inbox') {
      const { data: inboxLeads, error } = await supabase
        .from('agent_leads')
        .select('*')
        .eq('user_id', authUserId)
        .in('inbox_status', ['pending', 'draft_ready'])
        .order('last_reply_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return new Response(JSON.stringify({ leads: inboxLeads, counts }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (view === 'pipeline') {
      const { data: pipelineLeads, error } = await supabase
        .from('agent_leads')
        .select('*')
        .eq('user_id', authUserId)
        .order('updated_at', { ascending: false })
        .limit(200);

      if (error) throw error;

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
