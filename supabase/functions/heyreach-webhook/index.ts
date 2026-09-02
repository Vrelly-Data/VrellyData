import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { shouldResurface } from "../_shared/inbox-reply.ts";
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

// ---------------------------------------------------------------------------
// reply_thread merge — guarantees no message dropped between the partial
// (built from event.recent_messages, has the just-arrived prospect reply)
// and the canonical (GetChatroom — has full history but is eventually
// consistent against the webhook and can lag the very reply that triggered
// the webhook).
//
// Merge is strictly additive: every entry from EITHER source either matches
// an existing entry (deduped) or is appended. A lagging GetChatroom can no
// longer remove a reply the partial already reported.
// ---------------------------------------------------------------------------

type ThreadEntry = {
  role: string;
  content: string;
  timestamp: string;
  channel: string;
};

// Same-message tolerance: identical message body can differ slightly in
// timestamp between recent_messages.creation_time (webhook payload) and
// GetChatroom.createdAt (canonical). 2 minutes is generous enough for clock
// skew + propagation delay without conflating two distinct rapid-fire
// messages.
const MERGE_TS_TOLERANCE_MS = 120_000;

// True when two thread entries represent the same logical LinkedIn message.
// When timestamps don't parse, we deliberately return false — a false
// duplicate (cosmetic noise) is acceptable; a false dedup (dropping a
// reply) is not.
function sameMessage(a: ThreadEntry, b: ThreadEntry): boolean {
  if ((a.content ?? "").trim() !== (b.content ?? "").trim()) return false;
  if (a.role !== b.role) return false;
  const at = new Date(a.timestamp).getTime();
  const bt = new Date(b.timestamp).getTime();
  if (Number.isNaN(at) || Number.isNaN(bt)) return false;
  return Math.abs(at - bt) <= MERGE_TS_TOLERANCE_MS;
}

// Newest message timestamp in a thread, as an ISO string, or null when the
// thread is empty or carries no parseable timestamp. Deliberately the same
// quantity poll-heyreach-inbox derives for its resurface gate (a max over the
// thread, not the last array element), so the watermark this webhook writes and
// the value the poller compares against are computed identically.
function newestThreadTimestamp(thread: ThreadEntry[]): string | null {
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: string | null = null;
  for (const e of thread ?? []) {
    const ms = new Date(e?.timestamp ?? "").getTime();
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

function mergeReplyThreads(
  canonical: ThreadEntry[],
  partial: ThreadEntry[],
): ThreadEntry[] {
  // Base = canonical (richer history). Append any partial entry that isn't
  // already represented. This is the strictly-additive guarantee: every
  // distinct partial message ends up in `merged` either by surviving the
  // dedup as a canonical match, or by being pushed.
  const merged: ThreadEntry[] = canonical.slice();
  for (const p of partial) {
    if (!merged.some((m) => sameMessage(m, p))) {
      merged.push(p);
    }
  }
  // Chronological order. Unparseable-timestamp entries fall to the end so
  // they don't get anchored at the start of the conversation.
  merged.sort((a, b) => {
    const at = new Date(a.timestamp).getTime();
    const bt = new Date(b.timestamp).getTime();
    const aOk = !Number.isNaN(at);
    const bOk = !Number.isNaN(bt);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return at - bt;
  });
  return merged;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Optional integration ID trailing the URL path
    // (e.g. /heyreach-webhook/<uuid>). If absent, we resolve it below.
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const lastSegment = pathParts[pathParts.length - 1] ?? "";
    const uuidPattern = /^[0-9a-f-]{36}$/i;
    const urlIntegrationId: string | null = uuidPattern.test(lastSegment)
      ? lastSegment
      : null;

    const payload = await req.text();
    console.log("HeyReach webhook payload:", payload.substring(0, 500));

    // Parse JSON up-front — event.campaignId may be needed to disambiguate
    // when multiple HeyReach integrations exist for a single user/team.
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role for database writes
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve which HeyReach integration this webhook belongs to.
    // Order of preference: (1) explicit UUID in URL → (2) sole active
    // HeyReach integration → (3) disambiguate via synced_campaigns lookup
    // using event.campaignId → (4) error.
    type IntegrationRow = {
      id: string;
      team_id: string;
      is_active: boolean;
      created_by: string;
      api_key_encrypted: string;
      webhook_secret: string | null;
    };
    let integration: IntegrationRow | null = null;

    if (urlIntegrationId) {
      const { data } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, is_active, created_by, api_key_encrypted, webhook_secret")
        .eq("id", urlIntegrationId)
        .eq("platform", "heyreach")
        .maybeSingle();
      integration = (data as IntegrationRow | null) ?? null;
      if (!integration) {
        console.warn(
          `URL integration ID ${urlIntegrationId} not found — falling back to platform lookup`,
        );
      }
    }

    if (!integration) {
      const { data: candidates } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, is_active, created_by, api_key_encrypted, webhook_secret")
        .eq("platform", "heyreach")
        .eq("is_active", true);

      const rows = (candidates ?? []) as IntegrationRow[];

      if (rows.length === 0) {
        console.error("No active HeyReach integration found");
        return new Response(
          JSON.stringify({ error: "No active HeyReach integration" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (rows.length === 1) {
        integration = rows[0];
      } else {
        // Disambiguate multiple integrations via campaign membership
        const campaignExternalIdForLookup = (event as { campaignId?: unknown }).campaignId?.toString();
        if (campaignExternalIdForLookup) {
          const { data: campaignRow } = await supabase
            .from("synced_campaigns")
            .select("integration_id")
            .eq("external_campaign_id", campaignExternalIdForLookup)
            .in("integration_id", rows.map((r) => r.id))
            .maybeSingle();
          if (campaignRow?.integration_id) {
            integration = rows.find((r) => r.id === campaignRow.integration_id) ?? null;
          }
        }

        if (!integration) {
          console.error("Could not disambiguate HeyReach integration", {
            candidates: rows.length,
            campaignId: (event as { campaignId?: unknown }).campaignId,
          });
          return new Response(
            JSON.stringify({
              error:
                "Multiple HeyReach integrations — cannot determine target. Include the integration UUID in the webhook URL path.",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    if (!integration.created_by) {
      console.error("Integration missing created_by");
      return new Response(JSON.stringify({ error: "Integration misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify URL ?secret= against the integration's stored webhook_secret.
    // Backward-compat: if no secret is stored yet, log a warning and accept
    // the request so existing flows don't break during the rollout. Once
    // webhook_secret is populated and the customer's HeyReach webhook URL
    // is updated to include ?secret=<value>, mismatches return 401.
    {
      const providedSecret = url.searchParams.get("secret");
      const expectedSecret = integration.webhook_secret;
      if (expectedSecret) {
        if (providedSecret !== expectedSecret) {
          console.warn(
            `[heyreach-webhook] URL secret mismatch for integration ${integration.id} — rejecting`,
          );
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        console.warn(
          `[heyreach-webhook] No webhook_secret stored for integration ${integration.id} — accepting unauthenticated request (backward-compat). Generate a secret and update the HeyReach webhook URL with ?secret=<value> to enable verification.`,
        );
      }
    }

    // Log the full payload shape so we can see what HeyReach actually sends.
    // Observed in practice: `eventType` / `type` aren't always set; some
    // payloads come through as a conversation snapshot with `recent_messages`
    // and no explicit event type.
    const topLevelKeys = Object.keys(event);
    const keyTypes = Object.fromEntries(
      Object.entries(event).map(([k, v]) => [
        k,
        Array.isArray(v) ? `array[${v.length}]` : typeof v,
      ]),
    );
    console.log("HeyReach payload top-level keys:", topLevelKeys);
    console.log("HeyReach payload key types:", keyTypes);

    // HeyReach webhook event types:
    // EVERY_MESSAGE_REPLY_RECEIVED — a LinkedIn reply came in
    // If eventType isn't explicitly set, infer from payload shape — the
    // presence of a message array / conversation object strongly implies a
    // reply event.
    const looksLikeReplyPayload =
      Array.isArray((event as { recent_messages?: unknown }).recent_messages) ||
      Array.isArray((event as { messages?: unknown }).messages) ||
      !!(event as { conversation?: unknown }).conversation;

    const eventType =
      (event as { eventType?: string }).eventType ||
      (event as { type?: string }).type ||
      (looksLikeReplyPayload ? "EVERY_MESSAGE_REPLY_RECEIVED" : "unknown");

    const campaignExternalId =
      (event as { campaignId?: unknown }).campaignId?.toString() || null;
    console.log(
      `HeyReach event: ${eventType} for integration ${integration.id} (campaignId=${campaignExternalId}, inferred=${!(event as { eventType?: string }).eventType && !(event as { type?: string }).type && looksLikeReplyPayload})`,
    );

    // Log the event (every event, before filtering, for debugging)
    await supabase.from("webhook_events").insert({
      integration_id: integration.id,
      team_id: integration.team_id,
      event_type: eventType,
      contact_email: (event as { lead?: { email_address?: string } }).lead?.email_address || null,
      campaign_external_id: campaignExternalId,
      event_data: event,
    });

    // Filter: only process reply events
    if (eventType !== "EVERY_MESSAGE_REPLY_RECEIVED") {
      console.log(`Ignoring non-reply event: ${eventType}`);
      return new Response(JSON.stringify({ success: true, skipped: "wrong_event_type" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Categorize: campaign reply (matches a synced campaign) vs inbound lead (cold DM).
    // We capture both — inbound LinkedIn DMs are often high-value — but tag them so the
    // agent inbox can separate "replies to our outreach" from "cold inbound leads".
    let leadCategory: "campaign_reply" | "inbound_lead" = "inbound_lead";

    if (campaignExternalId) {
      const { data: syncedCampaign } = await supabase
        .from("synced_campaigns")
        .select("id")
        .eq("integration_id", integration.id)
        .eq("external_campaign_id", campaignExternalId)
        .maybeSingle();

      if (syncedCampaign) {
        leadCategory = "campaign_reply";
      } else {
        console.log(
          `Campaign ${campaignExternalId} not in synced_campaigns — tagging as inbound_lead. ` +
          `Run sync-heyreach-campaigns if this should be a known campaign.`,
        );
      }
    }

    // Extract lead data from HeyReach webhook payload.
    // Field names are snake_case per the observed payload shape (e.g.
    // first_name / profile_url / company_name). Top-level conversation_id
    // and sender.linkedInAccount.id instead of nested conversation object.
    const lead = (event as { lead?: Record<string, unknown> }).lead ?? {};
    const sender = (event as { sender?: Record<string, unknown> }).sender ?? {};

    console.log("HeyReach lead payload keys:", JSON.stringify(Object.keys(lead)));

    const firstName = (lead.first_name as string) || "";
    const lastName = (lead.last_name as string) || "";
    const fullName =
      (lead.full_name as string) ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      null;
    const email = (lead.email_address as string) || null;
    const linkedinUrl = (lead.profile_url as string) || null;
    const jobTitle = (lead.position as string) || null;
    const company = (lead.company_name as string) || null;

    // Top-level conversation_id (not nested under a conversation object)
    const conversationId =
      (event as { conversation_id?: unknown }).conversation_id?.toString() || null;

    // Sender → LinkedIn account ID. HeyReach nests it under sender.linkedInAccount.id,
    // with a flatter sender.id fallback.
    const senderLinkedInAccount = (sender as { linkedInAccount?: { id?: unknown } }).linkedInAccount;
    const accountId =
      senderLinkedInAccount?.id ??
      (sender as { id?: unknown }).id ??
      null;

    // Build reply_thread directly from event.recent_messages — the payload
    // carries the full conversation, so no separate GetChatroom call needed.
    // is_reply === true are prospect messages; everything else is outbound.
    type RawMsg = { message?: string; creation_time?: string; is_reply?: boolean };
    const recentMessages: RawMsg[] = Array.isArray(
      (event as { recent_messages?: unknown }).recent_messages,
    )
      ? ((event as { recent_messages: RawMsg[] }).recent_messages)
      : [];

    const replyThread: Array<{
      role: string;
      content: string;
      timestamp: string;
      channel: string;
    }> = recentMessages.map((msg) => ({
      role: msg.is_reply === true ? "prospect" : "sender",
      content: msg.message || "",
      timestamp: msg.creation_time || new Date().toISOString(),
      channel: "linkedin",
    }));

    // replyText = body of the LAST message in recent_messages, regardless of
    // is_reply. Test payloads from HeyReach's dashboard may not set is_reply
    // correctly, and even real conversations where the webhook fires on an
    // outbound message (edge case) should still populate something. The
    // is_reply → role mapping is still preserved above for thread correctness.
    const lastMessage =
      recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
    const replyText = lastMessage?.message || "";

    // external_id is now informational only; dedup happens on (user_id,
    // linkedin_url) via the partial unique index. Keep it stable per
    // prospect for downstream activity logs and history. Empty fallback
    // chain mirrors the prior behaviour so existing rows still match.
    const externalId = linkedinUrl || conversationId || `heyreach-${Date.now()}`;

    if (!replyText) {
      console.log("recent_messages empty or last message has no content — skipping");
      return new Response(JSON.stringify({ success: true, skipped: "no_message_content" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert into agent_leads. All fields in the payload will overwrite on conflict —
    // including inbox_status, so a new reply on a dismissed/replied/sent lead flips
    // it back to 'pending' and the lead reappears in Pending Approval.
    //
    // Conflict target is (user_id, linkedin_url) — the natural per-prospect
    // identifier on LinkedIn. Empty strings are normalized to NULL so they
    // don't claim a unique slot (Postgres treats multiple NULLs as distinct).
    // Without a linkedin_url we have no dedup key, so skip rather than
    // create runaway rows on every redelivery.
    const linkedinUrlForKey = linkedinUrl && linkedinUrl.trim() ? linkedinUrl.trim() : null;
    if (!linkedinUrlForKey) {
      console.warn(
        `[heyreach-webhook] Skipping upsert — no linkedin_url on payload (conversation_id=${conversationId})`,
      );
      return new Response(
        JSON.stringify({ success: true, skipped: "missing_linkedin_url" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // === Capture Scope gate =================================================
    // Enforcement point 3 of 4 for HeyReach. Mirrors smartlead-webhook: placed
    // immediately before the first agent_leads write so a disabled campaign
    // produces NO lead row at all — not a mirrored one.
    //
    // Fails OPEN on a missing row, a lookup error, or an event with no
    // campaignId at all. HeyReach reply payloads do not always carry one (see
    // the attribution note below), and dropping a real reply because the event
    // was unattributed would be far worse than capturing one the operator can
    // switch off. Only an explicit capture_enabled === false suppresses.
    if (campaignExternalId) {
      const { data: scopeRow, error: scopeErr } = await supabase
        .from("synced_campaigns")
        .select("capture_enabled, name")
        .eq("integration_id", integration.id)
        .eq("external_campaign_id", String(campaignExternalId))
        .maybeSingle();

      if (scopeErr) {
        console.warn(
          `[heyreach-webhook] capture scope lookup failed for campaign ${campaignExternalId} ` +
          `(${scopeErr.message}) — proceeding (fail-open)`,
        );
      } else if (scopeRow && scopeRow.capture_enabled === false) {
        console.log(
          `[heyreach-webhook] capture disabled for campaign ${campaignExternalId} ` +
          `("${scopeRow.name}") — dropping ${eventType} without creating a lead`,
        );
        return new Response(
          JSON.stringify({
            success: true,
            skipped: "capture_disabled",
            campaignId: String(campaignExternalId),
            eventType,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // campaign_external_id is spread CONDITIONALLY (null-clobber guard).
    // PostgREST builds the ON CONFLICT DO UPDATE SET clause only from keys
    // present in the values object — omitting the key means it's not in the
    // SET clause, so the existing row's value is preserved on update. On a
    // brand-new INSERT with no value, the column defaults to NULL (which is
    // the right "unknown" state). Net effect:
    //   * first reply with a campaignId  → attribution written
    //   * later reply WITHOUT a campaignId → existing attribution preserved
    //   * later reply with a DIFFERENT campaignId → attribution overwritten
    //     (this last case is rare; reusing the same prospect across two
    //     campaigns isn't common but the spec is "set", not "first-wins").
    // ---- Surface gate ------------------------------------------------------
    // This upsert used to hard-code inbox_status:'pending' on every delivery,
    // with no notion of whether the reply was NEW. HeyReach re-delivers events:
    // on 2026-08-16 it re-sent the webhook for a 2026-08-04 message, which
    // un-dismissed a lead the operator had already tagged 'in_progress' and
    // spent a full classify-reply call drafting an answer to a message that had
    // already been handled. The live GetChatroom for that conversation held two
    // messages, both from 08-04 — there was no new reply at all.
    //
    // Now mirrors poll-heyreach-inbox exactly, via the same shared
    // shouldResurface, so the two HeyReach paths agree on what "actionable"
    // means and share ONE watermark interlock:
    //   existing lead → resurface only on an inbound that is genuinely newer
    //                   than last_surfaced_reply_at and not suppressed;
    //                   otherwise inbox_status is OMITTED from the payload, so
    //                   an omitted column is preserved on conflict and the
    //                   operator's dismissal stands.
    //   new lead      → surface, unchanged. There is no watermark to compare
    //                   against, and a first-sight inbound reply is actionable.
    const { data: existingLead } = await supabase
      .from("agent_leads")
      .select("id, disposition_tag, last_surfaced_reply_at")
      .eq("user_id", integration.created_by)
      .eq("linkedin_url", linkedinUrlForKey)
      .maybeSingle();

    const newestEntry = replyThread.length > 0
      ? replyThread.reduce((a, b) =>
        Date.parse(b.timestamp || "") > Date.parse(a.timestamp || "") ? b : a
      )
      : null;
    const newestMs = newestEntry ? Date.parse(newestEntry.timestamp || "") : NaN;
    const priorMs = existingLead?.last_surfaced_reply_at
      ? Date.parse(existingLead.last_surfaced_reply_at)
      : 0;
    // NOTE: replyThread falls back to new Date() when a message carries no
    // creation_time, so a timestamp-less payload reads as "now" and surfaces.
    // That is deliberate: failing OPEN risks a redundant draft, failing closed
    // would silently swallow a real reply.
    const newerThanPrior = Number.isFinite(newestMs) && newestMs > priorMs;

    const surface = existingLead
      ? shouldResurface({
        dispositionTag: existingLead.disposition_tag,
        newestRole: newestEntry?.role ?? null,
        newerThanPrior,
      })
      : true;

    console.log(
      `[heyreach-webhook] surface=${surface} existing=${!!existingLead} ` +
        `newestRole=${newestEntry?.role ?? "none"} newest=${newestEntry?.timestamp ?? "none"} ` +
        `prior=${existingLead?.last_surfaced_reply_at ?? "null"} disposition=${existingLead?.disposition_tag ?? "null"}`,
    );

    const { data: upsertedLead, error: upsertError } = await supabase
      .from("agent_leads")
      .upsert(
        {
          user_id: integration.created_by,
          external_id: externalId,
          full_name: fullName,
          email,
          job_title: jobTitle,
          company,
          last_reply_text: cleanReplyPreview(replyText),
          last_reply_at: new Date().toISOString(),
          reply_thread: replyThread,
          // inbox_status + the surface watermark are written ONLY when we are
          // actually surfacing. Omitting a key means it is absent from
          // PostgREST's ON CONFLICT DO UPDATE SET clause, so the stored value
          // survives — which is what makes a dismissal stick.
          //
          // The watermark is the shared interlock with poll-heyreach-inbox:
          // whichever path surfaces first records the message it surfaced FOR,
          // and the other path's `newestMs > priorMs` then reads false and
          // declines to act. Before it was written here, 285 of 291 HeyReach
          // leads carried a NULL watermark, making priorMs 0 and every
          // webhook-handled reply look permanently "new" to the poller.
          ...(surface
            ? {
              inbox_status: "pending",
              last_surfaced_reply_at: newestThreadTimestamp(replyThread) ??
                new Date().toISOString(),
            }
            : {}),
          channel: "linkedin",
          source: "heyreach",
          heyreach_conversation_id: conversationId,
          heyreach_account_id: accountId ? Number(accountId) : null,
          linkedin_url: linkedinUrlForKey,
          ...(campaignExternalId
            ? { campaign_external_id: campaignExternalId }
            : {}),
        },
        { onConflict: "user_id,linkedin_url" },
      )
      .select("id")
      .single();

    if (upsertError) {
      console.error("agent_leads upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to save lead" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Upserted agent_lead ${upsertedLead?.id} for ${fullName || externalId} (linkedin)`);

    // Best-effort full-thread sync: the webhook payload's recent_messages
    // can be a partial slice (real conversations have shown up with only the
    // triggering message), so overwrite reply_thread with the platform's
    // canonical history via GetChatroom. Mirrors poll-heyreach-inbox's
    // proven shape. Errors are logged and non-fatal — we keep the partial
    // thread written above rather than failing the webhook.
    let fullReplyThread: typeof replyThread | null = null;
    if (upsertedLead?.id && accountId && conversationId && integration.api_key_encrypted) {
      try {
        const chatroomRes = await fetch(
          `https://api.heyreach.io/api/public/inbox/GetChatroom/${accountId}/${conversationId}`,
          {
            headers: {
              "X-API-KEY": integration.api_key_encrypted,
              Accept: "application/json",
            },
          },
        );

        if (!chatroomRes.ok) {
          const errBody = await chatroomRes.text().catch(() => "");
          console.warn(
            `[heyreach-webhook] GetChatroom ${chatroomRes.status} for conv ${conversationId} — keeping partial thread. Body: ${errBody.substring(0, 200)}`,
          );
        } else {
          const chatroom = await chatroomRes.json();
          const messages = Array.isArray(chatroom?.messages) ? chatroom.messages : [];

          fullReplyThread = messages.map(
            (msg: { sender?: string; body?: string; createdAt?: string }) => ({
              role: msg.sender === "ME" ? "sender" : "prospect",
              content: msg.body || "",
              timestamp: msg.createdAt || new Date().toISOString(),
              channel: "linkedin",
            }),
          );

          if (fullReplyThread.length > 0) {
            // STRICTLY-ADDITIVE MERGE (bug fix).
            //
            // Previously this branch did `.update({ reply_thread:
            // fullReplyThread })` unconditionally — overwriting the partial
            // we just upserted with GetChatroom's canonical thread. That
            // silently dropped the just-arrived reply whenever GetChatroom
            // lagged behind webhook delivery (eventually-consistent
            // upstream). See the diagnosis attached to this commit.
            //
            // Now we MERGE: canonical first, then any partial entry not
            // already represented (sameMessage compares trimmed content +
            // role + timestamps within MERGE_TS_TOLERANCE_MS). Result is
            // sorted chronologically. A lagging GetChatroom can no longer
            // drop a reply — every entry from `replyThread` survives.
            const canonicalLen = fullReplyThread.length;
            const mergedThread = mergeReplyThreads(
              fullReplyThread,
              replyThread,
            );

            // Keep the watermark in step with the thread we are persisting —
            // but ONLY when this delivery surfaced. On a non-surfacing
            // delivery the thread is still worth storing (it is canonical
            // history), while advancing the watermark would move the interlock
            // for a pend that never happened.
            const { error: threadUpdateErr } = await supabase
              .from("agent_leads")
              .update({
                reply_thread: mergedThread,
                ...(surface && newestThreadTimestamp(mergedThread)
                  ? { last_surfaced_reply_at: newestThreadTimestamp(mergedThread) }
                  : {}),
              })
              .eq("id", upsertedLead.id);

            if (threadUpdateErr) {
              console.warn(
                `[heyreach-webhook] Merged-thread UPDATE failed for lead ${upsertedLead.id}:`,
                threadUpdateErr,
              );
              // Keep the partial that's already in the row from the upsert.
              // Signal to classify-reply (below) to use the partial too.
              fullReplyThread = null;
            } else {
              // Propagate the merged thread to classify-reply so it sees
              // the same view of history that's now persisted on the row.
              fullReplyThread = mergedThread;
              const addedFromPartial = mergedThread.length - canonicalLen;
              console.log(
                `[heyreach-webhook] Merged thread written for lead ${upsertedLead.id} (canonical=${canonicalLen}, partial=${replyThread.length}, added_from_partial=${addedFromPartial}, merged=${mergedThread.length})`,
              );
            }
          } else {
            // GetChatroom returned an empty messages array. Don't overwrite —
            // the partial we wrote at upsert (which has the new reply) is
            // already in the row. Signal classify-reply to use it.
            fullReplyThread = null;
          }
        }
      } catch (chatroomErr) {
        console.error(
          `[heyreach-webhook] Full-thread sync threw for conv ${conversationId}:`,
          chatroomErr,
        );
      }
    }

    // Fire classify-reply asynchronously so the webhook can return 200 fast.
    // Runs after the response thanks to EdgeRuntime.waitUntil.
    //
    // Gated on `surface` for the same reason reply-webhook gates on `resurface`:
    // a re-delivery, or a reply on an opted-out lead, records the message
    // silently and must NOT produce a draft. This is the specific gate that
    // stops the 2026-08-16 case — a re-sent 08-04 event that generated a draft
    // (22,589 input tokens) for a message already handled.
    if (surface && upsertedLead?.id) {
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
              // Prefer the canonical full thread from GetChatroom when the
              // best-effort fetch succeeded; fall back to the partial
              // payload-derived thread otherwise.
              thread_history: fullReplyThread ?? replyThread,
              lead_id: upsertedLead.id,
              user_id: integration.created_by,
              channel: "linkedin",
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
          console.error("classify-reply invocation failed:", err);
        });

        // @ts-ignore — EdgeRuntime is injected by Supabase runtime
        if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
          // @ts-ignore
          EdgeRuntime.waitUntil(classifyPromise);
        } else {
          // Fallback for non-Edge runtimes — await synchronously
          await classifyPromise;
        }
        // Best-effort: record 'replied' inference event (non-blocking)
        try {
          const personKey =
            (email && email.trim() ? email.trim().toLowerCase() : "") ||
            (linkedinUrlForKey && linkedinUrlForKey.trim() ? linkedinUrlForKey.trim() : "") ||
            (externalId ?? "");
          if (personKey) {
            const srid = conversationId
              ? `${conversationId}:${(newestThreadTimestamp(replyThread) ?? new Date().toISOString())}`
              : (externalId ? `${externalId}:${new Date().toISOString()}` : null);
            if (srid) {
              await supabase.from("inference_events").upsert(
                {
                team_id: integration.team_id,
                agent_config_id: agentConfig.id,
                person_key: personKey,
                email: email ? email.trim().toLowerCase() : null,
                linkedin_url: linkedinUrlForKey ?? null,
                full_name: fullName || null,
                job_title: jobTitle || null,
                company_name: company || null,
                channel: "linkedin",
                campaign_external_id: campaignExternalId || null,
                campaign_name: null,
                event_type: "replied",
                intent: null,
                is_objection: null,
                pipeline_stage: "replied",
                disposition_tag: null,
                occurred_at: newestThreadTimestamp(replyThread) ?? new Date().toISOString(),
                source: "heyreach_webhook",
                  source_row_id: srid,
                metadata: { lead_category: leadCategory }
                },
                // @ts-ignore onConflict supports column-list
                { onConflict: "source,source_row_id,event_type" }
              );
            }
          }
        } catch (e) {
          console.warn("[heyreach-webhook] inference_events write failed (non-fatal):", e);
        }
        // Best-effort: upsert people directory snapshot
        try {
          const pkey =
            (email && email.trim() ? email.trim().toLowerCase() : "") ||
            (linkedinUrlForKey && linkedinUrlForKey.trim() ? linkedinUrlForKey.trim() : "") ||
            (externalId ?? "");
          if (pkey) {
            const person: Record<string, unknown> = {
              team_id: integration.team_id,
              person_key: pkey,
              source: "heyreach_webhook",
              last_seen_at: newestThreadTimestamp(replyThread) ?? new Date().toISOString(),
            };
            if (email) person.email = email.trim().toLowerCase();
            if (linkedinUrlForKey) person.linkedin_url = linkedinUrlForKey;
            if (fullName) person.full_name = fullName;
            if (jobTitle) person.job_title = jobTitle;
            if (company) person.company_name = company;
            await supabase.from("people").upsert(person, { onConflict: "team_id,person_key" });
          }
        } catch (e) {
          console.warn("[heyreach-webhook] people upsert failed (non-fatal):", e);
        }
      } else {
        console.log(
          `No active agent_config for user ${integration.created_by} — skipping classify-reply`,
        );
      }
    } else if (upsertedLead?.id) {
      // Reply recorded, status and watermark left alone, no draft. Logged so a
      // suppressed re-delivery is visible rather than looking like a dropped
      // webhook.
      console.log(
        `[heyreach-webhook] reply recorded without surfacing (surface=false) for lead ${upsertedLead.id} — no draft generated`,
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("HeyReach webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
