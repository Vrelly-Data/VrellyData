import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    };
    let integration: IntegrationRow | null = null;

    if (urlIntegrationId) {
      const { data } = await supabase
        .from("outbound_integrations")
        .select("id, team_id, is_active, created_by, api_key_encrypted")
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
        .select("id, team_id, is_active, created_by, api_key_encrypted")
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

    // replyText = last incoming reply's body. If no incoming message exists
    // in the thread, we skip — there's nothing new from the prospect to act on.
    const lastIncomingReply = [...recentMessages]
      .reverse()
      .find((m) => m.is_reply === true);
    const replyText = lastIncomingReply?.message || "";

    // external_id prefers the LinkedIn profile URL (stable per prospect across
    // conversations); falls back to conversation_id, then a timestamp so the
    // upsert can still land on a unique row even with minimal data.
    const externalId = linkedinUrl || conversationId || `heyreach-${Date.now()}`;

    if (!replyText) {
      console.log("No reply text in recent_messages (no is_reply=true message) — skipping");
      return new Response(JSON.stringify({ success: true, skipped: "no_incoming_reply" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert into agent_leads. All fields in the payload will overwrite on conflict —
    // including inbox_status, so a new reply on a dismissed/replied/sent lead flips
    // it back to 'pending' and the lead reappears in Pending Approval.
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
          last_reply_text: replyText,
          last_reply_at: new Date().toISOString(),
          reply_thread: replyThread,
          inbox_status: "pending",
          channel: "linkedin",
          lead_category: leadCategory,
          heyreach_conversation_id: conversationId,
          heyreach_account_id: accountId ? Number(accountId) : null,
          linkedin_url: linkedinUrl,
        },
        { onConflict: "user_id,external_id" },
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

    // Fire classify-reply asynchronously so the webhook can return 200 fast.
    // Runs after the response thanks to EdgeRuntime.waitUntil.
    if (upsertedLead?.id) {
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
              thread_history: replyThread,
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
                sender_bio: agentConfig.sender_bio,
                company_name: agentConfig.company_name,
                company_url: agentConfig.company_url,
                communication_style: agentConfig.communication_style,
                avoid_phrases: agentConfig.avoid_phrases || [],
                sample_message: agentConfig.sample_message || "",
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
      } else {
        console.log(
          `No active agent_config for user ${integration.created_by} — skipping classify-reply`,
        );
      }
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
