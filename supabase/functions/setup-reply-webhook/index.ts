import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate a random 32-byte hex string for webhook secret
function generateWebhookSecret(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
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
    
    // If already has a webhook, delete it first
    if (integration.webhook_subscription_id) {
      try {
        await fetch(`https://api.reply.io/v3/webhooks/${integration.webhook_subscription_id}`, {
          method: 'DELETE',
          headers: {
            'X-Api-Key': integration.api_key_encrypted,
          },
        });
      } catch (e) {
        console.log('Failed to delete existing webhook, continuing:', e);
      }
    }
    
    // Generate webhook secret
    const webhookSecret = generateWebhookSecret();
    
    // Build webhook URL
    const webhookUrl = `${supabaseUrl}/functions/v1/reply-webhook/${integrationId}`;
    
    // Register webhook with Reply.io v3 API
    const webhookPayload = {
      targetUrl: webhookUrl,
      secret: webhookSecret,
      subscriptionLevel: 'account',
      eventTypes: [
        'email_sent',
        'email_replied', 
        'email_opened',
        'email_bounced',
        'linkedin_connection_request_sent',
        'linkedin_message_sent',
        'linkedin_replied',
        'contact_status_changed',
      ],
    };
    
    console.log('Registering webhook with Reply.io v3:', webhookUrl);
    
    const response = await fetch('https://api.reply.io/v3/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': integration.api_key_encrypted,
      },
      body: JSON.stringify(webhookPayload),
    });
    
    const responseText = await response.text();
    console.log('Reply.io webhook response:', response.status, responseText);
    
    if (!response.ok) {
      // Update status to error
      await supabase
        .from('outbound_integrations')
        .update({ 
          webhook_status: 'error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);
        
      return new Response(JSON.stringify({ 
        error: 'Failed to register webhook with Reply.io',
        details: responseText,
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    let webhookData;
    try {
      webhookData = JSON.parse(responseText);
    } catch {
      webhookData = { id: 'unknown' };
    }
    
    // Update integration with webhook details
    const { error: updateError } = await supabase
      .from('outbound_integrations')
      .update({
        webhook_subscription_id: webhookData.id?.toString() || 'registered',
        webhook_secret: webhookSecret,
        webhook_status: 'active',
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
