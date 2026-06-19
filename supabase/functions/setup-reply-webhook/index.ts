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

// ---------------------------------------------------------------------------
// Reply.io v3 webhooks (deprecated v2 /api/v2/webhooks removed — Foundation
// phase 5/6, paired with reply-webhook #4 in the same commit).
//
// Auth: X-Api-Key → Authorization: Bearer (template from 8a37994 et al).
//
// Endpoints:
//   v2 GET  /api/v2/webhooks         → v3 GET    /v3/webhooks
//   v2 POST /api/v2/webhooks         → v3 POST   /v3/webhooks
//   v2 DELETE /api/v2/webhooks/{id}  → v3 DELETE /v3/webhooks/{id}
//
// Schema mapping (probed live against the dev API key, 2026-06-19 —
// 4 test webhooks created + deleted to confirm):
//
//   v2 request                          → v3 request
//   ──────────────────────────────────────────────────────────────
//   { event: 'email_replied',          | { eventType: 'email_replied',
//     url: '...',                      |   url: '...',
//     payload: {                       |   payloadConfig: {
//       includeEmailText,              |     includeEmailText,
//       includeProspectCustomFields,   |     includeProspectCustomFields,
//       includeEmailUrl,               |     includeEmailUrl,
//     }}                               |   }}
//
//   v2 GET response:                    v3 GET response:
//     Array<{id, url, event, ...}>       { items: [...], hasMore: bool }
//
//   v3 POST 201 response shape:
//     { id: number (numeric, NOT string), eventType, url, scope: 'personal',
//       enabled: true, createdAt: timestamp, payloadConfig: {...} }
//
//   v3 DELETE returns HTTP 204 No Content.
//
// Event-type vocabulary (verified from docs.reply.io/llms-full.txt):
// snake_case names — IDENTICAL to v2. All 5 of our ALL_EVENT_TYPES map 1:1
// to v3, no vocab change needed.
//
// Idempotency: same delete-then-create pattern as the v2 version. Lists
// webhooks via /v3/webhooks (items[]/hasMore envelope — different from
// v2's raw array), iterates to find ones pointing at our reply-webhook
// URL, deletes each, then registers fresh subscriptions for all 5 events.
// ---------------------------------------------------------------------------

const WEBHOOK_API_BASE = 'https://api.reply.io/v3/webhooks';

// Events to subscribe to (one API call each). Vocabulary identical to v2
// per docs.reply.io/llms-full.txt; the snake_case names map 1:1 to the
// v3 eventType enum.
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

interface V3WebhooksPage {
  items?: Array<{ id?: number | string; url?: string; eventType?: string }>;
  hasMore?: boolean;
}

interface V3WebhookCreated {
  id: number;
  eventType: string;
  url: string;
  scope?: string;
  enabled?: boolean;
  createdAt?: string;
  payloadConfig?: Record<string, boolean>;
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

    // Bearer auth headers for all v3 calls below.
    const v3AuthHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    // Step 1: Delete existing webhooks that point at our reply-webhook
    // URL. v3 list response is an items[]/hasMore envelope (NOT the raw
    // array v2 returned). We paginate through it to ensure cleanup is
    // complete even when an integration has many webhooks.
    console.log('Fetching existing webhooks to clean up duplicates...');
    try {
      let skip = 0;
      const pageSize = 100;
      for (let page = 1; page <= 50; page++) {
        const listResponse = await fetch(`${WEBHOOK_API_BASE}?top=${pageSize}&skip=${skip}`, {
          method: 'GET',
          headers: v3AuthHeaders,
        });
        if (!listResponse.ok) {
          console.log('Could not list existing webhooks, status:', listResponse.status);
          break;
        }
        const payload = (await listResponse.json()) as V3WebhooksPage;
        const webhooksArray = Array.isArray(payload.items) ? payload.items : [];

        for (const wh of webhooksArray) {
          if (wh.url && wh.url.includes('reply-webhook') && wh.id !== undefined) {
            console.log('Deleting existing webhook:', wh.id, wh.url);
            try {
              const delRes = await fetch(`${WEBHOOK_API_BASE}/${wh.id}`, {
                method: 'DELETE',
                headers: v3AuthHeaders,
              });
              console.log('Delete response status:', delRes.status);
            } catch (e) {
              console.log('Failed to delete webhook, continuing:', e);
            }
          }
        }

        if (payload.hasMore === false) break;
        if (webhooksArray.length < pageSize) break;
        skip += webhooksArray.length;
      }
    } catch (e) {
      console.log('Failed to list existing webhooks, continuing:', e);
    }

    // Step 2: Register one webhook per event type. v3 field names:
    //   eventType    (was 'event' in v2)
    //   url          (unchanged)
    //   payloadConfig (was 'payload' in v2 — v3 silently DROPS the v2
    //                  'payload' key, defaulting all flags to false,
    //                  which is why we use 'payloadConfig' here)
    const webhookUrl = `${supabaseUrl}/functions/v1/reply-webhook`;
    console.log('Webhook URL:', webhookUrl);

    const createdIds: string[] = [];
    const errors: string[] = [];

    for (const eventType of ALL_EVENT_TYPES) {
      console.log(`Registering webhook for event: ${eventType}`);

      const response = await fetch(WEBHOOK_API_BASE, {
        method: 'POST',
        headers: v3AuthHeaders,
        body: JSON.stringify({
          eventType,
          url: webhookUrl,
          payloadConfig: {
            includeEmailUrl: false,
            includeEmailText: true,
            includeProspectCustomFields: true,
          },
        }),
      });

      const responseText = await response.text();
      console.log(`v3 response for ${eventType}: ${response.status} ${responseText.slice(0, 300)}`);

      if (response.ok || response.status === 201) {
        try {
          const data = JSON.parse(responseText) as V3WebhookCreated;
          if (data.id !== undefined && data.id !== null) {
            createdIds.push(String(data.id));
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

    // Step 3: Store webhook IDs and update status. webhook_subscription_id
    // is a comma-joined list of all created webhook ids (same format as
    // the v2 path used) — kept stable so any downstream readers don't
    // need updating.
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
