import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const allowedOrigins = [
  Deno.env.get('ALLOWED_ORIGIN') || 'https://vrelly.com',
  'https://www.vrelly.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Security gate (2026-10-21): reject anonymous callers. Allows a valid user JWT,
  // the service role key, or the internal x-agent-key. Logic below is unchanged.
  {
    const _auth = req.headers.get('Authorization') || '';
    const _bearer = _auth.startsWith('Bearer ') ? _auth.slice(7) : '';
    const _svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const _agentKey = Deno.env.get('AGENT_API_KEY') || '';
    const _xAgent = req.headers.get('x-agent-key') || '';
    let _ok = (!!_svc && _bearer === _svc) || (!!_agentKey && _xAgent === _agentKey);
    if (!_ok && _bearer) {
      try {
        const _r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
          headers: { Authorization: `Bearer ${_bearer}`, apikey: Deno.env.get('SUPABASE_ANON_KEY') || '' },
        });
        if (_r.ok) { const _u = await _r.json(); _ok = !!_u?.id; }
      } catch (_e) { _ok = false; }
    }
    if (!_ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting monthly credit reset...');

    // Call the database function to reset credits
    const { error } = await supabase.rpc('reset_monthly_credits');

    if (error) {
      console.error('Error resetting monthly credits:', error);
      throw error;
    }

    console.log('Monthly credits reset completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Monthly credits reset completed',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in reset function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
