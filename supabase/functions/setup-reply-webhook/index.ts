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

// Reply.io V2 API
const WEBHOOK_API_BASE = 'https://api.reply.io/api/v2/webhooks';

// Events to subscribe to (one API call each)
const ALL_EVENT_TYPES = [
  'email_replied',
  'linkedin_message_replied',
  'email_bounced',
  'contact_opted_out',
  'contact_finished',
];

// Safe key fingerprint for logging (last 4 chars only)
function keyFingerprint(key: string): string {
  if (!key || key.length < 4) return '****';
  return `****${key.slice(-4)}`;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { integrationId } = await req.json();

    if (!integrationId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing integrationId'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch integration details
    const { data: integration, error: integrationError } = await supabase
      .from('outbound_integrations')
      .select('id, platform, api_key_encrypted, webhook_subscription_id, reply_team_id')
      .eq('id', integrationId)
      .single();

    if (integrationError || !integration) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Integration not found'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (integration.platform.toLowerCase() !== 'reply.io') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Webhooks only supported for Reply.io'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize and validate API key
    const apiKey = (integration.api_key_encrypted ?? '').trim();

    if (!apiKey) {
      await supabase
        .from('outbound_integrations')
        .update({
          webhook_status: 'error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);

      return new Response(JSON.stringify({
        success: false,
        error: 'API key is empty or missing. Please update your integration with a valid Reply.io API key.',
        keyFingerprint: 'empty'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('API key fingerprint:', keyFingerprint(apiKey));

    // Step 1: Delete existing webhooks that point to our endpoint
    console.log('Fetching existing webhooks to clean up duplicates...');
    try {
      const listResponse = await fetch(WEBHOOK_API_BASE, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      });

      if (listResponse.ok) {
        const existingWebhooks = await listResponse.json();
        const webhooksArray = Array.isArray(existingWebhooks) ? existingWebhooks : [];

        for (const wh of webhooksArray) {
          if (wh.url && wh.url.includes('reply-webhook') && wh.id) {
            console.log('Deleting existing webhook:', wh.id, wh.url);
            try {
              const delRes = await fetch(`${WEBHOOK_API_BASE}/${wh.id}`, {
                method: 'DELETE',
                headers: { 'x-api-key': apiKey },
              });
              console.log('Delete response status:', delRes.status);
            } catch (e) {
              console.log('Failed to delete webhook, continuing:', e);
            }
          }
        }
      } else {
        console.log('Could not list existing webhooks, status:', listResponse.status);
      }
    } catch (e) {
      console.log('Failed to list existing webhooks, continuing:', e);
    }

    // Step 2: Register one webhook per event type
    const webhookUrl = `${supabaseUrl}/functions/v1/reply-webhook`;
    console.log('Webhook URL:', webhookUrl);

    const createdIds: string[] = [];
    const errors: string[] = [];

    for (const eventType of ALL_EVENT_TYPES) {
      console.log(`Registering webhook for event: ${eventType}`);

      const response = await fetch(WEBHOOK_API_BASE, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: eventType,
          url: webhookUrl,
          payload: {
            includeEmailUrl: false,
            includeEmailText: true,
            includeProspectCustomFields: true,
          },
        }),
      });

      const responseText = await response.text();
      console.log(`V2 response for ${eventType}:`, response.status, responseText.slice(0, 300));

      if (response.ok || response.status === 201) {
        try {
          const data = JSON.parse(responseText);
          if (data.id) {
            createdIds.push(data.id.toString());
          }
        } catch {
          console.log('Could not parse response as JSON for', eventType);
        }
      } else {
        errors.push(`${eventType}: status ${response.status} - ${responseText.slice(0, 200)}`);
      }
    }

    // If no webhooks were created, report failure
    if (createdIds.length === 0) {
      await supabase
        .from('outbound_integrations')
        .update({
          webhook_status: 'error',
          webhook_subscription_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);

      return new Response(JSON.stringify({
        success: false,
        error: `Failed to create any webhook subscriptions. Errors: ${errors.join('; ')}`,
        keyFingerprint: keyFingerprint(apiKey)
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Store webhook IDs and update status
    const { error: updateError } = await supabase
      .from('outbound_integrations')
      .update({
        webhook_subscription_id: createdIds.join(','),
        webhook_status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', integrationId);

    if (updateError) {
      console.error('Failed to update integration:', updateError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Webhooks created but failed to save config. Please try again.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      webhookUrl,
      status: 'active',
      webhookIds: createdIds,
      eventTypes: createdIds.length,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0
        ? `Webhook configured with ${createdIds.length}/${ALL_EVENT_TYPES.length} events (some failed)`
        : 'Webhook configured successfully'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Setup webhook error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
