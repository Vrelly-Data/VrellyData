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
    } = await req.json();

    if (!product) {
      return new Response(JSON.stringify({ error: "product is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull relevant Sales KB context
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
        return { ...e, _rate: parseFloat(metrics["email_reply_rate"]) || 0 };
      })
      .filter((e: any) => e._rate > 0)
      .sort((a: any, b: any) => b._rate - a._rate)
      .slice(0, 5);

    const topNames = topPerformers.map((e: any) => e.source_campaign || e.title).filter(Boolean);
    let copyDocs: any[] = [];
    if (topNames.length > 0) {
      const { data } = await supabase
        .from("sales_knowledge")
        .select("title, content, category, source_campaign")
        .eq("is_active", true)
        .in("category", ["email_template", "sequence_playbook"])
        .in("source_campaign", topNames)
        .limit(5);
      copyDocs = data || [];
    }

    const { data: guidelines } = await supabase
      .from("sales_knowledge")
      .select("title, content, category")
      .eq("is_active", true)
      .in("category", ["sales_guideline", "audience_insight"])
      .limit(5);

    const performanceContext = topPerformers.length > 0
      ? "\n\n## TOP-PERFORMING CAMPAIGNS (study their patterns):\n\n" +
        topPerformers.map((k: any, i: number) => {
          const m = k.metrics as Record<string, any> || {};
          return `### Campaign ${i + 1}: ${k.title} [${k._rate}% reply rate]\n${k.content}`;
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

    const systemPrompt = `You are an expert B2B sales copywriter. Generate a complete, high-converting outbound email sequence for the following business.

Business Details:
- Product/Service: ${product}
- Industries targeted: ${(industries || []).join(", ") || "Not specified"}
- Sales motion: ${isBtoB ? "B2B" : "B2C"}
- Target titles: ${(targetTitles || []).join(", ") || "Not specified"}
- Target company types: ${(companyTypes || []).join(", ") || "Not specified"}
- Company differentiator/standout: ${companyStandout || "Not specified"}
${performanceContext}
${copyContext}
${guidelinesContext}

Generate a 3-step email sequence (initial outreach + 2 follow-ups). For each step provide:
- subject line
- email body (plain text, conversational, concise)
- send day (e.g., Day 1, Day 4, Day 8)

Also provide:
- positioning_statement: A 1-2 sentence positioning statement for this prospect type
- key_insight: One data-backed insight or pattern from the winning campaigns that informed this copy

Return ONLY valid JSON in this exact shape:
{
  "positioning_statement": "...",
  "key_insight": "...",
  "steps": [
    { "step": 1, "day": 1, "subject": "...", "body": "..." },
    { "step": 2, "day": 4, "subject": "...", "body": "..." },
    { "step": 3, "day": 8, "subject": "...", "body": "..." }
  ]
}`;

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
        messages: [{ role: "user", content: "Generate the email sequence now." }],
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
