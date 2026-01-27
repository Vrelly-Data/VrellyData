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

// Discover account ID from Reply.io API (fallback when no team_id)
async function discoverAccountId(apiKey: string): Promise<number | null> {
  // Try /v1/people endpoint (known to work)
  try {
    console.log('Trying /v1/people endpoint for account discovery...');
    const response = await fetch('https://api.reply.io/v1/people?limit=1', {
      headers: { 'X-Api-Key': apiKey }
    });
    console.log('People endpoint status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('People response sample:', JSON.stringify(data).slice(0, 500));
      // Look for accountId in the response
      if (Array.isArray(data) && data.length > 0 && data[0].accountId) {
        return data[0].accountId;
      }
    }
  } catch (e) {
    console.log('People endpoint failed:', e);
  }

  // Try /v1/emailAccounts endpoint
  try {
    console.log('Trying /v1/emailAccounts endpoint...');
    const response = await fetch('https://api.reply.io/v1/emailAccounts', {
      headers: { 'X-Api-Key': apiKey }
    });
    console.log('EmailAccounts endpoint status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('EmailAccounts response sample:', JSON.stringify(data).slice(0, 500));
      if (Array.isArray(data) && data.length > 0) {
        const firstAccount = data[0];
        if (firstAccount.accountId) return firstAccount.accountId;
        if (firstAccount.userId) return firstAccount.userId;
      }
    }
  } catch (e) {
    console.log('EmailAccounts endpoint failed:', e);
  }
  
  return null;
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
    
    // Fetch integration details including reply_team_id
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
    
    // If already has a webhook, delete it first using v3 API
    if (integration.webhook_subscription_id) {
      try {
        console.log('Deleting existing webhook:', integration.webhook_subscription_id);
        const deleteResponse = await fetch(`https://api.reply.io/v3/webhooks/${integration.webhook_subscription_id}`, {
          method: 'DELETE',
          headers: {
            'X-Api-Key': integration.api_key_encrypted,
          },
        });
        console.log('Delete webhook response:', deleteResponse.status);
      } catch (e) {
        console.log('Failed to delete existing webhook, continuing:', e);
      }
    }
    
    // Generate webhook secret for HMAC verification
    const webhookSecret = generateWebhookSecret();
    
    // Build webhook URL
    const webhookUrl = `${supabaseUrl}/functions/v1/reply-webhook/${integrationId}`;
    
    // Build v3 webhook payload
    const webhookPayload: Record<string, unknown> = {
      targetUrl: webhookUrl,
      eventTypes: [
        // Email events
        'email_sent',
        'email_replied', 
        'email_opened',
        'email_bounced',
        // LinkedIn events
        'linkedin_connection_request_sent',
        'linkedin_connection_request_accepted',
        'linkedin_message_sent',
        'linkedin_message_replied',
        // Contact lifecycle events
        'contact_finished',
        'contact_opted_out',
      ],
      secret: webhookSecret,
    };
    
    // Check if we have a reply_team_id for team-level subscription (agency accounts)
    if (integration.reply_team_id) {
      const teamIdNum = Number(integration.reply_team_id);
      if (!isNaN(teamIdNum)) {
        console.log('Using team-level subscription with teamId:', teamIdNum);
        webhookPayload.subscriptionLevel = 'team';
        webhookPayload.teamIds = [teamIdNum];
      }
    } else {
      // Try to discover accountId for account-level subscription
      const accountId = await discoverAccountId(integration.api_key_encrypted);
      if (accountId) {
        console.log('Using account-level subscription with accountId:', accountId);
        webhookPayload.subscriptionLevel = 'account';
        webhookPayload.accountId = accountId;
      } else {
        console.log('No team or account ID available - attempting webhook without scope');
      }
    }
    
    console.log('Registering webhook with Reply.io v3:', webhookUrl);
    console.log('Webhook payload:', JSON.stringify(webhookPayload));
    
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
      
      // Parse error details for better UI feedback
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.message || errorJson.error || responseText;
      } catch {
        // Keep raw text if not JSON
      }
        
      return new Response(JSON.stringify({ 
        error: 'Failed to register webhook with Reply.io',
        status: response.status,
        details: errorDetails,
        hint: !integration.reply_team_id 
          ? 'For agency accounts, try setting your Team ID first (Edit integration)' 
          : undefined,
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
