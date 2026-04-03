import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

// Verify HMAC signature from Reply.io V3 webhooks
function verifySignature(payload: string, signature: string | null, secret: string | null): boolean {
  if (!secret || !signature) {
    // If no secret configured, skip verification (backwards compatibility)
    return true;
  }
  
  try {
    const expectedSig = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    // Use timing-safe comparison to prevent timing attacks
    const encoder = new TextEncoder();
    const sigBuffer = encoder.encode(signature);
    const expectedBuffer = encoder.encode(expectedSig);
    
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

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
    console.log('Received webhook payload:', payload.substring(0, 500));
    
    // Initialize Supabase with service role for database updates
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch integration to verify it exists and get webhook secret
    const { data: integration, error: integrationError } = await supabase
      .from('outbound_integrations')
      .select('id, team_id, is_active, webhook_secret')
      .eq('id', integrationId)
      .single();
    
    if (integrationError || !integration) {
      console.error('Integration not found:', integrationId);
      return new Response(JSON.stringify({ error: 'Integration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Verify HMAC signature if secret is configured
    const signature = req.headers.get('x-reply-signature');
    if (integration.webhook_secret) {
      if (!verifySignature(payload, signature, integration.webhook_secret)) {
        console.error('Invalid webhook signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('Webhook signature verified successfully');
    }
    
    // Parse the event
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      console.error('Failed to parse webhook payload');
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // V3 API sends event type in different formats - handle both
    // V3: event.eventType (snake_case like "email_replied")
    // V2: event.event.type (PascalCase like "EmailReplied")
    const eventType = event.eventType || event.event?.type || event.type || 'unknown';
    const contactEmail = event.email || event.contact?.email || event.data?.email;
    
    // Campaign ID extraction - V3 uses different field names
    // V3: event.campaignId or event.sequenceId
    // V2: event.sequence_fields.id
    const campaignId = event.campaignId || event.sequenceId || 
                       event.sequence_fields?.id || event.campaign_id || 
                       event.data?.campaignId;
    
    console.log(`Received webhook event: ${eventType} for integration ${integrationId}, campaign: ${campaignId}`);
    
    // Log the event
    await supabase.from('webhook_events').insert({
      integration_id: integrationId,
      team_id: integration.team_id,
      event_type: eventType,
      contact_email: contactEmail,
      campaign_external_id: campaignId?.toString(),
      event_data: event,
    });
    
    // Process event based on type - update campaign stats
    if (campaignId) {
      const { data: campaign } = await supabase
        .from('synced_campaigns')
        .select('id, stats')
        .eq('external_campaign_id', campaignId.toString())
        .eq('team_id', integration.team_id)
        .single();
      
      if (campaign) {
        const stats = (campaign.stats || {}) as Record<string, number>;
        
        // Normalize event type to snake_case for consistent handling
        const normalizedType = eventType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        
        switch (normalizedType) {
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
          case 'email_bounced':
            stats.bounces = (stats.bounces || 0) + 1;
            break;
          case 'linkedin_message_sent':
            stats.linkedinMessagesSent = (stats.linkedinMessagesSent || 0) + 1;
            break;
          case 'linkedin_message_replied':
            stats.linkedinReplies = (stats.linkedinReplies || 0) + 1;
            break;
          case 'linkedin_connection_request_sent':
            stats.linkedinConnectionsSent = (stats.linkedinConnectionsSent || 0) + 1;
            break;
          case 'linkedin_connection_request_accepted':
            stats.linkedinConnectionsAccepted = (stats.linkedinConnectionsAccepted || 0) + 1;
            break;
          case 'contact_finished':
            stats.finished = (stats.finished || 0) + 1;
            break;
          case 'contact_opted_out':
            stats.optedOut = (stats.optedOut || 0) + 1;
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
        const normalizedType = eventType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        
        switch (normalizedType) {
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
          case 'link_clicked':
            engagement.clicked = true;
            engagement.lastClicked = new Date().toISOString();
            break;
          case 'contact_opted_out':
            engagement.optedOut = true;
            engagement.optedOutAt = new Date().toISOString();
            break;
        }
        
        await supabase
          .from('synced_contacts')
          .update({ 
            engagement_data: engagement, 
            updated_at: new Date().toISOString(),
            status: normalizedType === 'email_replied' ? 'replied' : undefined,
          })
          .eq('id', contact.id);
      }
    }
    
    // ── Agent inbox routing ──────────────────────────────────
    const isReplyEvent = ['replied', 'reply'].some(k =>
      eventType.toLowerCase().includes(k)
    );

    if (isReplyEvent) {
      // Find user for this integration
      const { data: integrationUser } = await supabase
        .from('outbound_integrations')
        .select('user_id')
        .eq('id', integrationId)
        .single();

      if (integrationUser) {
        // Check for active agent
        const { data: agentConfig } = await supabase
          .from('agent_configs')
          .select('*')
          .eq('user_id', integrationUser.user_id)
          .eq('is_active', true)
          .single();

        if (agentConfig) {
          const channel =
            eventType.toLowerCase().includes('linkedin')
              ? 'linkedin' : 'email';

          const replyText = event.replyText || event.text ||
            event.message || event.body ||
            event.data?.text || '';

          const prospectFirstName = event.firstName ||
            event.contact?.firstName || '';
          const prospectLastName = event.lastName ||
            event.contact?.lastName || '';
          const fullName =
            [prospectFirstName, prospectLastName]
              .filter(Boolean).join(' ') ||
            event.contact?.name || event.name || 'Unknown';

          const prospectEmail = event.email ||
            event.contact?.email || '';
          const linkedinUrl = event.linkedinUrl ||
            event.contact?.linkedinUrl || '';
          const company = event.company ||
            event.contact?.company || '';
          const jobTitle = event.jobTitle ||
            event.contact?.jobTitle || '';
          const externalId = event.contactId?.toString() ||
            event.id?.toString() || prospectEmail;

          if (externalId) {
            // Get existing lead to append thread
            const { data: existingLead } = await supabase
              .from('agent_leads')
              .select('id, reply_thread')
              .eq('user_id', integrationUser.user_id)
              .eq('external_id', externalId)
              .maybeSingle();

            const existingThread =
              existingLead?.reply_thread || [];
            const updatedThread = [...(existingThread as any[]), {
              role: 'prospect',
              content: replyText,
              timestamp: new Date().toISOString(),
              channel
            }];

            // Upsert agent_leads
            const { data: upsertedLead } = await supabase
              .from('agent_leads')
              .upsert({
                user_id: integrationUser.user_id,
                agent_config_id: agentConfig.id,
                external_id: externalId,
                full_name: fullName,
                email: prospectEmail,
                linkedin_url: linkedinUrl,
                company,
                job_title: jobTitle,
                channel,
                pipeline_stage: 'replied',
                inbox_status: 'pending',
                last_reply_at: new Date().toISOString(),
                last_reply_text: replyText,
                reply_thread: updatedThread
              }, {
                onConflict: 'user_id,external_id',
                ignoreDuplicates: false
              })
              .select()
              .single();

            // Log activity
            if (upsertedLead) {
              await supabase.from('agent_activity').insert({
                user_id: integrationUser.user_id,
                agent_config_id: agentConfig.id,
                lead_id: upsertedLead.id,
                lead_name: fullName,
                lead_company: company,
                activity_type: 'reply_received',
                description: `${channel === 'linkedin' ?
                  'LinkedIn' : 'Email'} reply received from ${fullName}${company ? ' at ' + company : ''}`,
                metadata: { channel, intent: 'pending' }
              });
            }

            // Call classify-reply with 8s timeout
            const classifyPromise = fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/classify-reply`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-agent-key': Deno.env.get('AGENT_API_KEY') || ''
                },
                body: JSON.stringify({
                  reply_text: replyText,
                  thread_history: updatedThread,
                  agent_context: {
                    offer_description: agentConfig.offer_description,
                    desired_action: agentConfig.desired_action,
                    outcome_delivered: agentConfig.outcome_delivered,
                    target_icp: agentConfig.target_icp,
                    sender_name: agentConfig.sender_name,
                    sender_title: agentConfig.sender_title,
                    sender_bio: agentConfig.sender_bio,
                    company_name: agentConfig.company_name,
                    company_url: agentConfig.company_url,
                    communication_style: agentConfig.communication_style,
                    avoid_phrases: agentConfig.avoid_phrases || [],
                    sample_message: agentConfig.sample_message || ''
                  },
                  channel,
                  user_id: integrationUser.user_id
                })
              }
            );

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('classify-reply timeout')), 8000)
            );

            try {
              const classifyRes = await Promise.race([
                classifyPromise, timeoutPromise
              ]) as Response;

              const classification = await classifyRes.json();

              if (upsertedLead && classification.intent) {
                await supabase
                  .from('agent_leads')
                  .update({
                    intent: classification.intent,
                    intent_confidence: classification.intent_confidence,
                    draft_response: classification.suggested_response,
                    pipeline_stage: classification.next_pipeline_stage,
                    inbox_status: classification.should_auto_send
                      ? 'sent' : 'draft_ready',
                    auto_handled: classification.should_auto_send
                  })
                  .eq('id', upsertedLead.id);

                // Log draft created activity
                await supabase.from('agent_activity').insert({
                  user_id: integrationUser.user_id,
                  agent_config_id: agentConfig.id,
                  lead_id: upsertedLead.id,
                  lead_name: fullName,
                  lead_company: company,
                  activity_type: 'draft_created',
                  description: `Draft response created for ${fullName} — classified as ${classification.intent} (${Math.round(classification.intent_confidence * 100)}% confidence)`,
                  metadata: {
                    intent: classification.intent,
                    confidence: classification.intent_confidence,
                    channel,
                    auto_handled: classification.should_auto_send
                  }
                });
              }
            } catch (classifyErr) {
              console.error('classify-reply failed:', classifyErr);
              // Continue — webhook still succeeds
            }
          }
        }
      }
    }
    // ── End agent inbox routing ─────────────────────────────

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
