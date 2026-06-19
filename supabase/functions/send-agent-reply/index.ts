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
      'authorization, x-client-info, apikey, content-type, x-agent-key',
  };
}

// ---------------------------------------------------------------------------
// Reply.io v3 (deprecated v1 paths removed — Foundation phase 6/6,
// the message-sending function. HIGHEST RISK because this triggers real
// outbound sends via Reply.io campaigns.
//
// Auth: X-Api-Key → Authorization: Bearer (template from 8a37994).
//
// Endpoint conversion — preserves the v1 campaign-push architecture (no
// refactor to v3 direct-send endpoints like /contacts/{id}/linkedin/message):
//
//   v1 (2 calls):
//     POST /v1/people  body={email,firstName,lastName,customFields:[{key:'message',value:draft}]}
//     POST /v1/actions/pushtocampaign  body={campaignId,email,forcePush:false}
//
//   v3 (4 calls in steady state — schema is stricter):
//     1. GET  /v3/custom-fields    → ensure 'message' field is registered
//        [POST /v3/custom-fields  → create if missing — idempotent]
//     2. POST /v3/contacts         → create (returns 201+id) OR 400 if exists
//        [GET /v3/contacts?email=X → if 400, look up existing id]
//     3. PATCH /v3/contacts/{id}   → write customFields:[{name:'message',value:draft}]
//     4. POST /v3/contacts/{id}/move-to-sequence  → triggers the actual send
//
// Behavioral gotchas — discovered via live probing against dev workspace
// 2026-06-19, 7 throwaway contacts + 1 custom field + 4 webhook subscriptions
// all created/deleted to map the v3 semantics:
//
//   A. POST /v3/contacts is CREATE-ONLY. Returns 400 on duplicate email
//      (v1's POST /v1/people was upsert). When 400, look up existing
//      contact id via GET /v3/contacts?email=X and proceed with PATCH.
//
//   B. customFields write via POST /v3/contacts is SILENTLY DROPPED.
//      Probe G3: POST with customFields → 201 + response shows
//      customFields:[] AND subsequent GET also shows customFields:[].
//      Workaround: PATCH /v3/contacts/{id} immediately after — it does
//      persist the write. Confirmed via probe G4.
//
//   C. customFields request shape DIFFERS between POST and PATCH:
//        POST body: [{key: 'message', value: '...'}]      (key/value)
//        PATCH body: [{name: 'message', value: '...'}]    (name/value)
//      Since (B) means POST doesn't actually write customFields, we just
//      omit them from the POST and use PATCH's {name,value} shape.
//
//   D. v3 customFields requires PRE-REGISTRATION in the workspace via
//      /v3/custom-fields. v1 was lenient (any {key,value} attached). v3
//      silently drops both POST AND PATCH writes when the named field
//      isn't registered. The pre-flight ensureMessageCustomField() call
//      below makes the workspace schema requirement self-healing — first
//      call per workspace creates the 'message' field; subsequent calls
//      no-op.
//
//   E. v3 GET /v3/contacts/{id} returns customFields as
//      [{key: '<numeric-field-id-as-string>', value: '...'}] —
//      NOT {key: 'message', value: '...'}. The PATCH write took (verified
//      live) but the read shape uses the workspace's internal field id.
//      Doesn't affect send-agent-reply (we never read back), but worth
//      documenting for future callers.
//
//   F. v1 'forcePush:false' has no direct equivalent in
//      /v3/contacts/{id}/move-to-sequence. v3's closest analog is
//      `removeFromExisting: boolean` which defaults to false (matches
//      v1's forcePush=false intent of "don't yank from existing
//      sequences"). Omitted from the body for now since default is
//      already what we want.
//
// Preserved (per Foundation-phase scope):
//   * campaign_rules[intent] → sequenceId mapping (same intent enum,
//     same lookup, same 'dead'/'remove' special-case stage transitions)
//   * Draft message injection via the 'message' custom field
//     (Reply.io campaign first-step template references {{message}})
//   * agent_leads update on success
//   * agent_activity insert with metadata
//   * Error handling shape — 502 on Reply.io failures
// ---------------------------------------------------------------------------

const REPLY_API_V3 = 'https://api.reply.io/v3';

const INTENT_STAGE_MAP: Record<string, string> = {
  interested: 'engaged',
  needs_more_info: 'engaged',
  out_of_office: 'replied',
  not_interested: 'dead',
  meeting_booked: 'meeting_booked',
};

// Defensive strip — classify-reply already sanitizes `{...}` wrappers but
// a stale draft may still carry braces. Applied at the send boundary so
// Reply.io's `message` custom field never expands to a brace-wrapped
// message in the campaign template.
function stripBraceWrapper(s: string): string {
  if (!s) return s;
  return s.trim().replace(/^\{+/, '').replace(/\}+$/, '').trim();
}

interface CustomFieldListItem {
  id: number;
  title: string;
  fieldType: string;
}

interface V3ContactsPage {
  items?: Array<{ id?: number; email?: string }>;
  hasMore?: boolean;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// Ensure the 'message' custom field exists in the Reply.io workspace.
// Idempotent: GET list first; only POST if missing. Required because v3
// silently drops customFields writes when the named field isn't registered
// (probes E + G3 both showed empty customFields when field was absent).
async function ensureMessageCustomField(apiKey: string): Promise<void> {
  const listRes = await fetch(`${REPLY_API_V3}/custom-fields`, {
    headers: authHeaders(apiKey),
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list custom fields: ${listRes.status} ${(await listRes.text()).slice(0, 200)}`);
  }
  const fields = (await listRes.json()) as CustomFieldListItem[];
  if (Array.isArray(fields) && fields.some((f) => f.title === 'message')) {
    return; // already registered
  }
  const createRes = await fetch(`${REPLY_API_V3}/custom-fields`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ title: 'message', fieldType: 'text' }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create 'message' custom field: ${createRes.status} ${(await createRes.text()).slice(0, 200)}`);
  }
  console.log('[send-agent-reply] registered missing custom field "message" in workspace');
}

// Look up an existing contact by email — used when POST /v3/contacts
// returns 400 (duplicate). Returns the numeric id or null if not found.
async function findContactIdByEmail(email: string, apiKey: string): Promise<number | null> {
  const url = `${REPLY_API_V3}/contacts?email=${encodeURIComponent(email)}&top=1`;
  const resp = await fetch(url, { headers: authHeaders(apiKey) });
  if (!resp.ok) return null;
  const body = (await resp.json()) as V3ContactsPage;
  const id = body.items?.[0]?.id;
  return typeof id === 'number' ? id : null;
}

// Create contact OR find existing by email. Returns the contact id.
// v3 POST /v3/contacts is CREATE-ONLY (returns 400 on duplicate email).
// customFields are intentionally NOT included in this POST — v3 silently
// drops them on create (probe G3). PATCH happens separately below.
async function createOrFindContact(
  email: string,
  firstName: string,
  lastName: string,
  apiKey: string,
): Promise<number> {
  const createRes = await fetch(`${REPLY_API_V3}/contacts`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ email, firstName, lastName }),
  });

  if (createRes.status === 201) {
    const body = (await createRes.json()) as { id?: number };
    if (typeof body.id !== 'number') {
      throw new Error('Contact created but no numeric id in response');
    }
    return body.id;
  }

  if (createRes.status === 400) {
    // Duplicate email — fall back to lookup. v3 also returns 400 for
    // other validation failures (invalid email, missing email+linkedin),
    // so a failed lookup means it WASN'T a duplicate — surface the
    // original 400 body.
    const id = await findContactIdByEmail(email, apiKey);
    if (id !== null) return id;
    const errText = await createRes.text();
    throw new Error(`Contact 400 and not findable by email (likely a validation error, not a duplicate): ${errText.slice(0, 300)}`);
  }

  const errText = await createRes.text();
  throw new Error(`Reply.io contact create failed: ${createRes.status}: ${errText.slice(0, 300)}`);
}

// PATCH the contact's 'message' custom field with the draft text.
// v3 PATCH uses {name, value} (NOT {key, value} like POST).
async function setMessageCustomField(
  contactId: number,
  draftText: string,
  apiKey: string,
): Promise<void> {
  const resp = await fetch(`${REPLY_API_V3}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      customFields: [{ name: 'message', value: draftText }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`PATCH /v3/contacts/${contactId} failed: ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
}

// Move contact to a sequence — v3 equivalent of v1 /actions/pushtocampaign.
// THIS IS THE CALL THAT TRIGGERS THE ACTUAL SEND when the sequence's
// first step is configured to execute immediately. Returns 204 on success.
async function moveContactToSequence(
  contactId: number,
  sequenceId: number,
  apiKey: string,
): Promise<void> {
  const resp = await fetch(`${REPLY_API_V3}/contacts/${contactId}/move-to-sequence`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ sequenceId }),
  });
  if (!resp.ok) {
    throw new Error(`POST /v3/contacts/${contactId}/move-to-sequence failed: ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify JWT
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { leadId, draftResponse: rawDraft, intent } = await req.json();
    const draftResponse = stripBraceWrapper(String(rawDraft ?? ''));

    if (!leadId || !draftResponse || !intent) {
      return new Response(JSON.stringify({ error: 'Missing required fields: leadId, draftResponse, intent' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch the lead
    const { data: lead, error: leadError } = await supabase
      .from('agent_leads')
      .select('*')
      .eq('id', leadId)
      .eq('user_id', userId)
      .single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch agent config
    const { data: agentConfig, error: configError } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (configError || !agentConfig) {
      return new Response(JSON.stringify({ error: 'No active agent config found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Fetch Reply.io integration
    const { data: integration, error: intError } = await supabase
      .from('outbound_integrations')
      .select('api_key_encrypted, reply_team_id')
      .eq('created_by', userId)
      .eq('platform', 'reply.io')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (intError || !integration) {
      return new Response(JSON.stringify({ error: 'Reply.io integration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = integration.api_key_encrypted;

    // 4. Get campaign_id (now sequence_id in v3 terms) from campaign_rules.
    // The picker UI still stores these as 'campaignId'; rename happens
    // at the v3 API boundary below where we pass it as `sequenceId`.
    const campaignRules = agentConfig.campaign_rules || {};
    const campaignId = campaignRules[intent];

    if (campaignId === 'dead') {
      await supabase
        .from('agent_leads')
        .update({ pipeline_stage: 'dead', inbox_status: 'sent', draft_approved: true })
        .eq('id', leadId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (campaignId === 'remove') {
      await supabase
        .from('agent_leads')
        .update({ pipeline_stage: 'meeting_booked', inbox_status: 'sent', draft_approved: true })
        .eq('id', leadId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!campaignId) {
      return new Response(JSON.stringify({ error: 'No campaign mapped for this intent' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Pre-flight: ensure 'message' custom field is registered. v3
    // silently drops customFields writes when the named field isn't in
    // /v3/custom-fields. Idempotent: GET-then-POST-if-missing.
    try {
      await ensureMessageCustomField(apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[send-agent-reply] custom field pre-flight failed:', msg);
      return new Response(JSON.stringify({ error: `Reply.io workspace setup failed: ${msg}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Create/find contact in Reply.io. v3 splits v1's upsert into
    // create-or-lookup (POST → 201|400 → GET-by-email fallback).
    const nameParts = (lead.full_name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    let contactId: number;
    try {
      contactId = await createOrFindContact(lead.email, firstName, lastName, apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[send-agent-reply] createOrFindContact failed:', msg);
      return new Response(JSON.stringify({ error: `Reply.io contact resolve failed: ${msg}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. PATCH the message custom field with the draft text. v3 POST
    // silently drops customFields writes (probe G3); PATCH is the only
    // working write path. Uses {name, value} shape per the OpenAPI spec.
    try {
      await setMessageCustomField(contactId, draftResponse, apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[send-agent-reply] setMessageCustomField failed:', msg);
      return new Response(JSON.stringify({ error: `Reply.io message field write failed: ${msg}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Move contact to sequence — THE SEND TRIGGER. Reply.io's
    // sequence first step renders the {{message}} merge tag with the
    // value we just PATCHed.
    try {
      await moveContactToSequence(contactId, parseInt(campaignId, 10), apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[send-agent-reply] moveContactToSequence failed:', msg);
      return new Response(JSON.stringify({ error: `Reply.io move-to-sequence failed: ${msg}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 9. Update lead
    const pipelineStage = INTENT_STAGE_MAP[intent] || lead.pipeline_stage;

    await supabase
      .from('agent_leads')
      .update({
        inbox_status: 'sent',
        pipeline_stage: pipelineStage,
        draft_approved: true,
      })
      .eq('id', leadId);

    // 10. Insert activity
    await supabase.from('agent_activity').insert({
      user_id: userId,
      agent_config_id: agentConfig.id,
      lead_id: leadId,
      lead_name: lead.full_name,
      lead_company: lead.company,
      activity_type: 'message_sent',
      description: `Reply sent to ${lead.full_name} via Reply.io campaign`,
      metadata: { intent, campaignId, channel: lead.channel },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[send-agent-reply] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
