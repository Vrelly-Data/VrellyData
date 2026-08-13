import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { htmlToText } from "../_shared/html-to-text.ts";

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

const REPLY_API_BASE = "https://api.reply.io/v3";

interface ReplyStep {
  id: number;
  sequenceId: number;
  type: string;
  number: number;
  delayInMinutes?: number;
  waitInMinutes?: number;    // Used by Condition steps to define wait time
  executionMode?: string;
  message?: string;          // LinkedIn message content (legacy/top-level — absent in live v3; body lives on variants[])
  variants?: Array<{         // v3 A/B variants — body lives here for BOTH channels:
    message?: string;        //   LinkedIn step body
    subject?: string;        //   email step subject
    body?: string;           //   email step body
  }>;
  actionType?: string;       // LinkedIn action type (Connect, Message, InMail)
  templates?: Array<{
    id: number;
    templateId?: number;
    subject?: string;
    body?: string;
  }>;
  stats?: {
    sent?: number;
    delivered?: number;
    opened?: number;
    clicked?: number;
    replied?: number;
    bounced?: number;
  };
}

// Retry wrapper with exponential backoff for rate limiting
async function fetchWithRetry(
  endpoint: string, 
  apiKey: string, 
  teamId?: string, 
  maxRetries: number = 3
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {
        // Reply.io v3 Bearer — same pattern as sync-reply-campaigns' fetchV3
        // (Step 2 conversion). The endpoint at /v3/sequences/{id}/steps is
        // already on v3, so this is auth-only — no path or shape change.
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      
      if (teamId) {
        headers["X-Reply-Team-Id"] = teamId;
      }
      
      const response = await fetch(`${REPLY_API_BASE}${endpoint}`, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Reply.io API error (${response.status}): ${errorText}`);
      }

      return response.json();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(`Rate limited on ${endpoint}, waiting ${waitTime/1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Convert minutes to days (rounded)
function minutesToDays(minutes: number): number {
  return Math.round(minutes / (60 * 24));
}

// Plain-text version of a sequence step body. Delegates to the one shared
// cleaner: this local copy dropped <style>/<script> TAGS but kept their
// CONTENTS (so a templated step with an inline stylesheet stored raw CSS), and
// decoded only five entities — no numeric forms, no smart punctuation.
function stripHtml(html: string): string {
  return htmlToText(html);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { campaignId, integrationId } = body;

    if (!campaignId || !integrationId) {
      throw new Error("Missing campaignId or integrationId");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Fetch the integration
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, reply_team_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    // Fetch the campaign to get external_campaign_id
    const { data: campaign, error: campaignError } = await supabase
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id;
    const sequenceId = campaign.external_campaign_id;

    console.log(`Fetching sequence steps for sequence ${sequenceId}`);

    // Fetch steps from Reply.io V3 API - returns direct array, not { steps: [] }
    const endpoint = `/sequences/${sequenceId}/steps`;
    const steps = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as ReplyStep[];
    console.log(`Fetched ${steps.length} steps from Reply.io`);

    // Upsert steps to database
    let stepsSynced = 0;
    let stepsFailed = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1; // Use array index + 1 since Reply.io doesn't return step.number
      
      try {
        // Detect LinkedIn based on step type only (not message presence)
        const isLinkedIn = step.type?.toLowerCase().includes('linkedin');
        const template = step.templates?.[0];

        let bodyHtml: string | null = null;
        let subject: string | null = null;
        let stepType = step.type?.toLowerCase() || 'email';

        if (isLinkedIn) {
          // LinkedIn message body lives at step.variants[0].message in the
          // live v3 response (A/B variants — first is fine). The top-level
          // step.message that the old code read is absent in v3, so it wrote
          // null. Read variants[0].message primarily; keep step.message only
          // as a defensive fallback. Pure action steps (viewProfile /
          // followProfile / condition) carry NO variants → bodyHtml stays
          // null, which is correct (nothing to copy).
          const variantMessage = step.variants?.[0]?.message;
          const linkedInBody =
            variantMessage && variantMessage.trim()
              ? variantMessage
              : step.message && step.message.trim()
                ? step.message
                : null;
          if (linkedInBody) {
            bodyHtml = linkedInBody;
          }
          // More specific step type based on actionType
          if (step.actionType) {
            stepType = `linkedin_${step.actionType.toLowerCase()}`;
          }
        } else {
          // Email step body lives at step.variants[0].message in the live v3
          // response — the SAME `message` field the LinkedIn branch reads,
          // just with an additional `subject`. A v3 email variant is
          // {id, message (the body HTML), subject, hasAttachments}; there is
          // NO `.body` field (confirmed from live raw_data). The legacy
          // templates[0] array is absent in v3. Read variants[0].message
          // FIRST, then fall back to variants[0].body and templates[0].body
          // for safety / any sequence that populates the legacy shapes.
          subject = step.variants?.[0]?.subject ?? template?.subject ?? null;
          bodyHtml = step.variants?.[0]?.message ?? step.variants?.[0]?.body ?? template?.body ?? null;
        }

        const bodyText = bodyHtml ? stripHtml(bodyHtml) : null;

        const { error: upsertError } = await supabase
          .from("synced_sequences")
          .upsert({
            campaign_id: campaignId,
            team_id: teamId,
            external_sequence_id: String(step.id),
            step_number: stepNumber,
            step_type: stepType,
            subject: subject,
            body_html: bodyHtml,
            body_text: bodyText,
            delay_days: minutesToDays(step.delayInMinutes || step.waitInMinutes || 0),
            stats: step.stats || {},
            raw_data: step,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "campaign_id,step_number",
          });

        if (upsertError) {
          console.error(`Failed to upsert step ${step.number}:`, upsertError);
          stepsFailed++;
        } else {
          stepsSynced++;
        }
      } catch (err) {
        console.error(`Error processing step ${step.number}:`, err);
        stepsFailed++;
      }
    }

    console.log(`Sequences sync complete: ${stepsSynced} synced, ${stepsFailed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        stepsSynced,
        stepsFailed,
        totalFetched: steps.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Sequences sync error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
