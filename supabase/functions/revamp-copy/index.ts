import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "Anthropic API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { subject, body, stepType, campaignName } = await req.json();

    if (!body && !subject) {
      return new Response(
        JSON.stringify({ error: "Subject or body is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Determine which metric to rank by based on channel
    const isLinkedIn = stepType === "linkedin_message" || stepType === "linkedin_connect" || stepType === "linkedin_inmail";
    const rankMetric = isLinkedIn ? "li_reply_rate" : "email_reply_rate";

    // ── Tier 1: Top performers by channel metric ──
    const { data: allCampaignResults } = await supabase
      .from("sales_knowledge")
      .select("title, content, category, tags, metrics, source_campaign")
      .eq("is_active", true)
      .eq("category", "campaign_result")
      .not("metrics", "is", null)
      .limit(50); // fetch more, then sort client-side since jsonb ordering isn't straightforward

    // Sort by the relevant metric and take top 5
    const topPerformers = (allCampaignResults || [])
      .map((entry: any) => {
        const metrics = (entry.metrics as Record<string, any>) || {};
        const rate = parseFloat(metrics[rankMetric]) || 0;
        return { ...entry, _rankRate: rate };
      })
      .filter((e: any) => e._rankRate > 0)
      .sort((a: any, b: any) => b._rankRate - a._rankRate)
      .slice(0, 5);

    // ── Tier 2: Copy docs linked to top performers ──
    const topCampaignNames = topPerformers
      .map((e: any) => e.source_campaign || e.title)
      .filter(Boolean);

    let linkedCopyDocs: any[] = [];
    if (topCampaignNames.length > 0) {
      const { data: copyDocs } = await supabase
        .from("sales_knowledge")
        .select("title, content, category, tags, metrics, source_campaign")
        .eq("is_active", true)
        .in("category", ["email_template", "sequence_playbook"])
        .in("source_campaign", topCampaignNames)
        .limit(5);
      linkedCopyDocs = copyDocs || [];
    }

    // ── Tier 3: General best practices ──
    const { data: generalKnowledge } = await supabase
      .from("sales_knowledge")
      .select("title, content, category, tags, metrics, source_campaign")
      .eq("is_active", true)
      .in("category", ["sales_guideline", "audience_insight"])
      .limit(5);

    // ── Build context sections for the prompt ──
    let performanceContext = "";
    if (topPerformers.length > 0) {
      performanceContext =
        "\n\n## TOP-PERFORMING CAMPAIGNS (ranked by " +
        (isLinkedIn ? "LinkedIn" : "email") +
        " reply rate — learn from these):\n\n" +
        topPerformers
          .map((k: any, i: number) => {
            const metrics = (k.metrics as Record<string, any>) || {};
            const topIndustries = (metrics.topIndustries || [])
              .map((ind: any) => `${ind.value} (${ind.percentage}%)`)
              .join(", ");
            return `### Winner ${i + 1}: ${k.title} [${k._rankRate}% reply rate]\n${k.content}${topIndustries ? `\nKey verticals: ${topIndustries}` : ""}`;
          })
          .join("\n\n");
    }

    let copyContext = "";
    if (linkedCopyDocs.length > 0) {
      copyContext =
        "\n\n## WINNING COPY (the actual sequences/templates that drove the results above):\n\n" +
        linkedCopyDocs
          .map(
            (k: any, i: number) =>
              `### Copy Doc ${i + 1}: ${k.title} [${k.category}]\nLinked to campaign: ${k.source_campaign || "N/A"}\n${k.content}`
          )
          .join("\n\n");
    }

    let guidelinesContext = "";
    if (generalKnowledge && generalKnowledge.length > 0) {
      guidelinesContext =
        "\n\n## GENERAL BEST PRACTICES (tone, style, and strategic guidelines):\n\n" +
        (generalKnowledge as any[])
          .map(
            (k: any, i: number) =>
              `### ${i + 1}. ${k.title} [${k.category}]\n${k.content}`
          )
          .join("\n\n");
    }

    const systemPrompt = `You are an expert sales copywriter with access to real campaign performance data. Your job is to rewrite the provided ${stepType || "email"} copy to be more compelling, personalized, and likely to get a response.

IMPORTANT — You have been given real campaign data below. Use it:
- Study the top-performing campaigns and identify PATTERNS in what made them successful (subject line style, opener approach, CTA type, length, tone)
- Reference specific performance data when it supports your choices (e.g., "campaigns using question-based subject lines averaged 15%+ reply rates")
- Apply the copy patterns from winning campaigns to the user's copy
- If the winning copy docs show specific techniques (short paragraphs, value-first openers, social proof), incorporate those techniques

Guidelines:
- Keep the message concise and scannable
- Use a conversational, peer-to-peer tone (not salesy)
- Lead with value or a relevant insight
- Include a clear, low-friction CTA
- Preserve any merge/template variables like {{firstName}}, {{company}}, etc.
- Match the channel: ${isLinkedIn ? "LinkedIn messages should be shorter and more casual" : "emails can be slightly longer but still concise"}
${campaignName ? `- This is for the campaign: "${campaignName}"` : ""}
${performanceContext}
${copyContext}
${guidelinesContext}

Return your response as JSON with exactly these fields:
{
  "subject": "the rewritten subject line (or null if not applicable)",
  "body": "the rewritten body text (plain text, use \\n for line breaks)"
}

Return ONLY the JSON, no markdown fences or extra text.`;

    const userMessage = `Please rewrite this ${stepType || "email"} copy:

${subject ? `Subject: ${subject}\n\n` : ""}Body:
${body || "(no body provided)"}`;

    const claudeResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      }
    );

    if (!claudeResponse.ok) {
      const err = await claudeResponse.text();
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to generate revamped copy" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const claudeData = await claudeResponse.json();
    const responseText =
      claudeData.content?.[0]?.text || "";

    let result;
    try {
      const cleaned = responseText
        .replace(/^```json?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { subject: subject || null, body: responseText };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in revamp-copy:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
