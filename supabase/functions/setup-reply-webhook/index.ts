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

// Reply.io V3 API
const WEBHOOK_API_BASE = 'https://api.reply.io/v3/webhooks';
const PROBE_API_URL = 'https://api.reply.io/v3/sequences?limit=1';
const ACCOUNT_INFO_URL = 'https://api.reply.io/v1/actions/me';

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
    
    // Step 1: Probe V3 API access before attempting webhook creation
    console.log('Probing V3 API access...');
    let probeResult: { status: number; ok: boolean; bodySnippet: string } | null = null;
    
    try {
      const probeResponse = await fetch(PROBE_API_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': apiKey,
        },
      });
      
      const probeBody = await probeResponse.text();
      probeResult = {
        status: probeResponse.status,
        ok: probeResponse.ok,
        bodySnippet: probeBody.slice(0, 500),
      };
      
      console.log('V3 probe result:', probeResult.status, probeResult.ok ? 'OK' : 'FAILED');
      
      if (!probeResponse.ok) {
        // API key doesn't have V3 access
        await supabase
          .from('outbound_integrations')
          .update({
            webhook_status: 'error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', integrationId);
        
        let errorMessage = `Reply API V3 probe failed (status ${probeResponse.status}). `;
        if (probeResponse.status === 401) {
          errorMessage += 'Your API key is not authorized for V3 endpoints. Please generate a new key with V3 access.';
        } else if (probeResponse.status === 403) {
          errorMessage += 'Your API key does not have permission to access V3 endpoints. Check your Reply.io account permissions.';
        } else if (probeResponse.status === 404) {
          errorMessage += 'V3 endpoint not found. This may indicate your account does not have V3 API access enabled.';
        } else {
          errorMessage += `Unexpected error. Response: ${probeResult.bodySnippet.slice(0, 200)}`;
        }
        
        return new Response(JSON.stringify({ 
          success: false, 
          error: errorMessage,
          probe: probeResult,
          keyFingerprint: keyFingerprint(apiKey)
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (probeError) {
      console.error('Probe request failed:', probeError);
      // Continue anyway - probe failure shouldn't block webhook creation attempt
    }
    
    // Step 2: Fetch accountId for account-level subscriptions
    let accountId: number | null = null;
    try {
      console.log('Fetching accountId from Reply.io...');
      const accountResponse = await fetch(ACCOUNT_INFO_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': apiKey,
        },
      });
      
      if (accountResponse.ok) {
        const accountData = await accountResponse.json();
        // Try different possible field names
        accountId = accountData.id ?? accountData.accountId ?? accountData.account_id ?? null;
        console.log('Retrieved accountId:', accountId);
      } else {
        console.log('Could not fetch accountId, status:', accountResponse.status);
      }
    } catch (e) {
      console.log('Could not fetch accountId, will try without it:', e);
    }
    
    // Delete existing webhooks if any
    if (integration.webhook_subscription_id) {
      const existingIds = integration.webhook_subscription_id.split(',');
      for (const webhookId of existingIds) {
        if (webhookId.trim()) {
          try {
            console.log('Deleting existing webhook:', webhookId.trim());
            let deleteResponse = await fetch(`${WEBHOOK_API_BASE}/${webhookId.trim()}`, {
              method: 'DELETE',
              headers: { 'X-API-Key': apiKey },
            });
            
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
    
    // Helper function to attempt webhook creation
    async function attemptWebhookCreation(
      subscriptionLevel: 'team' | 'account',
      teamIds?: number[],
      accountIdParam?: number | null
    ): Promise<{ response: Response; responseText: string }> {
      const payload: Record<string, unknown> = {
        targetUrl: webhookUrl,
        eventTypes: ALL_EVENT_TYPES,
        secret: webhookSecret,
        subscriptionLevel,
      };
      
      if (subscriptionLevel === 'team' && teamIds && teamIds.length > 0) {
        payload.teamIds = teamIds;
      }
      
      // Include accountId for account-level subscriptions (required by Reply.io V3)
      if (subscriptionLevel === 'account' && accountIdParam) {
        payload.accountId = accountIdParam;
      }
      
      console.log(`Attempting ${subscriptionLevel}-level webhook creation`);
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
      console.log(`Reply.io V3 response (${subscriptionLevel}):`, response.status, responseText.slice(0, 500));
      
      return { response, responseText };
    }
    
    // Step 3: Attempt webhook creation with fallback strategy
    let finalResponse: Response;
    let finalResponseText: string;
    let usedFallback = false;
    
    // First attempt: team-level if reply_team_id is set
    if (integration.reply_team_id) {
      const teamId = parseInt(integration.reply_team_id, 10);
      const result = await attemptWebhookCreation('team', [teamId]);
      finalResponse = result.response;
      finalResponseText = result.responseText;
      
      // If team-level fails with 404, retry with account-level
      if (result.response.status === 404) {
        console.log('Team-level webhook failed with 404, falling back to account-level...');
        const fallbackResult = await attemptWebhookCreation('account', undefined, accountId);
        finalResponse = fallbackResult.response;
        finalResponseText = fallbackResult.responseText;
        usedFallback = true;
      }
    } else {
      // No team ID, use account-level directly with accountId
      const result = await attemptWebhookCreation('account', undefined, accountId);
      finalResponse = result.response;
      finalResponseText = result.responseText;
    }
    
    // Handle failure
    if (!finalResponse.ok) {
      let errorDetails = finalResponseText || '(empty response)';
      try {
        const errorJson = JSON.parse(finalResponseText);
        errorDetails = errorJson.message || errorJson.error || finalResponseText;
      } catch {
        // Keep raw text
      }
      
      await supabase
        .from('outbound_integrations')
        .update({
          webhook_status: 'error',
          webhook_subscription_id: null,
          webhook_secret: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);
      
      let errorMessage = `Failed to create webhook subscription (status ${finalResponse.status}). `;
      if (finalResponse.status === 404) {
        if (usedFallback) {
          errorMessage += 'Both team-level and account-level subscriptions failed. ';
          if (!accountId) {
            errorMessage += 'Could not retrieve accountId - your API key may not have proper permissions. ';
          }
        } else if (integration.reply_team_id) {
          errorMessage += `Team ID ${integration.reply_team_id} may not be accessible. Try re-selecting the workspace. `;
        }
        errorMessage += 'This often indicates the API key lacks V3 webhook permissions.';
      } else if (finalResponse.status === 401) {
        errorMessage += 'API key is not authorized. Please check your Reply.io API key.';
      } else if (finalResponse.status === 403) {
        errorMessage += 'Permission denied. Your account may not have webhook access enabled.';
      } else {
        errorMessage += `Details: ${errorDetails.slice(0, 200)}`;
      }
      
      return new Response(JSON.stringify({ 
        success: false,
        error: errorMessage,
        status: finalResponse.status,
        details: errorDetails,
        probe: probeResult,
        usedFallback,
        accountId: accountId ?? 'not_retrieved',
        keyFingerprint: keyFingerprint(apiKey)
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Parse successful response
    let webhookId: string | null = null;
    try {
      const data = JSON.parse(finalResponseText);
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
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Webhook created but failed to save config. Please try again.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      webhookUrl,
      status: 'active',
      webhookId,
      eventTypes: ALL_EVENT_TYPES.length,
      usedFallback,
      accountId: accountId ?? 'not_needed',
      message: usedFallback 
        ? 'Webhook configured successfully (using account-level scope as fallback)'
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
