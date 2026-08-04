import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveExistingLead,
  fetchReplyIoCandidates,
  isGenmailEmail,
} from '../_shared/lead-dedup.ts';
import { htmlToText } from '../_shared/html-to-text.ts';
import { isSuppressed, fireClassifyReply } from '../_shared/inbox-reply.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Reply.io v3 webhook receiver (Foundation phase 4/6, paired with
// setup-reply-webhook #5 in the same commit).
//
// The v3 PAYLOAD SHAPE Reply.io fires at us is UNVERIFIED — we registered
// v3 webhooks via /v3/webhooks in #5 but haven't received a real fire yet.
// Two safeguards:
//
//   1. Defensive multi-path extraction below: for each field we care about
//      (eventType, teamId, contact email, etc.) we try the v2 path first,
//      then likely v3 paths, then top-level. The pick() helper short-
//      circuits on the first non-empty value. If v3 keeps any v2 path
//      identical, we use it; if v3 renames, we fall through to the v3
//      candidate.
//
//   2. First-call payload logger (gated on the module-scope flag
//      loggedFirstPayloadShape) dumps the FULL top-level structure +
//      one-level-deep keys for every nested object. Fires once per
//      worker process lifetime on the first non-OPTIONS POST. Tightens
//      the parser after we read the live shape from POST /v3/webhooks/{id}/test.
//
// Event-name vocabulary: v2 used PascalCase event.event.type (e.g.
// 'EmailReplied') which we mapped to snake_case. v3 webhook docs use
// snake_case directly. EVENT_TYPE_MAP still handles the v2 PascalCase
// in case v3 keeps emitting it; the snake_case path is the new primary.
// ---------------------------------------------------------------------------

// Module-scope tripwire: log full payload structure ONCE per worker
// process on the first non-OPTIONS POST. Tightens the parser after live
// shape capture.
let loggedFirstPayloadShape = false;

// Pick the first non-empty value across candidate paths. Falsy =
// undefined / null / empty string. Used to make the parser defensive
// across the unknown v3 vs known v2 shape.
function pick<T>(...candidates: (T | undefined | null)[]): T | undefined {
  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== '') return c;
  }
  return undefined;
}

// V2 PascalCase → snake_case event type mapping (preserved — v3 may
// send snake_case directly, but we fall through this map for v2-shaped
// payloads.)
const EVENT_TYPE_MAP: Record<string, string> = {
  EmailReplied: 'email_replied',
  LinkedinMessageReplied: 'linkedin_message_replied',
  EmailBounced: 'email_bounced',
  ContactOptedOut: 'contact_opted_out',
  ContactFinished: 'contact_finished',
};

// ---------------------------------------------------------------------------
// Resolve the Reply.io INBOX THREAD id for a reply event.
//
// WHY THIS EXISTS. send-agent-reply posts to POST /v3/inbox/threads/{id}/messages
// using agent_leads.external_id directly. This webhook previously wrote
// `contactId || contactEmail` there — a CONTACT id, not a thread id — so every
// webhook-captured lead 404'd with inboxThread.notFound on send. The v3 payload
// contains NO thread id in any event type (verified across 705 real events:
// email_replied, linkedin_message_replied, contact_finished, contact_opted_out
// carry only contact_fields.id, sent_email_id, linkedin_message_id), so the
// thread must be resolved via lookup.
//
// SAFETY. GET /v3/inbox/threads SILENTLY IGNORES every filter parameter --
// contactId, contactIds, contactEmail, email, search, searchString, q all
// return the same unfiltered page (verified: a bogus contactId returns real
// rows). Filtering therefore happens CLIENT-SIDE, and we require BOTH
// contact.id AND contact.email to agree before trusting a match. Posting into a
// wrongly-resolved thread would deliver one prospect's reply to another, so
// this function returns null rather than guess.
async function resolveThreadId(
  apiKey: string,
  opts: {
    contactId: string;
    contactEmail: string;
    sequenceId?: string | number | null;   // payload sequence_fields.id
    channel: string;                       // 'linkedin' | 'email'
  },
): Promise<{ threadId: string | null; reason: string }> {
  if (!apiKey || !opts.contactId) return { threadId: null, reason: 'missing api key or contact id' };
  const norm = (e: unknown) => String(e ?? '').trim().toLowerCase();
  const wantEmail = norm(opts.contactEmail);

  // BOUNDED paging. Avania's inbox is ~600 threads; the cap keeps a large
  // account from turning one webhook into an unbounded crawl, and we early-exit
  // the moment the contact is found. Threads are returned most-recently-active
  // first, and a replying contact is by definition recently active, so a match
  // almost always lands on page 1.
  const PAGE = 100, MAX_PAGES = 12;   // <= 1200 threads
  const matches: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(
        `${REPLY_API_V3}/inbox/threads?top=${PAGE}&skip=${page * PAGE}`,
        { headers: { 'x-api-key': apiKey, Accept: 'application/json' } },
      );
    } catch (e) {
      return { threadId: null, reason: `network error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status === 429) return { threadId: null, reason: 'rate limited (429)' };
    if (!res.ok) return { threadId: null, reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    const items: any[] = body?.items ?? [];
    for (const t of items) {
      // DUAL KEY — id and email must BOTH agree (email compared only when both
      // sides carry one; masked/absent addresses fall back to id alone).
      if (String(t?.contact?.id) !== String(opts.contactId)) continue;
      const tEmail = norm(t?.contact?.email);
      if (wantEmail && tEmail && tEmail !== wantEmail) continue;
      matches.push(t);
    }
    if (matches.length) break;              // early exit — contact found
    if (items.length < PAGE) break;         // inbox exhausted
  }

  if (matches.length === 0) return { threadId: null, reason: 'no thread matched contact id + email' };
  if (matches.length === 1) return { threadId: String(matches[0].id), reason: 'unique match' };

  // MULTI-THREAD (~7% of contacts — same contact across several sequences, same
  // channel, often with identical lastActivityDate, so "most recent" does NOT
  // disambiguate). Use the payload's own context.
  if (opts.sequenceId != null) {
    const bySeq = matches.filter((t) => String(t?.sequence?.id) === String(opts.sequenceId));
    if (bySeq.length === 1) return { threadId: String(bySeq[0].id), reason: 'disambiguated by sequence id' };
  }
  const byChannel = matches.filter(
    (t) => String(t?.channel ?? '').toLowerCase() === (opts.channel === 'linkedin' ? 'linkedin' : 'email'),
  );
  if (byChannel.length === 1) return { threadId: String(byChannel[0].id), reason: 'disambiguated by channel' };

  // FAIL-SAFE: still ambiguous. Do NOT guess.
  return {
    threadId: null,
    reason: `ambiguous: ${matches.length} threads match (ids ${matches.map((t) => t.id).join(',')})`,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse the webhook payload. Shape is one of:
    //   * v2 (legacy): { event: { type: 'EmailReplied', TeamId, UserId },
    //                    contact_fields: { email, first_name, ... },
    //                    sequence_fields: { id }, reply_text, ... }
    //   * v3 (unverified): unknown shape — first-call logger dumps the
    //                      structure so we can confirm.
    // Read the body as TEXT first so we can log exactly what arrived on the
    // wire before any parsing can throw or reshape it.
    //
    // This is UNCONDITIONAL, unlike the loggedFirstPayloadShape dump below,
    // which is guarded by a module-scope flag and therefore fires at most once
    // per worker process — an edge worker that has already served one request
    // logs nothing for the next, which is how a v3 payload could arrive
    // repeatedly and still never be seen. Reply.io v3's body shape is still
    // unconfirmed (their delivery log records httpStatus: null, i.e. no
    // response recorded at their end), so we need the raw bytes of the next
    // genuine delivery.
    const rawText = await req.text();
    console.log('[reply-webhook] RAW', rawText.slice(0, 3000));

    let event: Record<string, any>;
    try {
      event = JSON.parse(rawText);
    } catch (parseErr) {
      // Never 4xx a malformed body — Reply.io would retry it forever. Log and
      // acknowledge; the RAW line above is what we actually need.
      console.error('[reply-webhook] body is not valid JSON:', String(parseErr));
      return new Response(JSON.stringify({ success: true, warning: 'invalid json' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // First-call shape log: dumps the full top-level structure + the
    // keys of every nested object so we can identify the v3 layout the
    // moment the first real fire arrives. Module-scope guard means this
    // runs at most once per worker process — won't spam logs.
    if (!loggedFirstPayloadShape) {
      const top = event as Record<string, unknown>;
      const topKeys = top && typeof top === 'object' ? Object.keys(top) : [];
      const nestedShape: Record<string, string | string[]> = {};
      for (const k of topKeys) {
        const v = top[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          nestedShape[k] = Object.keys(v as Record<string, unknown>);
        } else if (Array.isArray(v)) {
          nestedShape[k] = `Array(len=${v.length})`;
        } else {
          nestedShape[k] = typeof v;
        }
      }
      console.log('[reply-webhook] first-call payload top-level keys:', topKeys);
      console.log('[reply-webhook] first-call payload nested shape:', JSON.stringify(nestedShape));
      console.log('[reply-webhook] first-call payload preview (1KB):', JSON.stringify(event).substring(0, 1024));
      loggedFirstPayloadShape = true;
    } else {
      console.log('Received webhook payload:', JSON.stringify(event).substring(0, 500));
    }

    // ── Defensive field extraction across v2 + likely v3 paths ──
    // Each pick() chain: v2 path first, then v3-candidate paths, then
    // top-level fallbacks. First-call log surfaces the actual structure;
    // tighten these after the test-fire confirms shapes.

    // Event type — v2: event.event.type (PascalCase); v3: likely
    // event.eventType or top-level event.type (snake_case)
    const rawEventType = String(
      pick(
        event.event?.type,
        event.eventType,
        event.event_type,
        event.type,
      ) ?? ''
    );
    // Normalize through the v2 PascalCase map (no-op when input is already snake_case)
    const eventType = EVENT_TYPE_MAP[rawEventType] || rawEventType;

    // Team ID — v2: event.event.TeamId (PascalCase, nested); v3: any of
    // event.teamId / event.team_id / event.event.teamId
    const teamId = String(
      pick(
        // v3 (VERIFIED against a genuine payload, event id
        // 4ab0eacb-4a1f-4d66-b353-56d66a5a61b0 on 2026-07-31): identifiers nest
        // under `event` in snake_case, and the one that maps to our
        // outbound_integrations.reply_team_id is user_id — NOT team_id:
        //
        //   "event": { "type": "email_replied",
        //              "team_id": 383893,   <- Incrementums (INACTIVE)
        //              "user_id": 368216,   <- Vrelly Reply  (correct owner)
        //              "subscription_id": 21570 }  <- Vrelly Reply's hook id
        //
        // event.team_id is DELIBERATELY NOT in this chain. It resolves to a
        // DIFFERENT tenant, so falling back to it would file one client's
        // replies under another client's account — the same cross-tenant
        // misroute class already fixed in smartlead-webhook. A dropped event is
        // recoverable (it is now persisted unmatched, and the poll re-finds it);
        // a misrouted one is not.
        event.event?.user_id,
        // v2 legacy paths, kept as fallback. All null-safe under v3.
        event.event?.TeamId,
        event.teamId,
        event.team_id,
        event.event?.teamId,
      ) ?? ''
    );

    // User ID (informational only — used in the no-match log)
    const userId = String(
      pick(
        event.event?.UserId,
        event.userId,
        event.user_id,
        event.event?.userId,
      ) ?? ''
    );

    // Contact fields. v2 nested under contact_fields; v3 likely under
    // contact or top-level.
    const contactEmail = String(
      pick(
        event.contact_fields?.email,
        event.contact?.email,
        event.email,
      ) ?? ''
    );
    const firstName = String(
      pick(
        event.contact_fields?.first_name,
        event.contact?.firstName,
        event.contact?.first_name,
        event.firstName,
      ) ?? ''
    );
    const lastName = String(
      pick(
        event.contact_fields?.last_name,
        event.contact?.lastName,
        event.contact?.last_name,
        event.lastName,
      ) ?? ''
    );
    const fullName = String(
      pick(
        event.contact_fields?.full_name,
        event.contact?.fullName,
        event.contact?.full_name,
      ) ?? `${firstName} ${lastName}`.trim()
    );
    const linkedinUrl = String(
      pick(
        event.contact_fields?.linkedin_profile_url,
        event.contact_fields?.linkedinUrl,
        event.contact?.linkedInUrl,
        event.contact?.linkedinUrl,
        event.contact?.linkedin_profile_url,
      ) ?? ''
    );
    const company = String(
      pick(
        event.contact_fields?.company,
        event.contact?.company,
      ) ?? ''
    );
    const jobTitle = String(
      pick(
        event.contact_fields?.title,
        event.contact?.title,
      ) ?? ''
    );
    const contactId = String(
      pick(
        event.contact_fields?.id,
        event.contact?.id,
        event.contactId,
      ) ?? ''
    );

    // Channel detection — derive from the normalized event type.
    const channel = rawEventType.toLowerCase().includes('linkedin') ? 'linkedin' : 'email';

    // Reply text — v2 uses event.reply_text / event.reply_message_url
    // (top-level). v3 candidates added defensively; if none present,
    // fall back to the channel descriptor (preserved v2 behavior).
    // v3 carries the body as HTML in `email_text` — none of the v2 fields below
    // exist, so without this the pick() chain fell through to the
    // `${channel} reply received` PLACEHOLDER. Because both capture paths dedup
    // onto the SAME agent_leads row, that placeholder would have OVERWRITTEN the
    // real text the poll had already stored, across all 7 clients, and been fed
    // to classify-reply as if it were the prospect's words. Caught by the dev
    // replay: "I just grabbed time." became "email reply received".
    //
    // Cleaned with the SHARED htmlToText (moved out of poll-reply-inbox) so both
    // paths produce byte-identical text and an UPDATE is idempotent rather than
    // flip-flopping the stored value.
    const v3Body = pick(event.email_text, event.emailText);
    const replyText = String(
      pick(
        typeof v3Body === 'string' && v3Body.trim() ? htmlToText(v3Body) : undefined,
        event.reply_text,
        event.replyText,
        event.reply_message_url,
        event.replyMessageUrl,
        event.message,
      ) ?? `${channel} reply received`
    );

    // Campaign ID — v2: event.sequence_fields.id; v3: likely
    // event.sequenceId or top-level
    const campaignId = String(
      pick(
        event.sequence_fields?.id,
        event.sequenceId,
        event.sequence?.id,
      ) ?? ''
    );

    console.log(`webhook parsed: event=${eventType} teamId=${teamId} email=${contactEmail} campaign=${campaignId}`);

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
      // SILENT-DROP FIX. This branch used to return 200 and write NOTHING —
      // before the webhook_events insert further down — so an unmatched event
      // vanished with no trace on either side: Reply.io saw a 200 and had no
      // reason to retry, and our log stayed empty. That is precisely how
      // Reply.io capture sat broken for ~110 days without anyone noticing.
      //
      // Persist the raw payload with integration_id NULL so an unroutable
      // event is VISIBLE and replayable once the cause is fixed. Still 200 —
      // acknowledging is correct, dropping silently is not.
      console.error(
        `[reply-webhook] UNMATCHED EVENT — no integration for TeamId="${teamId}" ` +
        `UserId="${userId}" event="${eventType}" contact="${contactEmail ?? '-'}". ` +
        `Persisting to webhook_events with integration_id=null for triage.`,
      );
      const { error: unmatchedErr } = await supabase.from('webhook_events').insert({
        integration_id: null,
        team_id: null,
        event_type: eventType,
        contact_email: contactEmail,
        campaign_external_id: campaignId,
        event_data: event,
      });
      if (unmatchedErr) {
        // Don't fail the request over the audit write — but make the reason
        // loud, since this is the only remaining path to invisibility.
        console.error(
          `[reply-webhook] could not persist unmatched event: ${unmatchedErr.message}`,
        );
      }
      return new Response(
        JSON.stringify({ success: true, warning: 'no matching integration', teamId, logged: !unmatchedErr }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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

    // Update campaign stats. `name` is also selected so we can record the source
    // campaign on the lead at capture (last_campaign_name), making the campaign
    // show in the inbox for pending leads too — not just after Add to Campaign.
    let campaign: { id: string; stats: Record<string, number> | null; name: string | null } | null = null;
    if (campaignId) {
      const { data } = await supabase
        .from('synced_campaigns')
        .select('id, stats, name')
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

        // Write agent_leads when we have a reply with text (legacy path).
        // Now AWAITED + resolver-based (was fire-and-forget upsert): resolves via
        // the shared keys so it converges with the inbox-routing write below on
        // the same lead instead of racing it into a duplicate. Awaiting it also
        // guarantees inbox-routing sees this row when it resolves.
        if (normalizedType === 'email_replied' && engagement.lastReplyText && integration.created_by) {
          const legacyUserId = integration.created_by;
          const externalId = contact.external_contact_id ||
            event.contactId || event.contact?.id || event.data?.contactId || contactEmail;
          const legacyName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null;
          try {
            const legacyCandidates = await fetchReplyIoCandidates(supabase, legacyUserId);
            const legacyMatch = resolveExistingLead(legacyCandidates, {
              externalId: String(externalId),
              linkedinUrl: null,
              email: contactEmail,
            });
            if (legacyMatch) {
              // Minimal refresh; don't clobber identity fields set elsewhere.
              const { error: legacyUpdErr } = await supabase
                .from('agent_leads')
                .update({
                  last_reply_text: engagement.lastReplyText as string,
                  inbox_status: 'pending',
                })
                .eq('id', legacyMatch.id);
              if (legacyUpdErr) console.error('agent_leads legacy update error:', legacyUpdErr.message);
            } else {
              const { error: legacyInsErr } = await supabase
                .from('agent_leads')
                .insert({
                  user_id: legacyUserId,
                  external_id: String(externalId),
                  full_name: legacyName,
                  email: contactEmail,
                  last_reply_text: engagement.lastReplyText as string,
                  inbox_status: 'pending',
                  channel: 'email',
                  source: 'reply_io',
                  last_campaign_name: campaign?.name ?? null,
                });
              if (legacyInsErr) console.error('agent_leads legacy insert error:', legacyInsErr.message);
              else console.log(`Inserted agent_lead for ${contactEmail}`);
            }
          } catch (legacyErr) {
            console.error('agent_leads legacy write error:', legacyErr);
          }

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
        // Resolve the REAL thread id. Never fall back to contactId/contactEmail
        // for external_id: send-agent-reply treats external_id as a thread id,
        // so a contact id there produces a guaranteed 404 inboxThread.notFound.
        const sequenceId = pick(event.sequence_fields?.id, event.sequenceId) ?? null;
        const resolved = await resolveThreadId(integration.api_key_encrypted, {
          contactId,
          contactEmail,
          sequenceId,
          channel,
        });
        // null when unresolved/ambiguous — the lead is still captured in
        // real-time (dedup falls through to linkedin_url / email), it is simply
        // flagged unsendable until repaired. An unsendable-but-visible lead is
        // recoverable; a reply delivered to the wrong prospect is not.
        const externalId = resolved.threadId;
        if (!externalId) {
          console.error(
            `[inbox-routing] THREAD UNRESOLVED (${resolved.reason}) contactId=${contactId} ` +
            `email=${contactEmail} seq=${sequenceId} channel=${channel} — capturing lead with ` +
            `external_id=null; run the thread-id backfill to repair.`,
          );
        }
        console.log(`[inbox-routing] externalId=${externalId ?? 'NULL(unresolved)'} reason=${resolved.reason} contactId=${contactId} contactEmail=${contactEmail}`);

        // Capture proceeds on ANY usable dedup key — external_id may legitimately
        // be null now (unresolved thread), and the shared resolver still matches
        // on linkedin_url / email.
        if (externalId || contactEmail || linkedinUrl) {
          // Resolve the existing lead across ALL reply_io dedup keys (external_id
          // → normalized linkedin_url → normalized email, genmail excluded) —
          // shared with poll-reply-inbox. Replaces the single external_id lookup
          // + partial-index upsert so the same prospect never spawns a 2nd row.
          const candidates = await fetchReplyIoCandidates(supabase, agentUserId);
          const match = resolveExistingLead(candidates, {
            externalId,
            linkedinUrl,
            email: contactEmail,
          });
          console.log(`[inbox-routing] dedup match=${match ? match.id : 'none'} (externalId=${externalId})`);

          // TRUE reply time from the payload (v3: reply_date, e.g.
          // "2026-07-31T13:59:02" — no zone marker, so treat as UTC). Never
          // now(): stamping capture time makes an old event look like the
          // newest reply and corrupts every period-scoped report. It also makes
          // the re-delivery guard work — a retry of the SAME event carries the
          // SAME reply_date, so `newerThanSurfaced` is false and we don't
          // resurface twice.
          const rawReplyDate = pick(event.reply_date, event.replyDate) as string | undefined;
          const replyAt = (() => {
            if (!rawReplyDate) return new Date().toISOString();
            const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(rawReplyDate) ? rawReplyDate : `${rawReplyDate}Z`;
            const t = new Date(iso);
            return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
          })();

          // NOTE: newMsg is no longer PERSISTED — reply_thread is owned solely by
          // poll-reply-inbox (see the update/insert blocks below). It is retained
          // purely to carry the surface-watermark timestamp and the re-delivery
          // comparison.
          const newMsg = {
            role: 'prospect',
            content: replyText,
            timestamp: replyAt,
            channel,
          };

          let upsertedLead: { id: string } | null = null;
          let updatedThread: any[];
          // Whether this reply should (re)surface the lead to 'pending' + draft.
          // A brand-new lead (INSERT branch) always does; the match branch decides.
          let resurface = true;

          if (match) {
            // Append to the matched lead's thread and UPDATE by id. Never touch
            // external_id/source. Upgrade identity fields only when the incoming
            // value is better (non-empty; email only when non-genmail) so a
            // masked stub never downgrades a real-email lead — undefined fields
            // are dropped from the PATCH by supabase-js.
            const { data: existing } = await supabase
              .from('agent_leads')
              .select('reply_thread, inbox_status, disposition_tag, last_surfaced_reply_at')
              .eq('id', match.id)
              .maybeSingle();
            const existingThread = (existing?.reply_thread as any[]) || [];
            // Re-delivery guard: if this exact prospect reply is already the
            // newest entry, it's a webhook retry — don't re-append or resurface.
            const newest = existingThread[existingThread.length - 1];
            const alreadyRecorded = newest?.role === 'prospect' && newest?.content === replyText;
            // Genuinely-new vs the SURFACE watermark (not last_reply_at): this
            // reply is newer than the last one that flipped the lead to pending.
            const newerThanSurfaced =
              !existing?.last_surfaced_reply_at ||
              newMsg.timestamp > existing.last_surfaced_reply_at;
            // Resurface unless: (a) truly opted out, (b) exact re-delivery, or
            // (c) not newer than what we already surfaced. Only opt-out blocks
            // permanently — a 'dismissed'/'in_progress' lead resurfaces.
            resurface =
              !isSuppressed(existing?.disposition_tag) && !alreadyRecorded && newerThanSurfaced;
            updatedThread = alreadyRecorded ? existingThread : [...existingThread, newMsg];

            const { data: updated, error: updateError } = await supabase
              .from('agent_leads')
              .update({
                agent_config_id: agentConfig.id,
                full_name: (fullName && fullName !== 'Unknown') ? fullName : undefined,
                email: (contactEmail && !isGenmailEmail(contactEmail)) ? contactEmail : undefined,
                linkedin_url: linkedinUrl || undefined,
                company: company || undefined,
                job_title: jobTitle || undefined,
                channel,
                last_reply_at: replyAt,
                last_reply_text: replyText,
                // reply_thread DELIBERATELY NOT WRITTEN. poll-reply-inbox is the
                // sole owner: it builds the thread from Reply.io's PER-MESSAGE
                // bodies (GET /v3/inbox/threads/{id}/messages), which arrive
                // already separated. The webhook only ever sees the raw email
                // body (`email_text`), quoted chain included, so appending here
                // produced a near-duplicate entry the poll's clean one collided
                // with. Split ownership removes the collision structurally
                // rather than by heuristic. last_reply_text stays best-effort
                // for real-time freshness; the next poll re-cleans it (<=15 min).
                // Only (re)surface a genuinely-new, non-opted-out reply — leave
                // pipeline_stage / inbox_status untouched otherwise. Advance the
                // surface watermark ONLY here (when we set pending), so the
                // unconditional last_reply_at write above can't poison the guard.
                ...(resurface
                  ? { pipeline_stage: 'replied', inbox_status: 'pending', last_surfaced_reply_at: newMsg.timestamp }
                  : {}),
              })
              .eq('id', match.id)
              .select('id')
              .single();
            if (updateError) console.error('[inbox-routing] agent_leads update error:', updateError.message);
            upsertedLead = updated ?? { id: match.id };
          } else {
            // INSERT — nothing matched any key. Plain insert (not upsert; the
            // partial (user_id, external_id) index makes onConflict inference
            // unreliable).
            updatedThread = [newMsg];
            const { data: inserted, error: insertError } = await supabase
              .from('agent_leads')
              .insert({
                user_id: agentUserId,
                agent_config_id: agentConfig.id,
                external_id: externalId,
                full_name: fullName || 'Unknown',
                email: contactEmail,
                linkedin_url: linkedinUrl,
                company,
                job_title: jobTitle,
                channel,
                source: 'reply_io',
                pipeline_stage: 'replied',
                inbox_status: 'pending',
                last_reply_at: replyAt,
                // New lead lands actionable → seed the surface watermark.
                last_surfaced_reply_at: newMsg.timestamp,
                last_reply_text: replyText,
                // reply_thread NOT written here either — same ownership split.
                // A webhook-created lead therefore has an empty thread until the
                // next poll (<=15 min) populates it. Verified safe: the inbox
                // and pipeline previews read last_reply_text, and LeadDetailPanel
                // renders the thread only when non-empty.
                // Record the source campaign at capture so the inbox shows it for
                // pending leads (not just after Add to Campaign). Set on INSERT
                // only — a later Add to Campaign overwrites with the follow-up.
                last_campaign_name: campaign?.name ?? null,
              })
              .select('id')
              .single();
            if (insertError) console.error('[inbox-routing] agent_leads insert error:', insertError.message);
            upsertedLead = inserted ?? null;
          }

          console.log(`[inbox-routing] upsertedLead=${upsertedLead ? 'ok (id=' + upsertedLead.id + ')' : 'null'}`);

          // Log activity + fire classify-reply ONLY when the reply resurfaces the
          // lead (genuinely-new, non-suppressed). A re-delivery or an opted_out /
          // not_relevant lead records the reply silently without a draft.
          if (resurface && upsertedLead) {
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

            console.log(`[inbox-routing] firing classify-reply for lead_id=${upsertedLead.id}`);
            fireClassifyReply({
              supabaseUrl,
              agentKey: Deno.env.get('AGENT_API_KEY') || '',
              leadId: upsertedLead.id,
              replyText,
              threadHistory: updatedThread,
              agentConfig,
              channel,
              userId: agentUserId,
            });
          } else {
            console.log(`[inbox-routing] reply recorded without resurfacing (resurface=${resurface}) for lead_id=${upsertedLead?.id}`);
          }

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
