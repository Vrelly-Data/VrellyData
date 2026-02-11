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

    // Query sales_knowledge for context
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: knowledge } = await supabase
      .from("sales_knowledge")
      .select("title, content, category, tags, metrics, source_campaign")
      .eq("is_active", true)
      .in("category", [
        "email_template",
        "sales_guideline",
        "sequence_playbook",
        "campaign_result",
        "audience_insight",
      ])
      .limit(15);

    // Build knowledge context — separate campaign results for special treatment
    let knowledgeContext = "";
    let benchmarkContext = "";

    if (knowledge && knowledge.length > 0) {
      const campaignResults = knowledge.filter((k: any) => k.category === "campaign_result");
      const otherKnowledge = knowledge.filter((k: any) => k.category !== "campaign_result");

      if (otherKnowledge.length > 0) {
        knowledgeContext =
          "\n\n## Sales Knowledge Base (use these as reference for tone, style, and best practices):\n\n" +
          otherKnowledge
            .map(
              (k: any, i: number) =>
                `### ${i + 1}. ${k.title} [${k.category}]\n${k.content}`
            )
            .join("\n\n");
      }

      if (campaignResults.length > 0) {
        benchmarkContext =
          "\n\n## Performance Benchmarks (real campaign data — use to calibrate expectations and reference what works):\n\n" +
          campaignResults
            .map((k: any, i: number) => {
              const metrics = k.metrics as Record<string, any> || {};
              const topIndustries = (metrics.topIndustries || [])
                .map((ind: any) => `${ind.value} (${ind.percentage}%)`)
                .join(", ");
              return `### Benchmark ${i + 1}: ${k.title}\n${k.content}${topIndustries ? `\nKey verticals: ${topIndustries}` : ""}`;
            })
            .join("\n\n");
      }
    }

    const systemPrompt = `You are an expert sales copywriter specializing in outbound email and LinkedIn sequences. Your job is to rewrite the provided ${stepType || "email"} copy to be more compelling, personalized, and likely to get a response.

Guidelines:
- Keep the message concise and scannable
- Use a conversational, peer-to-peer tone (not salesy)
- Lead with value or a relevant insight
- Include a clear, low-friction CTA
- Preserve any merge/template variables like {{firstName}}, {{company}}, etc.
- Match the channel: ${stepType === "linkedin_message" || stepType === "linkedin_connect" || stepType === "linkedin_inmail" ? "LinkedIn messages should be shorter and more casual" : "emails can be slightly longer but still concise"}
${campaignName ? `- This is for the campaign: "${campaignName}"` : ""}
${knowledgeContext}
${benchmarkContext}

Return your response as JSON with exactly these fields:
{
  "subject": "the rewritten subject line (or null if not applicable)",
  "body": "the rewritten body text (plain text, use \\n for line breaks)"
}

Return ONLY the JSON, no markdown fences or extra text.`;

    const userMessage = `Please rewrite this ${stepType || "email"} copy:

${subject ? `Subject: ${subject}\n\n` : ""}Body:
${body || "(no body provided)"}`;

    // Call Claude API
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

    // Parse the JSON response
    let result;
    try {
      // Strip markdown fences if present
      const cleaned = responseText
        .replace(/^```json?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      result = JSON.parse(cleaned);
    } catch {
      // Fallback: return raw text as body
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
