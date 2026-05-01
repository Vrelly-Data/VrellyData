import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// V2 PascalCase → snake_case event type mapping
const EVENT_TYPE_MAP: Record<string, string> = {
  EmailReplied: 'email_replied',
  LinkedinMessageReplied: 'linkedin_message_replied',
  EmailBounced: 'email_bounced',
  ContactOptedOut: 'contact_opted_out',
  ContactFinished: 'contact_finished',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse the V2 payload
    const event = await req.json();
    console.log('Received V2 webhook payload:', JSON.stringify(event).substring(0, 500));

    const rawEventType = event.event?.type || '';
    const eventType = EVENT_TYPE_MAP[rawEventType] || rawEventType;
    const teamId = event.event?.TeamId?.toString() || '';
    const userId = event.event?.UserId?.toString() || '';

    // Contact fields
    const contactEmail = event.contact_fields?.email || '';
    const firstName = event.contact_fields?.first_name || '';
    const lastName = event.contact_fields?.last_name || '';
    const fullName = event.contact_fields?.full_name || `${firstName} ${lastName}`.trim();
    const linkedinUrl = event.contact_fields?.linkedin_profile_url || '';
    const company = event.contact_fields?.company || '';
    const jobTitle = event.contact_fields?.title || '';
    const contactId = event.contact_fields?.id?.toString() || '';

    // Channel detection
    const channel = rawEventType.toLowerCase().includes('linkedin') ? 'linkedin' : 'email';

    // Reply text
    const replyText = event.reply_text || event.reply_message_url || `${channel} reply received`;

    // Campaign ID
    const campaignId = event.sequence_fields?.id?.toString() || '';

    console.log(`V2 webhook: event=${eventType} teamId=${teamId} email=${contactEmail} campaign=${campaignId}`);

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Match integration by reply_team_id
    const { data: integration, error: integrationError } = await supabase
      .from('outbound_integrations')
      .select('id, team_id, api_key_encrypted, is_active, webhook_secret, created_by')
      .eq('reply_team_id', teamId)
      .limit(1)
      .single();

    if (integrationError || !integration) {
      console.warn(`No integration found for TeamId=${teamId}, UserId=${userId}. Accepting payload to prevent retries.`);
      return new Response(JSON.stringify({ success: true, warning: 'no matching integration' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Matched integration ${integration.id} for TeamId=${teamId}`);

    // Verify URL ?secret= against the integration's stored webhook_secret.
    // Backward-compat: if no secret is stored yet, log a warning and accept
    // the request so existing flows don't break during the rollout. Once
    // webhook_secret is populated and the customer's Reply.io webhook URL
    // is updated to include ?secret=<value>, mismatches return 401.
    {
      const providedSecret = new URL(req.url).searchParams.get('secret');
      const expectedSecret = integration.webhook_secret as string | null;
      if (expectedSecret) {
        if (providedSecret !== expectedSecret) {
          console.warn(
            `[reply-webhook] URL secret mismatch for integration ${integration.id} — rejecting`,
          );
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.warn(
          `[reply-webhook] No webhook_secret stored for integration ${integration.id} — accepting unauthenticated request (backward-compat). Generate a secret and update the Reply.io webhook URL with ?secret=<value> to enable verification.`,
        );
      }
    }

    // Log the event
    await supabase.from('webhook_events').insert({
      integration_id: integration.id,
      team_id: integration.team_id,
      event_type: eventType,
      contact_email: contactEmail,
      campaign_external_id: campaignId,
      event_data: event,
    });

    // Update campaign stats
    let campaign: { id: string; stats: Record<string, number> | null } | null = null;
    if (campaignId) {
      const { data } = await supabase
        .from('synced_campaigns')
        .select('id, stats')
        .eq('external_campaign_id', campaignId)
        .eq('team_id', integration.team_id)
        .single();
      campaign = data;
    }

    if (campaign) {
      const stats = (campaign.stats || {}) as Record<string, number>;

      switch (eventType) {
        case 'email_replied':
          stats.replies = (stats.replies || 0) + 1;
          break;
        case 'email_bounced':
          stats.bounces = (stats.bounces || 0) + 1;
          break;
        case 'linkedin_message_replied':
          stats.linkedinReplies = (stats.linkedinReplies || 0) + 1;
          break;
        case 'contact_finished':
          stats.finished = (stats.finished || 0) + 1;
          break;
        case 'contact_opted_out':
          stats.optedOut = (stats.optedOut || 0) + 1;
          break;
      }

      await supabase
        .from('synced_campaigns')
        .update({ stats, updated_at: new Date().toISOString() })
        .eq('id', campaign.id);
    }

    // Update contact engagement data
    if (contactEmail && campaignId) {
      const { data: contact } = await supabase
        .from('synced_contacts')
        .select('id, engagement_data, first_name, last_name, external_contact_id')
        .eq('email', contactEmail)
        .eq('team_id', integration.team_id)
        .maybeSingle();

      if (contact) {
        const engagement = (contact.engagement_data || {}) as Record<string, unknown>;
        const normalizedType = eventType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

        switch (eventType) {
          case 'email_sent':
            engagement.lastEmailSent = new Date().toISOString();
            break;
          case 'email_opened':
            engagement.opened = true;
            engagement.lastOpened = new Date().toISOString();
            break;
          case 'email_replied': {
            engagement.replied = true;
            engagement.repliedAt = new Date().toISOString();
            // Reply.io sends email body when includeEmailText is enabled on the webhook
            const replyBody = event.emailTextBody || event.email_text_body ||
                              event.emailHtmlBody || event.email_html_body ||
                              event.body || event.text || event.message ||
                              event.data?.emailTextBody || event.data?.body;
            if (replyBody) {
              engagement.lastReplyText = replyBody;
            }
            break;
          }
          case 'link_clicked':
            engagement.clicked = true;
            engagement.lastClicked = new Date().toISOString();
            break;
          case 'linkedin_message_replied':
            engagement.linkedinReplied = true;
            engagement.linkedinRepliedAt = new Date().toISOString();
            break;
          case 'email_bounced':
            engagement.bounced = true;
            engagement.bouncedAt = new Date().toISOString();
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
            status: eventType === 'email_replied' || eventType === 'linkedin_message_replied'
              ? 'replied' : undefined,
          })
          .eq('id', contact.id);

        // Upsert into agent_leads when we have a reply with text (legacy path)
        if (normalizedType === 'email_replied' && engagement.lastReplyText && integration.created_by) {
          const externalId = contact.external_contact_id ||
            event.contactId || event.contact?.id || event.data?.contactId || contactEmail;

          supabase
            .from('agent_leads')
            .upsert({
              user_id: integration.created_by,
              external_id: String(externalId),
              full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null,
              email: contactEmail,
              last_reply_text: engagement.lastReplyText as string,
              inbox_status: 'pending',
              channel: 'email',
            }, { onConflict: 'user_id,external_id' })
            .then(({ error: leadsErr }) => {
              if (leadsErr) console.error('agent_leads upsert error:', leadsErr);
              else console.log(`Upserted agent_lead for ${contactEmail}`);
            });

          // Fire-and-forget: trigger full sync so agent_leads stays consistent
          if (campaign) {
            fetch(`${supabaseUrl}/functions/v1/sync-reply-contacts`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                campaignId: campaign.id,
                integrationId: integration.id,
                userId: integration.created_by,
              }),
            }).catch(err => console.error('sync-reply-contacts fire-and-forget error:', err));
          }
        }
      }
    }

    // ── Agent inbox routing ──────────────────────────────────
    const isReplyEvent = eventType === 'email_replied' || eventType === 'linkedin_message_replied';
    console.log(`[inbox-routing] isReplyEvent=${isReplyEvent} eventType=${eventType} created_by=${integration.created_by}`);

    if (isReplyEvent && integration.created_by) {
      const agentUserId = integration.created_by;
      console.log(`[inbox-routing] agentUserId=${agentUserId}`);

      // Check for active agent
      const { data: agentConfig, error: agentConfigError } = await supabase
        .from('agent_configs')
        .select('*')
        .eq('user_id', agentUserId)
        .eq('is_active', true)
        .single();

      console.log(`[inbox-routing] agentConfig=${agentConfig ? 'found (id=' + agentConfig.id + ')' : 'null'} error=${agentConfigError?.message || 'none'}`);

      if (agentConfig) {
        const externalId = contactId || contactEmail;
        console.log(`[inbox-routing] externalId=${externalId} contactId=${contactId} contactEmail=${contactEmail}`);

        if (externalId) {
          // Get existing lead to append thread
          const { data: existingLead, error: existingLeadError } = await supabase
            .from('agent_leads')
            .select('id, reply_thread')
            .eq('user_id', agentUserId)
            .eq('external_id', externalId)
            .maybeSingle();

          console.log(`[inbox-routing] existingLead=${existingLead ? 'found (id=' + existingLead.id + ')' : 'null'} error=${existingLeadError?.message || 'none'}`);

          const existingThread = existingLead?.reply_thread || [];
          const updatedThread = [...(existingThread as any[]), {
            role: 'prospect',
            content: replyText,
            timestamp: new Date().toISOString(),
            channel,
          }];

          // Upsert agent_leads
          console.log(`[inbox-routing] upserting agent_leads for externalId=${externalId}`);
          const { data: upsertedLead, error: upsertError } = await supabase
            .from('agent_leads')
            .upsert({
              user_id: agentUserId,
              agent_config_id: agentConfig.id,
              external_id: externalId,
              full_name: fullName || 'Unknown',
              email: contactEmail,
              linkedin_url: linkedinUrl,
              company,
              job_title: jobTitle,
              channel,
              pipeline_stage: 'replied',
              inbox_status: 'pending',
              last_reply_at: new Date().toISOString(),
              last_reply_text: replyText,
              reply_thread: updatedThread,
            }, {
              onConflict: 'user_id,external_id',
              ignoreDuplicates: false,
            })
            .select()
            .single();

          console.log(`[inbox-routing] upsertedLead=${upsertedLead ? 'ok (id=' + upsertedLead.id + ')' : 'null'} error=${upsertError?.message || 'none'}`);

          // Log activity
          if (upsertedLead) {
            const { error: activityError } = await supabase.from('agent_activity').insert({
              user_id: agentUserId,
              agent_config_id: agentConfig.id,
              lead_id: upsertedLead.id,
              lead_name: fullName || 'Unknown',
              lead_company: company,
              activity_type: 'reply_received',
              description: `${channel === 'linkedin' ? 'LinkedIn' : 'Email'} reply received from ${fullName || 'Unknown'}${company ? ' at ' + company : ''}`,
              metadata: { channel, intent: 'pending' },
            });
            console.log(`[inbox-routing] activity insert error=${activityError?.message || 'none'}`);
          }

          // Fire-and-forget: classify-reply runs independently and updates agent_leads when done
          console.log(`[inbox-routing] firing classify-reply for lead_id=${upsertedLead?.id}`);
          fetch(
            `${supabaseUrl}/functions/v1/classify-reply`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-agent-key': Deno.env.get('AGENT_API_KEY') || '',
              },
              body: JSON.stringify({
                reply_text: replyText,
                thread_history: updatedThread,
                lead_id: upsertedLead?.id,
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
                  sample_message: agentConfig.sample_message || '',
                },
                channel,
                user_id: agentUserId,
              }),
            }
          ).catch((err) => console.error('[inbox-routing] classify-reply fire-and-forget error:', err));

          console.log('[inbox-routing] done, returning success');
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
    // Always return 200 to prevent Reply.io retries
    return new Response(JSON.stringify({ success: true, error: 'internal processing error' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
