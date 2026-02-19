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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      product,
      industries,
      isBtoB,
      targetTitles,
      companyTypes,
      companyStandout,
      channels,
    } = await req.json();

    if (!product) {
      return new Response(JSON.stringify({ error: "product is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull top-performing campaign results from KB
    const { data: allResults } = await supabase
      .from("sales_knowledge")
      .select("title, content, category, tags, metrics, source_campaign")
      .eq("is_active", true)
      .eq("category", "campaign_result")
      .not("metrics", "is", null)
      .limit(50);

    const topPerformers = (allResults || [])
      .map((e: any) => {
        const metrics = e.metrics as Record<string, any> || {};
        const liRate = parseFloat(metrics["li_reply_rate"]) || 0;
        const emailRate = parseFloat(metrics["email_reply_rate"]) || 0;
        const combinedRate = parseFloat(metrics["combined_reply_rate"]) || 0;
        const _rate = Math.max(liRate, emailRate, combinedRate);
        const _rateSource = liRate >= emailRate && liRate >= combinedRate ? "LinkedIn" : emailRate >= combinedRate ? "Email" : "Combined";
        return { ...e, _rate, _rateSource };
      })
      .filter((e: any) => e._rate > 0)
      .sort((a: any, b: any) => b._rate - a._rate)
      .slice(0, 5);

    const topNames = topPerformers.map((e: any) => e.source_campaign || e.title).filter(Boolean);
    let copyDocs: any[] = [];
    // Fetch email templates linked to top campaigns
    if (topNames.length > 0) {
      const { data: linkedDocs } = await supabase
        .from("sales_knowledge")
        .select("title, content, category, source_campaign")
        .eq("is_active", true)
        .in("category", ["email_template"])
        .in("source_campaign", topNames)
        .limit(3);
      copyDocs = linkedDocs || [];
    }
    // Always fetch sequence_playbook entries (they have no source_campaign, so must be queried separately)
    const { data: playbookDocs } = await supabase
      .from("sales_knowledge")
      .select("title, content, category, source_campaign")
      .eq("is_active", true)
      .eq("category", "sequence_playbook")
      .limit(2);
    copyDocs = [...copyDocs, ...(playbookDocs || [])];

    const { data: guidelines } = await supabase
      .from("sales_knowledge")
      .select("title, content, category")
      .eq("is_active", true)
      .in("category", ["sales_guideline", "audience_insight"])
      .limit(5);

    // Build source_insights server-side (not hallucinated — real KB references)
    const sourceInsights: { title: string; category: string }[] = [];
    for (const p of topPerformers) {
      sourceInsights.push({ title: p.title, category: "campaign_result" });
    }
    for (const g of (guidelines || [])) {
      sourceInsights.push({ title: (g as any).title, category: (g as any).category });
    }

    const performanceContext = topPerformers.length > 0
      ? "\n\n## TOP-PERFORMING CAMPAIGNS (study their patterns):\n\n" +
        topPerformers.map((k: any, i: number) => {
          const m = k.metrics as Record<string, any> || {};
          return `### Campaign ${i + 1}: ${k.title} [${k._rate}% reply rate — ${k._rateSource}]\n${k.content}`;
        }).join("\n\n")
      : "";

    const copyContext = copyDocs.length > 0
      ? "\n\n## WINNING EMAIL SEQUENCES:\n\n" +
        copyDocs.map((k: any, i: number) =>
          `### ${i + 1}: ${k.title}\nLinked to: ${k.source_campaign || "N/A"}\n${k.content}`
        ).join("\n\n")
      : "";

    const guidelinesContext = (guidelines || []).length > 0
      ? "\n\n## STRATEGIC GUIDELINES:\n\n" +
        (guidelines as any[]).map((k: any, i: number) => `### ${i + 1}: ${k.title}\n${k.content}`).join("\n\n")
      : "";

    const hasKBData = topPerformers.length > 0 || (guidelines || []).length > 0;

    const selectedChannels: string[] = Array.isArray(channels) && channels.length > 0 ? channels : ["Email"];
    const isMultiChannel = selectedChannels.length > 1;

    const channelInstructions = isMultiChannel
      ? `Generate one outreach step per channel listed below, tailoring tone and format appropriately:
- Email: include subject line + full body (professional, concise)
- LinkedIn: no subject line, shorter and more conversational (2-4 sentences max)
- Twitter message: very short, casual, 1-2 sentences max, no subject
- Instagram message: short, casual, friendly tone, no subject
- Facebook message: short, casual, 1-2 sentences, no subject
Generate ${selectedChannels.length} steps total (one per channel), assigning logical send days.`
      : `Generate a 3-step email sequence (initial outreach + 2 follow-ups). For each step provide:
- subject line
- email body (plain text, conversational, concise)
- send day (e.g., Day 1, Day 4, Day 8)`;

    const whyThisWorksInstruction = hasKBData
      ? `Based on the KB data provided (top-performing campaigns, winning sequences, and strategic guidelines), produce a "why_this_works" field: a list of 2-4 bullet-point reasons explaining WHY this outreach approach is the right fit for the described business. Ground each reason in specific patterns or data from the KB context above (e.g., reference a campaign name, a reply rate, a guideline insight). Be specific and data-driven.`
      : `Produce a "why_this_works" field: a list of 2-4 bullet-point reasons explaining WHY this outreach approach is the right fit for the described business, based on general B2B sales best practices and the business inputs provided.`;

    const systemPrompt = `You are an expert B2B sales copywriter. Generate a complete, high-converting outbound outreach sequence for the following business.

Business Details:
- Product/Service: ${product}
- Industries targeted: ${(industries || []).join(", ") || "Not specified"}
- Sales motion: ${isBtoB ? "B2B" : "B2C"}
- Target titles: ${(targetTitles || []).join(", ") || "Not specified"}
- Target company types: ${(companyTypes || []).join(", ") || "Not specified"}
- Company differentiator/standout: ${companyStandout || "Not specified"}
- Outreach channels: ${selectedChannels.join(", ")}
${performanceContext}
${copyContext}
${guidelinesContext}

${channelInstructions}

${whyThisWorksInstruction}

Also provide:
- positioning_statement: A 1-2 sentence positioning statement for this prospect type
- key_insight: One data-backed insight or pattern from the winning campaigns that informed this copy (or a general best-practice insight if no KB data)

Return ONLY valid JSON in this exact shape:
{
  "positioning_statement": "...",
  "key_insight": "...",
  "why_this_works": ["reason 1", "reason 2", "reason 3"],
  "steps": [
    { "step": 1, "day": 1, "channel": "Email", "subject": "...", "body": "..." },
    { "step": 2, "day": 4, "channel": "LinkedIn", "subject": null, "body": "..." }
  ]
}
Note: set "subject" to null for non-email channels. Do NOT include "source_insights" in your response — that is injected server-side.`;

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: "Generate the outreach sequence now." }],
      }),
    });

    if (!claudeResponse.ok) {
      const err = await claudeResponse.text();
      console.error("Claude API error:", err);
      return new Response(JSON.stringify({ error: "Failed to generate copy" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let result;
    try {
      const cleaned = responseText.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { error: "Failed to parse AI response", raw: responseText };
    }

    // Inject source_insights server-side (verified KB references, not hallucinated)
    result.source_insights = sourceInsights;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-copy:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
