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
    // Extract integration ID from URL path (e.g. /heyreach-webhook/<integrationId>)
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    const integrationId = pathParts[pathParts.length - 1];

    if (!integrationId || integrationId === "heyreach-webhook") {
      return new Response(JSON.stringify({ error: "Missing integration ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.text();
    console.log("HeyReach webhook payload:", payload.substring(0, 500));

    // Service role for database writes
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify integration exists
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, is_active, created_by, api_key_encrypted")
      .eq("id", integrationId)
      .eq("platform", "heyreach")
      .single();

    if (integrationError || !integration) {
      console.error("HeyReach integration not found:", integrationId);
      return new Response(JSON.stringify({ error: "Integration not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!integration.created_by) {
      console.error("Integration missing created_by");
      return new Response(JSON.stringify({ error: "Integration misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // HeyReach webhook event types:
    // EVERY_MESSAGE_REPLY_RECEIVED — a LinkedIn reply came in
    const eventType = event.eventType || event.type || "unknown";
    const campaignExternalId = event.campaignId?.toString() || null;
    console.log(`HeyReach event: ${eventType} for integration ${integrationId} (campaignId=${campaignExternalId})`);

    // Log the event (every event, before filtering, for debugging)
    await supabase.from("webhook_events").insert({
      integration_id: integrationId,
      team_id: integration.team_id,
      event_type: eventType,
      contact_email: event.lead?.emailAddress || null,
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
        .eq("integration_id", integrationId)
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

    // Extract lead data from HeyReach webhook payload
    const lead = event.lead || {};
    const conversation = event.conversation || {};

    // Log observed lead field keys so we can confirm HeyReach's actual payload
    // shape against our extraction assumptions (inspect in Supabase function logs).
    console.log("HeyReach lead payload keys:", JSON.stringify(Object.keys(lead)));

    const firstName = lead.firstName || "";
    const lastName = lead.lastName || "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
    const email = lead.emailAddress || null;
    const linkedinUrl = lead.profileUrl || lead.linkedInProfileUrl || null;
    const replyText = event.messageText || event.message || conversation.lastMessageText || "";

    // Job title + company — field names inferred from LinkedIn-adjacent conventions
    // and from poll-heyreach-inbox which uses `companyName` on correspondentProfile.
    // Defensive fallbacks try multiple likely keys; adjust once real payloads
    // surface in webhook_events / console logs.
    const jobTitle =
      lead.headline || lead.title || lead.jobTitle || lead.position || null;
    const company =
      lead.companyName || lead.company || lead.currentCompany || null;

    // Use lead's HeyReach ID or LinkedIn URL as external_id
    const externalId = lead.id?.toString() || linkedinUrl || `heyreach-${Date.now()}`;

    // Conversation and account IDs for sending replies
    const conversationId = conversation.id?.toString() || event.conversationId?.toString() || null;
    const accountId = event.linkedInAccountId || conversation.linkedInAccountId || null;

    if (!replyText) {
      console.log("No reply text in event, skipping agent_leads upsert");
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch full chatroom thread so reply_thread reflects the latest conversation.
    // Mirrors the approach in poll-heyreach-inbox so webhook-captured and
    // polling-captured leads produce identical thread structures.
    let replyThread: Array<{ role: string; content: string; timestamp: string; channel: string }> = [];
    if (accountId && conversationId && integration.api_key_encrypted) {
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
        if (chatroomRes.ok) {
          const chatroom = await chatroomRes.json();
          const messages = chatroom.messages || [];
          replyThread = messages.map(
            (msg: { sender?: string; body?: string; createdAt?: string }) => ({
              role: msg.sender === "ME" ? "sender" : "prospect",
              content: msg.body || "",
              timestamp: msg.createdAt || new Date().toISOString(),
              channel: "linkedin",
            }),
          );
        } else {
          console.warn(`GetChatroom returned ${chatroomRes.status} for conv ${conversationId}`);
        }
      } catch (chatroomErr) {
        console.error(`Failed to fetch chatroom for ${conversationId}:`, chatroomErr);
      }
    }

    // Fallback: if chatroom fetch failed or returned empty, at least include
    // the incoming reply itself so reply_thread is never empty on an upsert.
    if (replyThread.length === 0) {
      replyThread = [
        {
          role: "prospect",
          content: replyText,
          timestamp: new Date().toISOString(),
          channel: "linkedin",
        },
      ];
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
