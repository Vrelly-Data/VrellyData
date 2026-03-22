import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://vrelly.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: jsonHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      console.error('[check-and-use-credits] Auth failed:', error?.message ?? 'no user');
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_FAILED' }), {
        status: 401, headers: jsonHeaders,
      });
    }

    const { credit_type, amount = 1 } = await req.json();
    console.log(`[check-and-use-credits] user=${user.id} type=${credit_type} amount=${amount}`);

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
      console.error(`[check-and-use-credits] No credit record for user=${user.id}`, fetchError?.message);
      return new Response(JSON.stringify({ error: 'No credit record found', code: 'NO_CREDITS_RECORD' }), {
        status: 404, headers: jsonHeaders,
      });
    }

    console.log(`[check-and-use-credits] user=${user.id} plan=${credits.plan} status=${credits.subscription_status} export_used=${credits.export_credits_used}/${credits.export_credits_total} ai_used=${credits.ai_credits_used}/${credits.ai_credits_total}`);

    if (credits.subscription_status !== 'active') {
      console.warn(`[check-and-use-credits] Inactive subscription for user=${user.id} status=${credits.subscription_status} plan=${credits.plan}`);
      return new Response(JSON.stringify({ error: 'No active subscription', code: 'NO_SUBSCRIPTION' }), {
        status: 402, headers: jsonHeaders,
      });
    }

    const now = new Date();

    if (credit_type === 'export') {
      if (credits.plan === 'enterprise') {
        // Enterprise: daily cap of 100,000
        const resetAtRaw = credits.enterprise_daily_reset_at;
        const resetAt = resetAtRaw ? new Date(resetAtRaw) : null;
        const isNewDay = !resetAt || isNaN(resetAt.getTime()) || now.toDateString() !== resetAt.toDateString();

        const currentDailyCount = isNewDay ? 0 : (credits.enterprise_daily_exports ?? 0);

        if (currentDailyCount + amount > 100000) {
          return new Response(JSON.stringify({ error: 'Daily export limit reached (100,000)', code: 'DAILY_LIMIT' }), {
            status: 429, headers: jsonHeaders,
          });
        }

        const { error: updateError } = await supabaseAdmin.from('user_credits').update({
          enterprise_daily_exports: currentDailyCount + amount,
          enterprise_daily_reset_at: isNewDay ? now.toISOString() : credits.enterprise_daily_reset_at,
        }).eq('user_id', user.id);

        if (updateError) {
          console.error(`[check-and-use-credits] Failed to update enterprise daily exports for user=${user.id}`, updateError.message);
          return new Response(JSON.stringify({ error: 'Failed to update credits', code: 'UPDATE_FAILED' }), {
            status: 500, headers: jsonHeaders,
          });
        }

      } else {
        // Starter / Professional: monthly credits
        const remaining = credits.export_credits_total - credits.export_credits_used;
        if (remaining < amount) {
          console.warn(`[check-and-use-credits] Insufficient export credits for user=${user.id} remaining=${remaining} requested=${amount}`);
          return new Response(JSON.stringify({ error: 'Insufficient export credits', code: 'NO_CREDITS', remaining }), {
            status: 402, headers: jsonHeaders,
          });
        }

        const { error: updateError } = await supabaseAdmin.from('user_credits').update({
          export_credits_used: credits.export_credits_used + amount,
        }).eq('user_id', user.id);

        if (updateError) {
          console.error(`[check-and-use-credits] Failed to update export credits for user=${user.id}`, updateError.message);
          return new Response(JSON.stringify({ error: 'Failed to update credits', code: 'UPDATE_FAILED' }), {
            status: 500, headers: jsonHeaders,
          });
        }
      }
    }

    if (credit_type === 'ai_generation') {
      const remaining = credits.ai_credits_total - credits.ai_credits_used;
      if (remaining < amount) {
        console.warn(`[check-and-use-credits] Insufficient AI credits for user=${user.id} remaining=${remaining} requested=${amount}`);
        return new Response(JSON.stringify({ error: 'Insufficient AI generation credits', code: 'NO_CREDITS', remaining }), {
          status: 402, headers: jsonHeaders,
        });
      }

      const { error: updateError } = await supabaseAdmin.from('user_credits').update({
        ai_credits_used: credits.ai_credits_used + amount,
      }).eq('user_id', user.id);

      if (updateError) {
        console.error(`[check-and-use-credits] Failed to update AI credits for user=${user.id}`, updateError.message);
        return new Response(JSON.stringify({ error: 'Failed to update credits', code: 'UPDATE_FAILED' }), {
          status: 500, headers: jsonHeaders,
        });
      }
    }

    console.log(`[check-and-use-credits] Success: user=${user.id} type=${credit_type} amount=${amount}`);
    return new Response(JSON.stringify({ success: true }), {
      headers: jsonHeaders,
    });

  } catch (err) {
    console.error('[check-and-use-credits] Unhandled error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error', code: 'INTERNAL_ERROR' }), {
      status: 500, headers: jsonHeaders,
    });
  }
});
