import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Reply.io V3 API
const WEBHOOK_API_BASE = 'https://api.reply.io/v3/webhooks';

// All events to subscribe to
const ALL_EVENT_TYPES = [
  // Email events
  'email_replied',
  'email_sent',
  'email_opened',
  'email_bounced',
  // LinkedIn events
  'linkedin_message_sent',
  'linkedin_message_replied',
  'linkedin_connection_request_sent',
  'linkedin_connection_request_accepted',
  // Lifecycle events
  'contact_finished',
  'contact_opted_out',
];

// Generate a random HMAC secret
function generateSecret(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

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
      .select('id, platform, api_key_encrypted, webhook_subscription_id, reply_team_id')
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
    
    // Delete existing webhooks if any (could be V2 style comma-separated or V3 single ID)
    if (integration.webhook_subscription_id) {
      const existingIds = integration.webhook_subscription_id.split(',');
      for (const webhookId of existingIds) {
        if (webhookId.trim()) {
          try {
            console.log('Deleting existing webhook:', webhookId.trim());
            // Try V3 deletion first
            let deleteResponse = await fetch(`${WEBHOOK_API_BASE}/${webhookId.trim()}`, {
              method: 'DELETE',
              headers: { 'X-API-Key': apiKey },
            });
            
            // If V3 fails, try V2 endpoint for old subscriptions
            if (!deleteResponse.ok) {
              deleteResponse = await fetch(`https://api.reply.io/api/v2/webhooks/${webhookId.trim()}`, {
                method: 'DELETE',
                headers: { 'X-API-Key': apiKey },
              });
            }
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
    
    // Generate HMAC secret for signature verification
    const webhookSecret = generateSecret();
    
    // V3 payload - single subscription for all events
    const payload: Record<string, unknown> = {
      targetUrl: webhookUrl,
      eventTypes: ALL_EVENT_TYPES,
      secret: webhookSecret,
    };
    
    // V3 API requires subscriptionLevel + teamIds (plural, array)
    if (integration.reply_team_id) {
      payload.subscriptionLevel = 'team';
      payload.teamIds = [parseInt(integration.reply_team_id, 10)];
    } else {
      // Default to account-level if no team specified
      payload.subscriptionLevel = 'account';
    }
    
    console.log('Creating V3 webhook subscription');
    console.log('Payload:', JSON.stringify(payload));
    
    const response = await fetch(WEBHOOK_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });
    
    const responseText = await response.text();
    console.log('Reply.io V3 response:', response.status, responseText);
    
    if (!response.ok) {
      // Parse error details
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.message || errorJson.error || responseText;
      } catch {
        // Keep raw text
      }
      
      // Update integration with error status
      await supabase
        .from('outbound_integrations')
        .update({
          webhook_status: 'error',
          webhook_subscription_id: null,
          webhook_secret: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);
      
      return new Response(JSON.stringify({ 
        error: 'Failed to create webhook subscription',
        details: errorDetails,
        status: response.status,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Parse successful response
    let webhookId: string | null = null;
    try {
      const data = JSON.parse(responseText);
      webhookId = data.id?.toString() || null;
      console.log('Successfully created V3 webhook with ID:', webhookId);
    } catch {
      console.log('Could not parse response as JSON, but request succeeded');
    }
    
    // Update integration with success status
    const { error: updateError } = await supabase
      .from('outbound_integrations')
      .update({
        webhook_subscription_id: webhookId,
        webhook_status: 'active',
        webhook_secret: webhookSecret,
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
    
    return new Response(JSON.stringify({ 
      success: true,
      webhookUrl,
      status: 'active',
      webhookId,
      eventTypes: ALL_EVENT_TYPES.length,
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
