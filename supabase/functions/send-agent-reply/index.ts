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
//     1. GET  /v3/custom-fields    → ensure 'custom_message' field is registered
//        [POST /v3/custom-fields  → create if missing — idempotent]
//     2. POST /v3/contacts         → create (returns 201+id) OR 400 if exists
//        [GET /v3/contacts?email=X → if 400, look up existing id]
//     3. PATCH /v3/contacts/{id}   → write customFields:[{name:'custom_message',value:draft}]
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
//      call per workspace creates the 'custom_message' field; subsequent calls
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
//   * Draft message injection via the 'custom_message' custom field
//     (Reply.io campaign first-step template references {{custom_message}})
//   * agent_leads update on success
//   * agent_activity insert with metadata
//   * Error handling shape — 502 on Reply.io failures
// ---------------------------------------------------------------------------

const REPLY_API_V3 = 'https://api.reply.io/v3';

// Intent → deal stage (the 8-stage taxonomy). Progress stays ACTIVE — the
// operator confirms closes. not_interested advances the lead to in_progress
// (the intent badge still flags the sentiment); it is NOT auto-closed.
const INTENT_STAGE_MAP: Record<string, string> = {
  interested: 'in_progress',
  needs_more_info: 'in_progress',
  out_of_office: 'replied',
  not_interested: 'in_progress',
  meeting_booked: 'call_scheduled',
};

// Defensive strip — classify-reply already sanitizes `{...}` wrappers but
// a stale draft may still carry braces. Applied at the send boundary so
// Reply.io's `custom_message` custom field never expands to a brace-wrapped
// message in the campaign template.
function stripBraceWrapper(s: string): string {
  if (!s) return s;
  return s.trim().replace(/^\{+/, '').replace(/\}+$/, '').trim();
}

// Resolve campaign_rules → sequence id with nested-first, flat-fallback
// lookup. campaign_rules supports TWO valid shapes:
//
//   FLAT (legacy HeyReach/Smartlead and pre-multichannel Reply.io):
//     { interested: '123', out_of_office: '456' }
//
//   NESTED (Reply.io multichannel, new):
//     { linkedin: { interested: '123' }, email: { interested: '456' } }
//
// The lookup tries the channel-scoped path first (campaign_rules[channel]
// [intent]); on miss, falls back to the flat shape (campaign_rules[intent]).
// This guarantees existing flat configs resolve IDENTICALLY to the
// pre-change behavior — critical for the no-regression promise to HR/SL
// and pre-existing Reply.io email configs.
//
// Returns undefined when neither path matches; the caller then surfaces
// the existing "No campaign mapped for this intent" 400.
//
// Edge cases:
//   * channel = '' or null → channel-scoped lookup skipped → flat fallback
//   * campaign_rules[channel] exists but not as an object (e.g. operator
//     wrote 'interested' as the channel key by mistake) → guarded by the
//     typeof object && !Array.isArray check → falls through to flat
//   * The special sentinels 'dead' / 'remove' work in both shapes —
//     they're just string values that the caller switches on.
function resolveCampaignRule(
  campaignRules: Record<string, unknown>,
  channel: string | null | undefined,
  intent: string,
): string | undefined {
  // 1. Channel-scoped (new nested shape) — only if channel is non-empty
  if (channel) {
    const channelScoped = campaignRules[channel];
    if (channelScoped && typeof channelScoped === 'object' && !Array.isArray(channelScoped)) {
      const id = (channelScoped as Record<string, unknown>)[intent];
      if (typeof id === 'string' && id.length > 0) return id;
    }
  }
  // 2. Flat (legacy shape) — identical resolution to pre-change behavior
  const flatId = campaignRules[intent];
  if (typeof flatId === 'string' && flatId.length > 0) return flatId;
  return undefined;
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

// Ensure the 'custom_message' custom field exists in the Reply.io workspace.
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
  if (Array.isArray(fields) && fields.some((f) => f.title === 'custom_message')) {
    return; // already registered
  }
  const createRes = await fetch(`${REPLY_API_V3}/custom-fields`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ title: 'custom_message', fieldType: 'text' }),
  });
  if (!createRes.ok) {
    // A 409 customField.duplicateName means the field already exists — the
    // list-check above missed it (title casing/whitespace/shape mismatch in
    // the GET response), but the duplicate is the desired end state, so treat
    // it as success rather than aborting the whole send with a 502.
    if (createRes.status === 409) {
      console.log("[send-agent-reply] 'custom_message' field already exists (409 duplicate) — treating as success");
      return;
    }
    throw new Error(`Failed to create 'custom_message' custom field: ${createRes.status} ${(await createRes.text()).slice(0, 200)}`);
  }
  console.log('[send-agent-reply] registered missing custom field "custom_message" in workspace');
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
//
// linkedInProfile (optional) is written on create so contacts pushed into
// follow-up campaigns carry the prospect's LinkedIn profile instead of
// showing "Missing Data". The v3 create-body field name is `linkedInUrl`
// (per https://docs.reply.io/api-reference/contacts/create-a-contact) — NOT
// the `linkedInProfileUrl` that GET responses use; v3 silently drops the wrong
// key (probe G3), so the create-body name must be exact. Spread-conditional so
// an empty value is omitted entirely rather than clearing the field.
async function createOrFindContact(
  email: string,
  firstName: string,
  lastName: string,
  apiKey: string,
  linkedInProfile?: string,
): Promise<number> {
  const createRes = await fetch(`${REPLY_API_V3}/contacts`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      email,
      firstName,
      lastName,
      ...(linkedInProfile ? { linkedInUrl: linkedInProfile } : {}),
    }),
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

// PATCH the contact's 'custom_message' custom field with the draft text.
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
      customFields: [{ name: 'custom_message', value: draftText }],
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

// Reply.io v3 returns errors as an RFC9457 problem-details envelope:
//   { title, status, detail, code }
// `code` is the stable machine-readable discriminator (e.g.
// 'inboxThread.channelMismatch'); `detail` is human prose. We map the
// documented codes for POST /v3/inbox/threads/{id}/messages to specific
// operator-readable messages, and fall back to surfacing the raw code/detail
// for anything undocumented so we can diagnose it.
interface ReplyErrorEnvelope {
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
}

function mapThreadReplyError(httpStatus: number, env: ReplyErrorEnvelope): string {
  switch (env.code) {
    case 'inboxThread.channelMismatch':
      return 'Channel mismatch — thread channel differs.';
    case 'inboxThread.contactOptedOut':
      return "Contact has opted out and can't be messaged.";
    case 'inboxThread.forbidden':
      return "Reply.io inbox sending isn't enabled for this account.";
    case 'inboxThread.notFound':
      return 'Thread not found in Reply.io.';
    case 'inboxThread.threadSendFailed':
      return 'LinkedIn rejected delivery (send limit, cookie, or message length) — thread needs attention in Reply.io.';
  }
  // No documented code matched. 429 has no per-code message in the docs, so
  // key off the status. Otherwise surface whatever Reply.io told us.
  if (httpStatus === 429) {
    return 'Rate limited, try again shortly.';
  }
  const detail = [env.detail, env.code ? `(${env.code})` : ''].filter(Boolean).join(' ').trim();
  return detail
    ? `Reply.io thread reply failed: ${detail}`
    : `Reply.io thread reply failed (HTTP ${httpStatus}).`;
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

    const { leadId, draftResponse: rawDraft, intent, campaignId: bodyCampaignId, cc: bodyCc } = await req.json();
    const draftResponse = stripBraceWrapper(String(rawDraft ?? ''));

    // intent is NOT hard-required: the direct-send "Send Reply" path only needs
    // leadId + draftResponse (it replies into the existing thread). intent is
    // used solely for optional pipeline-stage mapping (INTENT_STAGE_MAP falls
    // back to the lead's current stage) and, on the campaign path, for
    // rule-based routing — both tolerate a null intent. Requiring it here was
    // the cause of a 400 on Send Reply when the lead had no classified intent.
    if (!leadId || !draftResponse) {
      return new Response(JSON.stringify({ error: 'Missing required fields: leadId, draftResponse' }), {
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

    // Suppression: a lead tagged 'opted_out' must never be messaged. Refuse the
    // send and return the same handled result the UI shows for a live Reply.io
    // opt-out (friendly toast, not an error). Keyed on the disposition_tag flag,
    // NOT pipeline_stage (which holds the mapped 'dead' value).
    if (lead.disposition_tag === 'opted_out') {
      console.log(`[send-agent-reply] lead ${leadId} is opted_out — refusing to send`);
      return new Response(JSON.stringify({
        success: false,
        handled: true,
        code: 'contact_opted_out',
        message: "This contact has opted out and can't be messaged — reply not sent",
      }), {
        status: 200,
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
      .select('id, api_key_encrypted, reply_team_id, team_id')
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
    //
    // Lookup is channel-aware (multichannel-Reply.io requirement): tries
    // campaign_rules[lead.channel][intent] first, then falls back to flat
    // campaign_rules[intent] for back-compat with HeyReach/Smartlead
    // configs and pre-existing Reply.io email configs. See
    // resolveCampaignRule() for the exact contract.
    const campaignRules = (agentConfig.campaign_rules || {}) as Record<string, unknown>;
    const leadChannel = (lead.channel as string | null | undefined) ?? '';

    // Operator-picked campaign (Reply.io Actions → "Add to Campaign") overrides
    // intent routing: when the request body carries a non-empty campaignId, use
    // it DIRECTLY as the sequence id and skip resolveCampaignRule entirely (the
    // `??` short-circuits), which also bypasses the dead/remove/"No campaign
    // mapped" branches below (the operator id is a real sequence id, never those
    // sentinels). The 4b channel-match safety check STILL runs against it.
    // Absent/empty body.campaignId → unchanged intent-routing behavior.
    const operatorCampaignId =
      typeof bodyCampaignId === 'string' && bodyCampaignId.trim()
        ? bodyCampaignId.trim()
        : null;

    // =======================================================================
    // DIRECT-SEND PATH ("Send Reply") — runs ONLY when no operator campaign
    // was picked. Sends the operator's message straight into the existing
    // Reply.io inbox thread, mirroring send-heyreach-message (one API call,
    // sender-only thread append). Returns before reaching ANY of the campaign /
    // move-to-sequence machinery below, which stays byte-for-byte unchanged and
    // is reached only when operatorCampaignId is set ("Add to Campaign").
    //
    // lead.external_id IS the Reply.io inbox thread id — poll-reply-inbox
    // stores exactly one agent_lead per thread (external_id = thread.id).
    // Endpoint: POST /v3/inbox/threads/{id}/messages  body={channel, message}
    // (https://docs.reply.io/api-reference/inbox/send-a-reply-within-a-thread.md)
    // =======================================================================
    if (!operatorCampaignId) {
      const threadId = lead.external_id;
      if (!threadId) {
        return new Response(JSON.stringify({
          error: 'This reply has no Reply.io thread linked yet, so it cannot be sent. '
               + 'It will become sendable once the thread is resolved (usually within 15 minutes).',
          code: 'thread_unresolved',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // GUARD: external_id must LOOK like a Reply.io inbox-thread id before we
      // post to /v3/inbox/threads/{id}/messages. Historically this column also
      // held CONTACT ids (reply-webhook, pre-fix) and email addresses /
      // 'backfill:*' keys (sync-reply-contacts), each of which produced an
      // opaque 502 relayed from Reply.io's 404 inboxThread.notFound. Observed
      // ranges on live data: thread ids 3.5e8-4.1e8, contact ids >7e8.
      // Fail with a clear message instead of a doomed call.
      const threadIdStr = String(threadId);
      const looksLikeThreadId = /^\d+$/.test(threadIdStr) && Number(threadIdStr) < 5e8;
      if (!looksLikeThreadId) {
        console.error(
          `[send-agent-reply] refusing to send: external_id="${threadIdStr}" is not a thread id `
          + `(lead ${leadId}). Contact ids / emails / backfill keys are not valid thread references.`,
        );
        return new Response(JSON.stringify({
          error: "This lead isn't linked to a Reply.io conversation thread, so the reply can't be "
               + 'delivered. It needs its thread reference repaired before sending.',
          code: 'invalid_thread_reference',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // GUARD: the thread we are about to post into must belong to THIS lead's
      // contact. GET /v3/inbox/threads silently ignores every filter parameter,
      // so a resolver bug could hand us someone else's thread; delivering one
      // prospect's reply to another is unrecoverable. Verify, then send.
      try {
        const tRes = await fetch(`${REPLY_API_V3}/inbox/threads/${threadIdStr}`, {
          headers: authHeaders(apiKey),
        });
        if (tRes.ok) {
          const t = await tRes.json();
          const tEmail = String(t?.contact?.email ?? '').trim().toLowerCase();
          const lEmail = String(lead.email ?? '').trim().toLowerCase();
          if (tEmail && lEmail && tEmail !== lEmail) {
            console.error(
              `[send-agent-reply] ABORT — thread ${threadIdStr} belongs to ${tEmail}, `
              + `lead ${leadId} is ${lEmail}. Refusing to deliver to the wrong prospect.`,
            );
            return new Response(JSON.stringify({
              error: 'Safety check failed: the linked conversation belongs to a different contact. '
                   + 'Reply not sent.',
              code: 'thread_contact_mismatch',
            }), {
              status: 409,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
        // Non-OK verification is NOT fatal — the send below surfaces the real
        // upstream error rather than blocking on a transient lookup failure.
      } catch (verifyErr) {
        console.warn(`[send-agent-reply] thread ownership check skipped: ${String(verifyErr)}`);
      }
      // draftResponse was already validated non-empty above, but Reply.io
      // rejects an empty message — guard at the send boundary so we never
      // make a doomed API call.
      if (!draftResponse) {
        return new Response(JSON.stringify({ error: 'Cannot send an empty reply.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Reply.io requires "linkedIn" (capital I) or "email"; our lead stores
      // lowercase "linkedin". Wrong casing → 400 channelMismatch.
      const replyChannel = lead.channel === 'linkedin' ? 'linkedIn' : 'email';

      // CC applies to the email channel ONLY — Reply.io's thread-reply endpoint
      // ignores cc for linkedIn. The caller may pass a comma-separated string;
      // split/trim into the array shape the API expects. Empty → omit entirely.
      const ccList =
        replyChannel === 'email' && typeof bodyCc === 'string' && bodyCc.trim()
          ? bodyCc.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

      const sendRes = await fetch(`${REPLY_API_V3}/inbox/threads/${threadId}/messages`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          channel: replyChannel,
          message: draftResponse,
          ...(ccList.length ? { cc: ccList } : {}),
        }),
      });

      if (!sendRes.ok) {
        let env: ReplyErrorEnvelope = {};
        try {
          env = (await sendRes.json()) as ReplyErrorEnvelope;
        } catch {
          // Non-JSON error body — leave env empty; mapper falls back to status.
        }
        // Opted-out is a VALID business state, not a failure — the operator
        // can't message this contact and there's nothing to fix or retry. Return
        // it as a clean, handled 200 result (NOT a 502) so supabase-js delivers
        // it in `data` rather than as a FunctionsHttpError ("non-2xx status
        // code"), letting the UI show a friendly toast.
        if (env.code === 'inboxThread.contactOptedOut') {
          console.log('[send-agent-reply] contact opted out — tagging lead opted_out + surfacing handled result');
          // Auto-apply the opted_out suppression flag so future drafts
          // (classify-reply) and sends are suppressed, and move the lead out of
          // the pending queue into Total Inbox (inbox_status='dismissed').
          // opted_out is a COMPLIANCE FLAG on disposition_tag (not a deal
          // stage); the lead's deal stage becomes closed_lost.
          await supabase
            .from('agent_leads')
            .update({ disposition_tag: 'opted_out', pipeline_stage: 'closed_lost', inbox_status: 'dismissed' })
            .eq('id', leadId);
          return new Response(JSON.stringify({
            success: false,
            handled: true,
            code: 'contact_opted_out',
            message: "This contact has opted out and can't be messaged — reply not sent",
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const userMessage = mapThreadReplyError(sendRes.status, env);
        console.error(
          `[send-agent-reply] thread reply failed: status=${sendRes.status} code=${env.code ?? ''} detail=${(env.detail ?? '').slice(0, 200)}`,
        );
        // Relay 429 as 429 so the client can back off; everything else as a 502
        // upstream failure, consistent with the campaign path's Reply.io errors.
        const relayStatus = sendRes.status === 429 ? 429 : 502;
        return new Response(JSON.stringify({ error: userMessage }), {
          status: relayStatus,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Success — append the sent message to reply_thread (sender-only, same as
      // the campaign path's CASE B) and mark the lead sent. Reply.io doesn't
      // echo tracked outbound to our webhook, so this is the only place the
      // outgoing message lands in the thread.
      const pipelineStage = INTENT_STAGE_MAP[intent] || lead.pipeline_stage;
      const existingThread = Array.isArray(lead.reply_thread) ? lead.reply_thread : [];
      const sentMessage = {
        role: 'sender',
        content: draftResponse,
        timestamp: new Date().toISOString(),
        channel: lead.channel,
      };

      await supabase
        .from('agent_leads')
        .update({
          inbox_status: 'sent',
          pipeline_stage: pipelineStage,
          draft_approved: true,
          reply_thread: [...existingThread, sentMessage],
        })
        .eq('id', leadId);

      await supabase.from('agent_activity').insert({
        user_id: userId,
        agent_config_id: agentConfig.id,
        lead_id: leadId,
        lead_name: lead.full_name,
        lead_company: lead.company,
        activity_type: 'message_sent',
        description: `Reply sent to ${lead.full_name} via Reply.io`,
        metadata: { intent, channel: lead.channel, direct: true },
      });

      // Best-effort: record 'sent' inference event (non-blocking)
      try {
        const personKey =
          (lead.email && String(lead.email).trim() ? String(lead.email).trim().toLowerCase() : '') ||
          (lead.linkedin_url && String(lead.linkedin_url).trim() ? String(lead.linkedin_url).trim() : '') ||
          String(leadId);
        if (personKey) {
          await supabase.from('inference_events').upsert(
            {
              team_id: integration.team_id ?? null,
              agent_config_id: agentConfig.id,
              person_key: personKey,
              email: lead.email ? String(lead.email).trim().toLowerCase() : null,
              linkedin_url: lead.linkedin_url ?? null,
              full_name: lead.full_name ?? null,
              job_title: lead.job_title ?? null,
              company_name: lead.company ?? null,
              channel: lead.channel,
              campaign_external_id: null,
              campaign_name: lead.last_campaign_name ?? null,
              event_type: 'sent',
              intent: intent ?? null,
              is_objection: null,
              pipeline_stage: pipelineStage,
              disposition_tag: lead.disposition_tag ?? null,
              occurred_at: new Date().toISOString(),
              source: 'send_agent_reply',
              source_row_id: String(leadId),
              metadata: { path: 'direct_thread_reply' }
            },
            // @ts-ignore onConflict supports column-list; partial unique index handles non-null source_row_id
            { onConflict: 'source,source_row_id,event_type' }
          );
          // Best-effort: upsert people directory snapshot
          try {
            const person: Record<string, unknown> = {
              team_id: integration.team_id ?? null,
              person_key: personKey,
              source: 'send_agent_reply',
              last_seen_at: new Date().toISOString(),
            };
            if (lead.email) person.email = String(lead.email).trim().toLowerCase();
            if (lead.linkedin_url) person.linkedin_url = lead.linkedin_url;
            if (lead.full_name) person.full_name = lead.full_name;
            if (lead.job_title) person.job_title = lead.job_title;
            if (lead.company) person.company_name = lead.company;
            await supabase.from('people').upsert(person, { onConflict: 'team_id,person_key' });
          } catch (e) {
            console.warn('[send-agent-reply] people upsert failed (non-fatal):', e);
          }
        }
      } catch (e) {
        console.warn('[send-agent-reply] inference_events write failed (non-fatal):', e);
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const campaignId = operatorCampaignId ?? resolveCampaignRule(campaignRules, leadChannel, intent);

    if (campaignId === 'dead') {
      // 'dead' is a campaign-routing sentinel (don't add to a sequence); the
      // lead's deal stage becomes closed_lost (the 8-stage taxonomy has no
      // 'dead').
      await supabase
        .from('agent_leads')
        .update({ pipeline_stage: 'closed_lost', inbox_status: 'sent', draft_approved: true })
        .eq('id', leadId);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (campaignId === 'remove') {
      await supabase
        .from('agent_leads')
        .update({ pipeline_stage: 'call_scheduled', inbox_status: 'sent', draft_approved: true })
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

    // 4b. Channel-match safety check — refuse to send if the configured
    // sequence is the wrong channel for this lead. This is the hard-stop
    // that prevents an operator misconfig from silently sending (e.g.) an
    // email reply via a LinkedIn sequence.
    //
    // FAIL-OPEN semantics (back-compat — never produce a false block):
    //   * Sequence not found in synced_campaigns       → skip check
    //     (operator picked an external sequence before syncing, OR the
    //     sequence belongs to a different integration)
    //   * synced_campaigns.channel IS NULL             → skip check
    //     (legacy data: HR/SL rows pre-Step-2.6 backfill; Reply.io rows
    //     not yet re-synced. The check would 4xx every send on these
    //     workspaces, which is worse than the mismatch risk.)
    //   * synced_campaigns.channel === 'multichannel'  → skip check
    //     (Reply.io multichannel sequences accept either inbound channel
    //     by design — the sequence's first step picks the actual
    //     outbound channel.)
    // Only blocks when channel is BOTH known AND single-channel AND
    // different from the lead's channel.
    //
    // Scope: matched by integration_id (NOT team_id) so we never look at
    // a sequence belonging to a different Reply.io integration that
    // happens to share the team_id.
    {
      const { data: targetCampaign } = await supabase
        .from('synced_campaigns')
        .select('channel')
        .eq('external_campaign_id', campaignId)
        .eq('integration_id', integration.id)
        .maybeSingle();

      const seqChannel = (targetCampaign?.channel as string | null | undefined) ?? null;
      if (
        seqChannel &&
        seqChannel !== 'multichannel' &&
        leadChannel &&
        seqChannel !== leadChannel
      ) {
        return new Response(
          JSON.stringify({
            error: `Channel mismatch: lead is ${leadChannel} but configured sequence ${campaignId} is ${seqChannel}. Update campaign rules in Agent Settings to set a ${leadChannel} sequence for "${intent}".`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
    }

    // 5. Pre-flight: ensure 'custom_message' custom field is registered. v3
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
      // Pass linkedin_url (agent_leads is SELECT *, so it's available) so the
      // Reply.io contact carries the prospect's LinkedIn profile — otherwise
      // campaign-pushed contacts show "Missing Data".
      contactId = await createOrFindContact(lead.email, firstName, lastName, apiKey, lead.linkedin_url);
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
    // sequence first step renders the {{custom_message}} merge tag with the
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

    // Append the sent message to reply_thread so the Reply.io send reflects in
    // the conversation thread, mirroring HeyReach (send-heyreach-message for the
    // direct path, add-to-heyreach-campaign for the campaign-add path). Reply.io
    // doesn't echo tracked outbound back to our webhook, so this is the only
    // place the outgoing message lands in the thread. Read-then-write; small
    // race window on concurrent sends to one lead, fine for this single-user flow.
    const existingThread = Array.isArray(lead.reply_thread) ? lead.reply_thread : [];
    const sentMessage = {
      role: 'sender',
      content: draftResponse,
      timestamp: new Date().toISOString(),
      channel: lead.channel,
    };

    // Base fields — unchanged from before; thread (+ optional last_campaign_name)
    // are layered on per path below.
    const leadUpdate: Record<string, unknown> = {
      inbox_status: 'sent',
      pipeline_stage: pipelineStage,
      draft_approved: true,
    };

    if (operatorCampaignId) {
      // CASE A — operator picked a campaign (Add to Campaign): mirror
      // add-to-heyreach-campaign — append sender + system entries and record
      // last_campaign_name. Campaign name is looked up the same way the 4b
      // channel-check matched the sequence (external_campaign_id + integration).
      const { data: namedCampaign } = await supabase
        .from('synced_campaigns')
        .select('name')
        .eq('external_campaign_id', campaignId)
        .eq('integration_id', integration.id)
        .maybeSingle();
      const campaignName = (namedCampaign?.name as string | null | undefined) ?? null;

      const systemMessage = {
        role: 'system',
        content: `Added to campaign: ${campaignName ?? 'Unknown'}`,
        timestamp: new Date().toISOString(),
      };
      leadUpdate.reply_thread = [...existingThread, sentMessage, systemMessage];
      leadUpdate.last_campaign_name = campaignName;
    } else {
      // CASE B — direct Send Reply (intent-routed): mirror send-heyreach-message
      // — append only the sender entry; leave last_campaign_name unchanged.
      leadUpdate.reply_thread = [...existingThread, sentMessage];
    }

    await supabase
      .from('agent_leads')
      .update(leadUpdate)
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

    // Best-effort: record 'sent' inference event (non-blocking)
    try {
      const personKey =
        (lead.email && String(lead.email).trim() ? String(lead.email).trim().toLowerCase() : '') ||
        (lead.linkedin_url && String(lead.linkedin_url).trim() ? String(lead.linkedin_url).trim() : '') ||
        String(leadId);
      if (personKey) {
        await supabase.from('inference_events').upsert(
          {
            team_id: integration.team_id ?? null,
            agent_config_id: agentConfig.id,
            person_key: personKey,
            email: lead.email ? String(lead.email).trim().toLowerCase() : null,
            linkedin_url: lead.linkedin_url ?? null,
            full_name: lead.full_name ?? null,
            job_title: lead.job_title ?? null,
            company_name: lead.company ?? null,
            channel: lead.channel,
            campaign_external_id: campaignId ?? null,
            campaign_name: (leadUpdate.last_campaign_name as string | null | undefined) ?? null,
            event_type: 'sent',
            intent: intent ?? null,
            is_objection: null,
            pipeline_stage: pipelineStage,
            disposition_tag: lead.disposition_tag ?? null,
            occurred_at: new Date().toISOString(),
            source: 'send_agent_reply',
            source_row_id: String(leadId),
            metadata: { path: 'campaign_move_to_sequence' }
          },
          // @ts-ignore onConflict supports column-list; partial unique index handles non-null source_row_id
          { onConflict: 'source,source_row_id,event_type' }
        );
        // Best-effort: upsert people directory snapshot
        try {
          const person: Record<string, unknown> = {
            team_id: integration.team_id ?? null,
            person_key: personKey,
            source: 'send_agent_reply',
            last_seen_at: new Date().toISOString(),
          };
          if (lead.email) person.email = String(lead.email).trim().toLowerCase();
          if (lead.linkedin_url) person.linkedin_url = lead.linkedin_url;
          if (lead.full_name) person.full_name = lead.full_name;
          if (lead.job_title) person.job_title = lead.job_title;
          if (lead.company) person.company_name = lead.company;
          await supabase.from('people').upsert(person, { onConflict: 'team_id,person_key' });
        } catch (e) {
          console.warn('[send-agent-reply] people upsert failed (non-fatal):', e);
        }
      }
    } catch (e) {
      console.warn('[send-agent-reply] inference_events write failed (non-fatal):', e);
    }

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
