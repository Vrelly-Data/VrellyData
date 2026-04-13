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

const INTENT_STAGE_MAP: Record<string, string> = {
  interested: 'engaged',
  needs_more_info: 'engaged',
  out_of_office: 'replied',
  not_interested: 'dead',
  meeting_booked: 'meeting_booked',
};

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

    // Verify JWT
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { leadId, draftResponse, intent } = await req.json();

    if (!leadId || !draftResponse || !intent) {
      return new Response(JSON.stringify({ error: 'Missing required fields: leadId, draftResponse, intent' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch the lead
    const { data: lead, error: leadError } = await supabase
      .from('agent_leads')
      .select('*')
      .eq('id', leadId)
      .eq('user_id', userId)
      .single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch agent config
    const { data: agentConfig, error: configError } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (configError || !agentConfig) {
      return new Response(JSON.stringify({ error: 'No active agent config found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Fetch Reply.io integration
    const { data: integration, error: intError } = await supabase
      .from('outbound_integrations')
      .select('api_key_encrypted, reply_team_id')
      .eq('created_by', userId)
      .eq('platform', 'reply.io')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (intError || !integration) {
      return new Response(JSON.stringify({ error: 'Reply.io integration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = integration.api_key_encrypted;

    // 4. Get campaign_id from campaign_rules
    const campaignRules = agentConfig.campaign_rules || {};
    const campaignId = campaignRules[intent];

    if (campaignId === 'dead') {
      await supabase
        .from('agent_leads')
        .update({ pipeline_stage: 'dead', inbox_status: 'sent', draft_approved: true })
        .eq('id', leadId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (campaignId === 'remove') {
      await supabase
        .from('agent_leads')
        .update({ pipeline_stage: 'meeting_booked', inbox_status: 'sent', draft_approved: true })
        .eq('id', leadId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!campaignId) {
      return new Response(JSON.stringify({ error: 'No campaign mapped for this intent' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Create/update contact in Reply.io
    const nameParts = (lead.full_name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const contactRes = await fetch('https://api.reply.io/v1/people', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: lead.email,
        firstName,
        lastName,
        customFields: [
          { key: 'message', value: draftResponse },
        ],
      }),
    });

    // 201 = created, 400 = contact already exists — both are OK
    if (!contactRes.ok && contactRes.status !== 400) {
      const errBody = await contactRes.text();
      console.error('[send-agent-reply] Failed to create contact:', errBody);
      return new Response(JSON.stringify({ error: `Reply.io contact creation failed: ${contactRes.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Push contact to campaign
    const pushRes = await fetch('https://api.reply.io/v1/actions/pushtocampaign', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaignId: parseInt(campaignId, 10),
        email: lead.email,
        forcePush: false,
      }),
    });

    if (!pushRes.ok) {
      const errBody = await pushRes.text();
      console.error('[send-agent-reply] Failed to push to campaign:', errBody);
      return new Response(JSON.stringify({ error: `Reply.io push to campaign failed: ${pushRes.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Update lead
    const pipelineStage = INTENT_STAGE_MAP[intent] || lead.pipeline_stage;

    await supabase
      .from('agent_leads')
      .update({
        inbox_status: 'sent',
        pipeline_stage: pipelineStage,
        draft_approved: true,
      })
      .eq('id', leadId);

    // 8. Insert activity
    await supabase.from('agent_activity').insert({
      user_id: userId,
      agent_config_id: agentConfig.id,
      lead_id: leadId,
      lead_name: lead.full_name,
      lead_company: lead.company,
      activity_type: 'message_sent',
      description: `Reply sent to ${lead.full_name} via Reply.io campaign`,
      metadata: { intent, campaignId, channel: lead.channel },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[send-agent-reply] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
