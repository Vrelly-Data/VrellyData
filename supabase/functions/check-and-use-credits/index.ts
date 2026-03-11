import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  const { credit_type, amount = 1 } = await req.json();
  // credit_type: 'export' | 'ai_generation'

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: credits, error: fetchError } = await supabaseAdmin
    .from('user_credits')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (fetchError || !credits) {
    return new Response(JSON.stringify({ error: 'No credit record found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (credits.subscription_status !== 'active') {
    return new Response(JSON.stringify({ error: 'No active subscription', code: 'NO_SUBSCRIPTION' }), {
      status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();

  if (credit_type === 'export') {
    if (credits.plan === 'enterprise') {
      // Enterprise: daily cap of 100,000
      const resetAt = new Date(credits.enterprise_daily_reset_at);
      const isNewDay = now.toDateString() !== resetAt.toDateString();

      const currentDailyCount = isNewDay ? 0 : credits.enterprise_daily_exports;

      if (currentDailyCount + amount > 100000) {
        return new Response(JSON.stringify({ error: 'Daily export limit reached (100,000)', code: 'DAILY_LIMIT' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabaseAdmin.from('user_credits').update({
        enterprise_daily_exports: currentDailyCount + amount,
        enterprise_daily_reset_at: isNewDay ? now.toISOString() : credits.enterprise_daily_reset_at,
      }).eq('user_id', user.id);

    } else {
      // Starter / Professional: monthly credits
      const remaining = credits.export_credits_total - credits.export_credits_used;
      if (remaining < amount) {
        return new Response(JSON.stringify({ error: 'Insufficient export credits', code: 'NO_CREDITS', remaining }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabaseAdmin.from('user_credits').update({
        export_credits_used: credits.export_credits_used + amount,
      }).eq('user_id', user.id);
    }
  }

  if (credit_type === 'ai_generation') {
    const remaining = credits.ai_credits_total - credits.ai_credits_used;
    if (remaining < amount) {
      return new Response(JSON.stringify({ error: 'Insufficient AI generation credits', code: 'NO_CREDITS', remaining }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabaseAdmin.from('user_credits').update({
      ai_credits_used: credits.ai_credits_used + amount,
    }).eq('user_id', user.id);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
