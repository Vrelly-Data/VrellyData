// [smartlead-webhook v2]
//
// Receives Smartlead webhooks. Primary event is EMAIL_REPLY; we also recognise
// (and gracefully skip) EMAIL_BOUNCE, LEAD_UNSUBSCRIBED, CAMPAIGN_COMPLETED,
// and LEAD_CATEGORY_UPDATED. Anything else is logged and 200-acknowledged so
// Smartlead doesn't retry.
//
// === Real payload shape (EMAIL_REPLY) =====================================
// Captured from a live test event. The named fields below are the canonical
// references — older v1 guesswork (lead.email, payload.reply_body, etc.) does
// NOT match the wire format. Examples:
//   {
//     "event_type": "EMAIL_REPLY",
//     "from_email": "rep@your-domain.com",        // sender mailbox (NOT prospect)
//     "to_email":   "prospect@example.com",       // prospect (the inversion gotcha)
//     "to_name":    "Jane Prospect",
//     "sl_lead_email": "prospect@example.com",    // canonical prospect email
//     "sl_email_lead_id": 121,                    // canonical lead id
//     "sl_email_lead_map_id": 1221,
//     "campaign_id": 100,
//     "campaign_name": "Link insertion",
//     "sent_message":  { "message_id": "<…>", "html": "…", "text": "…", "time": "ISO" },
//     "reply_message": { "message_id": "<…>", "html": "…", "text": "…", "time": "ISO" },
//     "secret_key":   "…",                        // body-level shared secret
//     "webhook_id":   100
//   }
//
// IMPORTANT inversion: from_email is the campaign's SENDER mailbox and
// to_email is the PROSPECT — opposite of what the names suggest in a
// reply context. Always use sl_lead_email as the canonical prospect address.
//
// === Auth ================================================================
// Primary check: URL query param  ?secret=<SMARTLEAD_WEBHOOK_SECRET>
// Optional defence-in-depth: body field  payload.secret_key === <SMARTLEAD_BODY_SECRET>
//
// The body check is OPT-IN — only enforced when SMARTLEAD_BODY_SECRET is
// configured. Smartlead's dashboard test payload sends the literal string
// "secretkey" as a placeholder, and at time of writing it isn't confirmed
// whether owners can pick a real value for that body field. Requiring a body
// match by default would risk rejecting real webhooks. Once we confirm
// Smartlead supports a configurable body secret, set SMARTLEAD_BODY_SECRET
// and the second check activates automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchSmartleadThread,
  loadSenderNameLookup,
  stripZendeskMarker,
  type ThreadMessage,
} from "../_shared/smartlead-thread.ts";
import { htmlToText } from "../_shared/html-to-text.ts";
import { cleanReplyPreview } from "../_shared/reply-text.ts";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

// Strip the Zendesk-style "type your reply above this line" marker plus
// anything after it. Full quoted-chain stripping (Gmail/Outlook headers,
// "On <date> <name> wrote:" blocks, etc.) is deferred to Phase C in
// classify-reply preprocessing.
const SKIPPABLE_EVENTS = new Set([
  "EMAIL_BOUNCE",
  "LEAD_UNSUBSCRIBED",
  "CAMPAIGN_COMPLETED",
  "LEAD_CATEGORY_UPDATED",
]);

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === Auth check 1: URL query secret =====================================
    const url = new URL(req.url);
    const providedUrlSecret = url.searchParams.get("secret");
    const expectedUrlSecret = Deno.env.get("SMARTLEAD_WEBHOOK_SECRET");

    if (!expectedUrlSecret) {
      console.error(
        "[smartlead-webhook v2] SMARTLEAD_WEBHOOK_SECRET env var not set — refusing all requests until configured",
      );
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured on server" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (providedUrlSecret !== expectedUrlSecret) {
      console.warn("[smartlead-webhook v2] URL secret mismatch — rejecting request");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Payload parsing ====================================================
    const rawText = await req.text();
    console.log(
      "[smartlead-webhook v2] Raw payload (first 2000 chars):",
      rawText.substring(0, 2000),
    );

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawText);
    } catch {
      console.error("[smartlead-webhook v2] Invalid JSON payload");
      return new Response(
        JSON.stringify({ success: false, error: "invalid_json" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Auth check 2 (optional): body-level secret ========================
    // Opt-in defence-in-depth. Only enforced when SMARTLEAD_BODY_SECRET is
    // explicitly set. Reasoning lives in the top-of-file docstring; tl;dr:
    // Smartlead test payloads use a literal "secretkey" placeholder and
    // configurability isn't yet confirmed, so we don't enforce by default.
    const expectedBodySecret = Deno.env.get("SMARTLEAD_BODY_SECRET");

    if (expectedBodySecret) {
      console.log(
        "[smartlead-webhook v2] Body secret check: ENABLED (SMARTLEAD_BODY_SECRET set)",
      );
      const providedBodySecret =
        (payload.secret_key as string | undefined) ?? null;

      if (providedBodySecret !== expectedBodySecret) {
        console.warn(
          "[smartlead-webhook v2] Body secret_key mismatch — rejecting request",
        );
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.log(
        "[smartlead-webhook v2] Body secret check: SKIPPED (SMARTLEAD_BODY_SECRET unset — URL-only auth mode)",
      );
    }

    // === Event type detection ===============================================
    const eventType = ((payload.event_type as string) || "unknown").toString();
    console.log(`[smartlead-webhook v2] eventType="${eventType}"`);

    // === DB client ==========================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Always log the raw event before filtering. integration_id / team_id are
    // resolved further down; webhook_events.team_id and integration_id NOT
    // NULL constraint fix is tracked separately.
    try {
      await supabase.from("webhook_events").insert({
        integration_id: null,
        team_id: null,
        event_type: `smartlead:${eventType}`,
        event_data: payload,
      });
    } catch (logErr) {
      console.warn(
        "[smartlead-webhook v2] webhook_events insert failed (non-fatal):",
        logErr,
      );
    }

    // === Skip non-reply events gracefully ===================================
    if (SKIPPABLE_EVENTS.has(eventType)) {
      console.log(
        `[smartlead-webhook v2] Event "${eventType}" recognised but not actioned — acknowledged`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "non_reply_event", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (eventType !== "EMAIL_REPLY") {
      console.log(
        `[smartlead-webhook v2] Unrecognised eventType "${eventType}" — acknowledged but not processed`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "unknown_event", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === EMAIL_REPLY extraction =============================================
    const replyMessage =
      (payload.reply_message as Record<string, unknown> | undefined) ?? {};

    const emailRaw =
      (payload.sl_lead_email as string | undefined) ??
      (payload.to_email as string | undefined) ??
      null;
    const email = emailRaw ? emailRaw.toLowerCase() : null;

    // to_name is DIRECTIONAL, exactly like to_email — the same inversion the
    // header documents, which was fixed for the address and missed for the name.
    //
    // to_name describes whoever the message was addressed TO, which is the
    // prospect only when Smartlead reports OUR outbound. On the prospect's
    // reply the message is addressed to US, so to_name is our own sender —
    // and because the webhook fires on every message, the last one to arrive
    // won. That is how "Alia Ballout" (a SourceCo sender) ended up as the
    // contact name on costa@actioncolors.com.
    //
    // The test is directional, not a name blacklist: trust to_name ONLY when
    // to_email IS the canonical prospect. Verified against all 177 stored
    // production payloads — 150 trustworthy, 27 correctly rejected, and every
    // rejected value was either one of our senders (Mason Ruppel, Max Garside,
    // Alia Ballout), a bounce daemon, or a no-reply address.
    //
    // A rejected name yields null, and null is STRIPPED from the upsert below,
    // so a good stored name is never overwritten by a bad one. 17 prospects
    // have no trustworthy name in any event; they keep whatever they already
    // have rather than being blanked.
    const toEmailForName = (payload.to_email as string | undefined)?.trim().toLowerCase() ?? null;
    const toNameRaw = (payload.to_name as string | undefined)?.trim() || null;
    const nameIsForProspect = !!email && !!toEmailForName && toEmailForName === email;
    const fullName = nameIsForProspect ? toNameRaw : null;

    if (toNameRaw && !nameIsForProspect) {
      console.log(
        `[smartlead-webhook v2] to_name "${toNameRaw}" ignored — addressed to ${toEmailForName}, not the prospect (${email})`,
      );
    }

    // The SENDER mailbox (inversion gotcha: from_email is OURS, not the
    // prospect's). Used to attribute the reply to the mailbox's mapped sender
    // (email_sender_mailboxes), so one sender's many mailboxes collapse to one
    // sender in the pipeline filter + the correct draft voice.
    const fromEmailRaw = (payload.from_email as string | undefined) ?? null;
    const fromEmail = fromEmailRaw ? fromEmailRaw.trim().toLowerCase() : null;

    const smartleadLeadId =
      payload.sl_email_lead_id !== undefined && payload.sl_email_lead_id !== null
        ? String(payload.sl_email_lead_id)
        : null;
    const smartleadCampaignId =
      payload.campaign_id !== undefined && payload.campaign_id !== null
        ? String(payload.campaign_id)
        : null;
    const lastCampaignName = (payload.campaign_name as string | undefined) ?? null;

    const replyMessageId = (replyMessage.message_id as string | undefined) ?? null;
    const replyHtml = (replyMessage.html as string | undefined) ?? null;
    const replyTextRaw = (replyMessage.text as string | undefined) ?? null;
    const replyTimestamp =
      (replyMessage.time as string | undefined) ?? new Date().toISOString();

    // email_stats_id: undocumented but required by Smartlead's
    // POST /campaigns/{id}/reply-email-thread endpoint. The webhook payload
    // ships it as `stats_id` (top-level); we tolerate a few likely synonyms
    // in case Smartlead changes the name. Stored on agent_leads so
    // send-smartlead-email can forward it.
    const smartleadEmailStatsId =
      ((payload.stats_id ??
        payload.email_stats_id ??
        (replyMessage.stats_id as unknown)) as string | number | undefined) !==
      undefined
        ? String(
            payload.stats_id ??
              payload.email_stats_id ??
              (replyMessage.stats_id as unknown),
          )
        : null;

    // Prefer the plain-text body; fall back to htmlToText if Smartlead ever
    // omits .text. The bare tag-strip this replaced left <style> CONTENTS
    // behind as literal CSS and decoded no entities — see the matching note in
    // _shared/smartlead-thread.ts. Zendesk-style "type your reply above this
    // line" marker and anything after it is dropped here; full quoted-chain
    // stripping is Phase C work in classify-reply preprocessing.
    const replyText = stripZendeskMarker(
      replyTextRaw ?? (replyHtml ? htmlToText(replyHtml) : ""),
    );

    if (!email) {
      console.warn(
        "[smartlead-webhook v2] No prospect email in EMAIL_REPLY payload — skipping",
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "no_email", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Route to an integration ============================================
    // The Smartlead payload carries nothing that identifies which of OUR
    // integrations it belongs to, so routing is driven by a per-integration
    // token we put in the callback URL at registration time:
    //
    //   .../smartlead-webhook?secret=<SMARTLEAD_WEBHOOK_SECRET>&t=<webhook_secret>
    //
    // `t` maps 1:1 to outbound_integrations.webhook_secret, so an event can
    // only ever land on the client whose campaign it was registered against.
    //
    // This REPLACES a "pick the most recently created active smartlead
    // integration" guess. That guess was a live cross-tenant defect: Vrelly's
    // own Smartlead account has a webhook registered from 2026-04-27, and once
    // SourceCo's integration was created (2026-07-26) it became the sole active
    // row — so replies to Vrelly's OWN outbound would have been written into
    // SourceCo's inbox.
    //
    // There is deliberately NO fallback. An untokenized or unknown-token event
    // is logged and 200-acknowledged WITHOUT writing anything: dropping a reply
    // is recoverable (the backfill and poller both re-find it), whereas filing
    // one prospect's reply under another client's account is not. The legacy
    // untokenized webhook on Vrelly's own account therefore stops resolving,
    // which is the intended trade.
    const routingToken = url.searchParams.get("t");

    if (!routingToken) {
      console.warn(
        "[smartlead-webhook v2] No routing token (?t=) on the callback URL — " +
        "refusing to guess an integration. Re-register this webhook via " +
        "setup-smartlead-webhook to attach a token. Event dropped (not written).",
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "no_routing_token", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: integration } = await supabase
      .from("outbound_integrations")
      .select("id, name, team_id, created_by, api_key_encrypted")
      .eq("platform", "smartlead")
      .eq("is_active", true)
      .eq("webhook_secret", routingToken)
      .maybeSingle();

    if (!integration?.created_by || !integration?.team_id) {
      console.warn(
        `[smartlead-webhook v2] Routing token did not match any active Smartlead ` +
        `integration (token suffix …${routingToken.slice(-6)}). Event dropped ` +
        `(not written) rather than routed to a guessed tenant.`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "unknown_routing_token", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[smartlead-webhook v2] Routed to integration "${integration.name}" ` +
      `(${integration.id}) via token`,
    );

    // Resolve the sender for THIS reply's mailbox (from_email → mapped
    // sender_name). NULL when the mailbox is unmapped or unknown — then the
    // sender entry carries no fromName and lands in the "Unmapped" filter
    // rather than spawning a per-mailbox sender.
    // One user-scoped lookup serves both the seed below and the history mapper.
    // Previously this resolved a SINGLE address and applied that one name to
    // every outbound message in the thread — wrong once a thread spans two
    // mailboxes. The shared lookup resolves per message.
    const senderNameFor = await loadSenderNameLookup(supabase, integration.created_by);
    const mailboxSenderName: string | null = senderNameFor(fromEmail);

    // === Build reply_thread (single-message seed) ===========================
    // The EMAIL_REPLY payload only carries the latest reply_message (and an
    // unrelated sent_message), so this is just a seed. The post-upsert
    // best-effort fetch from Smartlead's /message-history endpoint below
    // overwrites reply_thread with the full canonical history.
    const replyThread = [
      {
        role: "prospect",
        content: replyText,
        timestamp: replyTimestamp,
        channel: "email",
      },
    ];

    // === Capture Scope gate =================================================
    // Enforcement point 3 of 4, and the one that actually makes the feature
    // safe. Points 1 and 2 stop us CREATING a registration; this stops us
    // ACTING on an event, which still arrives when a deregistration failed,
    // when a webhook was added in Smartlead's own UI, or in the window before
    // a disable propagates.
    //
    // Placed immediately before the first write to agent_leads and after the
    // integration lookup, so a disabled campaign produces NO lead row at all —
    // not a mirrored one. That was the explicit product decision: capture off
    // means full silence, not quiet record-keeping.
    //
    // Fail OPEN on a missing row or a lookup error: an unknown campaign is one
    // the sync has not caught up with yet, and dropping a real reply is worse
    // than capturing one the operator may later switch off. Only an explicit
    // capture_enabled === false suppresses.
    if (smartleadCampaignId) {
      const { data: scopeRow, error: scopeErr } = await supabase
        .from("synced_campaigns")
        .select("capture_enabled, name")
        .eq("integration_id", integration.id)
        .eq("external_campaign_id", String(smartleadCampaignId))
        .maybeSingle();

      if (scopeErr) {
        console.warn(
          `[smartlead-webhook v2] capture scope lookup failed for campaign ` +
          `${smartleadCampaignId} (${scopeErr.message}) — proceeding (fail-open)`,
        );
      } else if (scopeRow && scopeRow.capture_enabled === false) {
        console.log(
          `[smartlead-webhook v2] capture disabled for campaign ` +
          `${smartleadCampaignId} ("${scopeRow.name}") — dropping ${eventType} ` +
          `without creating a lead`,
        );
        return new Response(
          JSON.stringify({
            success: true,
            skipped: "capture_disabled",
            campaignId: String(smartleadCampaignId),
            eventType,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // === Upsert agent_leads =================================================
    // Dedup on (user_id, email_address) — the natural per-prospect identifier
    // for email. external_id stays informational. Empty/missing email is
    // skipped above; here we additionally normalize so '' never claims a
    // unique slot.
    const externalId = email;
    const emailForKey = email && email.trim() ? email.trim().toLowerCase() : null;
    if (!emailForKey) {
      console.warn(
        "[smartlead-webhook v2] Skipping upsert — no email_address on payload",
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "missing_email_address" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Best-effort lead enrichment ========================================
    // Smartlead's reply webhook carries only to_name — no company, job_title,
    // or linkedin. Fetch those from the leads-by-email endpoint so email leads
    // get the same prospect context HeyReach leads already have (HeyReach gets
    // them free in its payload; Smartlead doesn't).
    //
    // Enrich-only-when-missing: if the existing row already has all three
    // fields, skip the fetch so we don't hit Smartlead's API on every reply to
    // an already-enriched lead.
    //
    // api_key in QUERY STRING — never log the URL (it contains the credential).
    let gotEnrichment = false;
    let enrichedCompany: string | null = null;
    let enrichedLinkedin: string | null = null;
    let enrichedJobTitle: string | null = null;

    const { data: existingLead } = await supabase
      .from("agent_leads")
      .select("job_title, company, linkedin_url")
      .eq("user_id", integration.created_by)
      .eq("email_address", emailForKey)
      .maybeSingle();

    const alreadyEnriched =
      !!existingLead?.job_title &&
      !!existingLead?.company &&
      !!existingLead?.linkedin_url;

    if (alreadyEnriched) {
      console.log(
        `[smartlead-webhook v2] Lead already enriched (email=${email}) — skipping enrichment fetch`,
      );
    } else if (integration.api_key_encrypted) {
      const enrichController = new AbortController();
      const enrichTimeout = setTimeout(() => enrichController.abort(), 5000);
      try {
        const leadsUrl = new URL("https://server.smartlead.ai/api/v1/leads/");
        leadsUrl.searchParams.set("api_key", integration.api_key_encrypted);
        leadsUrl.searchParams.set("email", emailForKey);

        const enrichRes = await fetch(leadsUrl.toString(), {
          headers: { Accept: "application/json" },
          signal: enrichController.signal,
        });

        if (!enrichRes.ok) {
          const errBody = await enrichRes.text().catch(() => "");
          console.warn(
            `[smartlead-webhook v2] lead enrichment ${enrichRes.status} for email=${email} — proceeding without. Body: ${errBody.substring(0, 200)}`,
          );
        } else {
          const body = await enrichRes.json();
          // Shape isn't guaranteed — the endpoint may return an object or a
          // single-element array. Handle both; null-fallback every field.
          const lead = (Array.isArray(body) ? body[0] : body) as
            | {
                company_name?: string | null;
                linkedin_profile?: string | null;
                custom_fields?: { job_title?: string | null } | null;
              }
            | null
            | undefined;
          enrichedCompany = lead?.company_name ?? null;
          enrichedLinkedin = lead?.linkedin_profile ?? null;
          enrichedJobTitle = lead?.custom_fields?.job_title ?? null;
          gotEnrichment = true;
          console.log(
            `[smartlead-webhook v2] Enriched email=${email} (company=${enrichedCompany ? "y" : "n"}, title=${enrichedJobTitle ? "y" : "n"}, linkedin=${enrichedLinkedin ? "y" : "n"})`,
          );
        }
      } catch (enrichErr) {
        console.warn(
          `[smartlead-webhook v2] lead enrichment fetch failed for email=${email} (proceeding without):`,
          enrichErr,
        );
      } finally {
        clearTimeout(enrichTimeout);
      }
    }

    // Build the upsert row. Only include the enrichment columns when a fetch
    // actually succeeded — otherwise omit them so the upsert preserves any
    // existing values (a skipped or failed fetch must never overwrite good
    // data with null). On success, prefer the fresh value, fall back to the
    // existing stored value, and never downgrade a populated field to null.
    const leadRow: Record<string, unknown> = {
      user_id: integration.created_by,
      external_id: externalId,
      email,
      email_address: emailForKey,
      // Spread-conditional, NOT `full_name: fullName`. PostgREST builds the
      // ON CONFLICT DO UPDATE SET clause only from keys present in the object,
      // so omitting it preserves the stored value; writing null would clobber a
      // good name on every inverted event — turning one bug into a worse one.
      // Same null-clobber guard as campaign_external_id in heyreach-webhook.
      ...(fullName ? { full_name: fullName } : {}),
      channel: "email",
      source: "smartlead",
      smartlead_lead_id: smartleadLeadId,
      smartlead_campaign_id: smartleadCampaignId,
      smartlead_email_stats_id: smartleadEmailStatsId,
      last_campaign_name: lastCampaignName,
      reply_message_id: replyMessageId,
      last_reply_text: cleanReplyPreview(replyText),
      last_reply_raw_html: replyHtml,
      last_reply_at: replyTimestamp,
      reply_thread: replyThread,
      inbox_status: "pending",
    };
    if (gotEnrichment) {
      leadRow.job_title = enrichedJobTitle ?? existingLead?.job_title ?? null;
      leadRow.company = enrichedCompany ?? existingLead?.company ?? null;
      leadRow.linkedin_url = enrichedLinkedin ?? existingLead?.linkedin_url ?? null;
    }

    const { data: upsertedLead, error: upsertError } = await supabase
      .from("agent_leads")
      .upsert(leadRow, { onConflict: "user_id,email_address" })
      .select("id")
      .single();

    if (upsertError) {
      console.error("[smartlead-webhook v2] agent_leads upsert error:", upsertError);
      // 200 so Smartlead doesn't retry; we've logged for investigation.
      return new Response(
        JSON.stringify({ success: false, error: "upsert_failed", eventType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `[smartlead-webhook v2] Upserted agent_lead ${upsertedLead?.id} for email=${email}`,
    );

    // === Best-effort full-thread sync =======================================
    // The upsert payload only carries the latest reply, so replace the seed with
    // Smartlead's canonical history. Errors are non-fatal — the seed stays and
    // the webhook still returns 200.
    //
    // DELEGATED to _shared/smartlead-thread.ts, which poll-smartlead-inbox also
    // calls. This block used to be an inline copy, and the copy was WRONG: it
    // read a bare array with `body`/`timestamp`, while the API returns
    // {"history":[…]} with `email_body`/`time`. Array.isArray() was therefore
    // always false, messages was always empty, and this "canonical history"
    // overwrite NEVER ONCE EXECUTED — every Smartlead lead kept only the
    // single-message seed. Two implementations of one mapping is what allowed
    // that to go unnoticed for months; there is now exactly one.
    let fullReplyThread: ThreadMessage[] | null = null;
    if (
      upsertedLead?.id &&
      smartleadCampaignId &&
      smartleadLeadId &&
      integration.api_key_encrypted
    ) {
      try {
        const history = await fetchSmartleadThread({
          apiKey: integration.api_key_encrypted,
          campaignId: String(smartleadCampaignId),
          leadId: String(smartleadLeadId),
          // Preserves any role:'system' breadcrumb (add-to-smartlead-campaign)
          // that the API cannot return and a plain overwrite would destroy.
          localThread: replyThread as ThreadMessage[],
          senderNameFor,
        });

        if (!history.thread) {
          console.warn(
            `[smartlead-webhook v2] message-history ${history.status} / empty for campaign=${smartleadCampaignId} lead=${smartleadLeadId} — keeping seed thread`,
          );
        } else {
          const { error: threadUpdateErr } = await supabase
            .from("agent_leads")
            .update({ reply_thread: history.thread })
            .eq("id", upsertedLead.id);

          if (threadUpdateErr) {
            console.warn(
              `[smartlead-webhook v2] Full-thread UPDATE failed for lead ${upsertedLead.id}:`,
              threadUpdateErr,
            );
          } else {
            fullReplyThread = history.thread;
            console.log(
              `[smartlead-webhook v2] Synced full thread (${history.thread.length} msgs) for lead ${upsertedLead.id}`,
            );
          }
        }
      } catch (historyErr) {
        console.error(
          `[smartlead-webhook v2] Full-thread sync threw for campaign=${smartleadCampaignId} lead=${smartleadLeadId}:`,
          historyErr,
        );
      }
    }

    // === classify-reply (async) =============================================
    // Mirrors heyreach-webhook: fire classify-reply asynchronously via
    // EdgeRuntime.waitUntil so the webhook returns 200 to Smartlead fast.
    // Gated on an active agent_config — without one, classify-reply has no
    // sender persona / offer copy to work with, so we just leave the lead
    // as inbox_status='pending' for manual handling.
    //
    // Empty-text guard: Smartlead's dashboard test fixture (and rare real-
    // world cases like prospects replying with only quoted history) results
    // in replyText collapsing to "" after Zendesk-marker stripping. We
    // upsert the row regardless (metadata like smartlead_lead_id /
    // reply_message_id is still useful for the inbox) but skip classify-
    // reply, since classify-reply rejects empty reply_text with 400.
    if (upsertedLead?.id) {
      const hasReplyContent = !!replyText && replyText.trim().length > 0;

      if (!hasReplyContent) {
        console.log(
          `[smartlead-webhook v2] Empty reply text, skipping classification for lead ${upsertedLead.id}`,
        );
      } else {
        const { data: agentConfig } = await supabase
          .from("agent_configs")
          .select("*")
          .eq("user_id", integration.created_by)
          .eq("is_active", true)
          .maybeSingle();

        if (agentConfig) {
          const agentApiKey = Deno.env.get("AGENT_API_KEY") || "";
          const classifyPromise = fetch(
            `${supabaseUrl}/functions/v1/classify-reply`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-agent-key": agentApiKey,
              },
              body: JSON.stringify({
                reply_text: replyText,
                // Prefer the canonical full thread from /message-history when
                // the best-effort fetch succeeded; fall back to the seed
                // thread otherwise.
                thread_history: fullReplyThread ?? replyThread,
                lead_id: upsertedLead.id,
                user_id: integration.created_by,
                channel: "email",
                agent_context: {
                  offer_description: agentConfig.offer_description,
                  desired_action: agentConfig.desired_action,
                  outcome_delivered: agentConfig.outcome_delivered,
                  target_icp: agentConfig.target_icp,
                  sender_name: agentConfig.sender_name,
                  sender_title: agentConfig.sender_title,
                  sender_linkedin: agentConfig.sender_linkedin || "",
                  sender_bio: agentConfig.sender_bio,
                  company_name: agentConfig.company_name,
                  company_url: agentConfig.company_url,
                  communication_style: agentConfig.communication_style,
                  avoid_phrases: agentConfig.avoid_phrases || [],
                  sample_message: agentConfig.sample_message || "",
                  calendar_link: agentConfig.calendar_link || "",
                  pricing_summary: agentConfig.pricing_summary || "",
                  case_studies: agentConfig.case_studies || "",
                  disqualification_criteria: agentConfig.disqualification_criteria || "",
                  objection_handling_notes: agentConfig.objection_handling_notes || "",
                },
              }),
            },
          ).catch((err) => {
            console.error("[smartlead-webhook v2] classify-reply invocation failed:", err);
          });

          // @ts-ignore — EdgeRuntime is injected by Supabase runtime
          if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
            // @ts-ignore
            EdgeRuntime.waitUntil(classifyPromise);
          } else {
            await classifyPromise;
          }
          // Best-effort: record 'replied' inference event (non-blocking)
          try {
            const personKey =
              (emailForKey && emailForKey.trim() ? emailForKey.trim().toLowerCase() : "") ||
              (externalId ?? "");
            if (personKey && replyMessageId) {
              const writes: Array<Promise<unknown>> = [];
              writes.push(
                supabase.from("inference_events").upsert(
                  {
                    team_id: integration.team_id,
                    agent_config_id: agentConfig.id,
                    person_key: personKey,
                    email: emailForKey ? emailForKey.trim().toLowerCase() : null,
                    linkedin_url: enrichedLinkedin ?? null,
                    full_name: fullName || null,
                    job_title: (enrichedJobTitle ?? existingLead?.job_title) || null,
                    company_name: (enrichedCompany ?? existingLead?.company) || null,
                    channel: "email",
                    campaign_external_id: smartleadCampaignId || null,
                    campaign_name: lastCampaignName || null,
                    event_type: "replied",
                    intent: null,
                    is_objection: null,
                    pipeline_stage: "replied",
                    disposition_tag: null,
                    occurred_at: replyTimestamp || new Date().toISOString(),
                    source: "smartlead_webhook",
                    source_row_id: replyMessageId,
                    metadata: { mail_sender: fromEmail }
                  },
                  // @ts-ignore onConflict supports column-list; partial unique index handles non-null source_row_id
                  { onConflict: "source,source_row_id,event_type" }
                ).then(({ error }) => {
                  if (error) {
                    console.warn("[smartlead-webhook v2] inference_events upsert error (non-fatal):", error);
                  }
                })
              );
              // Optional additive people upsert (non-fatal)
              writes.push(
                // @ts-ignore onConflict supports column-list
                supabase.from("people").upsert(
                  {
                    team_id: integration.team_id,
                    person_key: personKey,
                    email: emailForKey ? emailForKey.trim().toLowerCase() : null,
                    linkedin_url: enrichedLinkedin ?? null,
                    full_name: fullName || null,
                    job_title: (enrichedJobTitle ?? existingLead?.job_title) || null,
                    company_name: (enrichedCompany ?? existingLead?.company) || null,
                    industry: null,
                    city: null,
                    state: null,
                    country: null,
                    company_size: null,
                  } as any,
                  { onConflict: "team_id,person_key" }
                )
              );
              // @ts-ignore EdgeRuntime is injected by Supabase runtime
              if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
                // @ts-ignore
                EdgeRuntime.waitUntil(Promise.allSettled(writes));
              } else {
                await Promise.allSettled(writes);
              }
            } // else skip when no stable id
          } catch (e) {
            console.warn("[smartlead-webhook v2] inference_events write failed (non-fatal):", e);
          }
        } else {
          console.log(
            `[smartlead-webhook v2] No active agent_config for user ${integration.created_by} — skipping classify-reply`,
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, eventType, leadId: upsertedLead?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[smartlead-webhook v2] Fatal error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
