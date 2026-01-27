import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reply-signature',
};

// Verify HMAC signature from Reply.io
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return signature.toLowerCase() === expectedSignature.toLowerCase();
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const integrationId = pathParts[pathParts.length - 1];
    
    if (!integrationId || integrationId === 'reply-webhook') {
      console.error('No integration ID in path');
      return new Response(JSON.stringify({ error: 'Missing integration ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.text();
    const signature = req.headers.get('x-reply-signature') || '';
    
    // Initialize Supabase with service role for database updates
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch integration to get webhook secret
    const { data: integration, error: integrationError } = await supabase
      .from('outbound_integrations')
      .select('id, team_id, webhook_secret, is_active')
      .eq('id', integrationId)
      .single();
    
    if (integrationError || !integration) {
      console.error('Integration not found:', integrationId);
      return new Response(JSON.stringify({ error: 'Integration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Verify HMAC signature
    if (integration.webhook_secret) {
      const isValid = await verifySignature(payload, signature, integration.webhook_secret);
      if (!isValid) {
        console.error('Invalid webhook signature for integration:', integrationId);
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    
    const event = JSON.parse(payload);
    const eventType = event.event || event.type || 'unknown';
    const contactEmail = event.email || event.contact?.email || event.data?.email;
    const campaignId = event.campaignId || event.campaign_id || event.data?.campaignId;
    
    console.log(`Received webhook event: ${eventType} for integration ${integrationId}`);
    
    // Log the event
    await supabase.from('webhook_events').insert({
      integration_id: integrationId,
      team_id: integration.team_id,
      event_type: eventType,
      contact_email: contactEmail,
      campaign_external_id: campaignId?.toString(),
      event_data: event,
    });
    
    // Process event based on type
    if (campaignId) {
      const { data: campaign } = await supabase
        .from('synced_campaigns')
        .select('id, stats')
        .eq('external_campaign_id', campaignId.toString())
        .eq('team_id', integration.team_id)
        .single();
      
      if (campaign) {
        const stats = (campaign.stats || {}) as Record<string, number>;
        
        switch (eventType) {
          case 'email_sent':
          case 'email_delivered':
            stats.sent = (stats.sent || 0) + 1;
            break;
          case 'email_opened':
            stats.opens = (stats.opens || 0) + 1;
            break;
          case 'email_replied':
            stats.replies = (stats.replies || 0) + 1;
            break;
          case 'linkedin_connection_request_sent':
            stats.linkedinConnectionsSent = (stats.linkedinConnectionsSent || 0) + 1;
            break;
          case 'linkedin_message_sent':
            stats.linkedinMessagesSent = (stats.linkedinMessagesSent || 0) + 1;
            break;
          case 'linkedin_replied':
            stats.linkedinReplies = (stats.linkedinReplies || 0) + 1;
            break;
          case 'email_bounced':
            stats.bounces = (stats.bounces || 0) + 1;
            break;
        }
        
        // Update campaign stats
        await supabase
          .from('synced_campaigns')
          .update({ stats, updated_at: new Date().toISOString() })
          .eq('id', campaign.id);
      }
    }
    
    // Update contact engagement data if we have an email
    if (contactEmail && campaignId) {
      const { data: contact } = await supabase
        .from('synced_contacts')
        .select('id, engagement_data')
        .eq('email', contactEmail)
        .eq('team_id', integration.team_id)
        .maybeSingle();
      
      if (contact) {
        const engagement = (contact.engagement_data || {}) as Record<string, unknown>;
        
        switch (eventType) {
          case 'email_sent':
            engagement.lastEmailSent = new Date().toISOString();
            break;
          case 'email_opened':
            engagement.opened = true;
            engagement.lastOpened = new Date().toISOString();
            break;
          case 'email_replied':
            engagement.replied = true;
            engagement.repliedAt = new Date().toISOString();
            break;
          case 'linkedin_connection_request_sent':
            engagement.linkedinConnectionSent = true;
            engagement.linkedinConnectionSentAt = new Date().toISOString();
            break;
          case 'linkedin_message_sent':
            engagement.linkedinMessageSent = true;
            engagement.linkedinMessageSentAt = new Date().toISOString();
            break;
          case 'linkedin_replied':
            engagement.linkedinReplied = true;
            engagement.linkedinRepliedAt = new Date().toISOString();
            break;
        }
        
        await supabase
          .from('synced_contacts')
          .update({ 
            engagement_data: engagement, 
            updated_at: new Date().toISOString(),
            status: eventType.includes('replied') ? 'replied' : undefined,
          })
          .eq('id', contact.id);
      }
    }
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
