import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Reply.io v2 API base - note the /api/ segment!
const WEBHOOK_API_BASE = 'https://api.reply.io/api/v2/webhooks';

// Minimal events to start with (can expand later)
const EVENTS_TO_SUBSCRIBE = [
  'email_replied',
  'email_sent',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { integrationId } = await req.json();
    
    if (!integrationId) {
      return new Response(JSON.stringify({ error: 'Missing integrationId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch integration details
    const { data: integration, error: integrationError } = await supabase
      .from('outbound_integrations')
      .select('id, platform, api_key_encrypted, webhook_subscription_id')
      .eq('id', integrationId)
      .single();
    
    if (integrationError || !integration) {
      return new Response(JSON.stringify({ error: 'Integration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (integration.platform.toLowerCase() !== 'reply.io') {
      return new Response(JSON.stringify({ error: 'Webhooks only supported for Reply.io' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = integration.api_key_encrypted;
    
    // Delete existing webhooks if any (comma-separated IDs)
    if (integration.webhook_subscription_id) {
      const existingIds = integration.webhook_subscription_id.split(',');
      for (const webhookId of existingIds) {
        if (webhookId.trim()) {
          try {
            console.log('Deleting existing webhook:', webhookId);
            const deleteResponse = await fetch(`${WEBHOOK_API_BASE}/${webhookId.trim()}`, {
              method: 'DELETE',
              headers: { 'X-Api-Key': apiKey },
            });
            console.log('Delete response status:', deleteResponse.status);
          } catch (e) {
            console.log('Failed to delete webhook, continuing:', e);
          }
        }
      }
    }
    
    // Build webhook URL
    const webhookUrl = `${supabaseUrl}/functions/v1/reply-webhook/${integrationId}`;
    console.log('Webhook URL:', webhookUrl);
    
    // Create one subscription per event (v2 API requirement)
    const webhookIds: string[] = [];
    const errors: string[] = [];
    
    for (const event of EVENTS_TO_SUBSCRIBE) {
      const payload = {
        event,
        url: webhookUrl,
      };
      
      console.log(`Creating webhook for event: ${event}`);
      console.log('Payload:', JSON.stringify(payload));
      
      const response = await fetch(WEBHOOK_API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(payload),
      });
      
      const responseText = await response.text();
      console.log(`Reply.io response for ${event}:`, response.status, responseText);
      
      if (response.ok) {
        try {
          const data = JSON.parse(responseText);
          if (data.id) {
            webhookIds.push(data.id.toString());
            console.log(`Successfully created webhook ${data.id} for ${event}`);
          }
        } catch {
          console.log('Could not parse response as JSON');
        }
      } else {
        errors.push(`${event}: ${response.status} - ${responseText}`);
      }
    }
    
    // Update integration with results
    const webhookStatus = webhookIds.length > 0 ? 'active' : 'error';
    const { error: updateError } = await supabase
      .from('outbound_integrations')
      .update({
        webhook_subscription_id: webhookIds.join(',') || null,
        webhook_status: webhookStatus,
        webhook_secret: null, // v2 doesn't support HMAC
        updated_at: new Date().toISOString(),
      })
      .eq('id', integrationId);
    
    if (updateError) {
      console.error('Failed to update integration:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to save webhook config' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (webhookIds.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Failed to create any webhooks',
        details: errors.join('; '),
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      webhookUrl,
      status: 'active',
      subscriptionsCreated: webhookIds.length,
      webhookIds,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Setup webhook error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
