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
      industries,
      isBtoB,
      targetTitles,
      companyTypes,
      companySizes,
      locations,
    } = await req.json();

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

    const { data: audienceInsights } = await supabase
      .from("sales_knowledge")
      .select("title, content, category")
      .eq("is_active", true)
      .in("category", ["audience_insight", "sales_guideline"])
      .limit(8);

    const performanceContext = topPerformers.length > 0
      ? "\n\n## TOP-PERFORMING CAMPAIGNS:\n\n" +
        topPerformers.map((k: any, i: number) => {
          const m = k.metrics as Record<string, any> || {};
          const topInd = (m.topIndustries || []).map((ind: any) => `${ind.value} (${ind.percentage}%)`).join(", ");
          return `### Campaign ${i + 1}: ${k.title} [${k._rate}% reply rate — ${k._rateSource}]${topInd ? `\nTop Industries: ${topInd}` : ""}\n${k.content}`;
        }).join("\n\n")
      : "";

    const insightsContext = (audienceInsights || []).length > 0
      ? "\n\n## AUDIENCE & STRATEGIC INSIGHTS:\n\n" +
        (audienceInsights as any[]).map((k: any, i: number) => `### ${i + 1}: ${k.title}\n${k.content}`).join("\n\n")
      : "";

    // Timeout protection is handled by Promise.race wrappers below

    // Build params for the search_prospects functions
    const searchParams: Record<string, any> = {
      p_limit: 50,
      p_offset: 0,
    };

    if (industries && industries.length > 0) searchParams.p_industries = industries;
    if (targetTitles && targetTitles.length > 0) searchParams.p_job_titles = targetTitles;
    if (companySizes && companySizes.length > 0) searchParams.p_company_size_ranges = companySizes;
    if (locations && locations.length > 0) searchParams.p_countries = locations;

    let prospects: any[] = [];
    let totalCount = 0;
    let rpcError: any = null;

    // Primary search with timeout protection — run results + count in parallel
    try {
      const countParams = { ...searchParams };
      delete countParams.p_limit;
      delete countParams.p_offset;

      const [resultsResult, countResult] = await Promise.race([
        Promise.all([
          supabase.rpc("search_prospects_results", searchParams),
          supabase.rpc("search_prospects_count", countParams),
        ]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("RPC_TIMEOUT")), 15000)),
      ]);

      if (resultsResult.error) {
        rpcError = resultsResult.error;
      } else {
        prospects = resultsResult.data || [];
      }

      if (!countResult.error && countResult.data && (countResult.data as any[]).length > 0) {
        totalCount = Number((countResult.data as any[])[0].total_count) || 0;
      }
    } catch (timeoutErr: any) {
      console.warn("Primary RPC timed out, trying fallback query:", timeoutErr.message);
      rpcError = timeoutErr;
    }

    // Fallback: simpler direct query if primary failed
    if (rpcError || prospects.length === 0) {
      console.log("Using fallback query with fewer filters");
      const fallbackParams: Record<string, any> = {
        p_limit: 50,
        p_offset: 0,
      };
      // Only use industry + job title for fallback (fastest filters)
      if (industries && industries.length > 0) fallbackParams.p_industries = industries;
      if (targetTitles && targetTitles.length > 0) fallbackParams.p_job_titles = targetTitles;

      try {
        const fallbackResult = await Promise.race([
          supabase.rpc("search_prospects_results", fallbackParams),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("FALLBACK_TIMEOUT")), 12000)),
        ]) as any;

        if (!fallbackResult.error) {
          prospects = fallbackResult.data || [];
        } else {
          console.error("Fallback query also failed:", fallbackResult.error);
        }
      } catch (e) {
        console.error("Fallback also timed out");
      }
    }

    // Build AI prompt
    const systemPrompt = `You are a B2B sales intelligence expert. Based on the criteria and data below, provide:
1. An ideal customer profile (ICP) description
2. Key audience insights and patterns
3. Recommended targeting approach based on top-performing campaign data

Targeting Criteria:
- Industries: ${(industries || []).join(", ") || "Not specified"}
- Sales motion: ${isBtoB ? "B2B" : "B2C"}
- Target titles: ${(targetTitles || []).join(", ") || "Not specified"}
- Target company types: ${(companyTypes || []).join(", ") || "Not specified"}
- Company sizes: ${(companySizes || []).join(", ") || "Not specified"}
- Locations: ${(locations || []).join(", ") || "Not specified"}
- Matching prospects found in database: ${prospects.length}
${performanceContext}
${insightsContext}

Return ONLY valid JSON in this exact shape:
{
  "icp_summary": "2-3 sentence description of the ideal customer profile",
  "key_insights": ["insight 1", "insight 2", "insight 3"],
  "recommended_approach": "1 paragraph on recommended outreach approach based on winning campaigns",
  "audience_score": 85
}
audience_score is 0-100 based on how well-defined and targetable this audience is.`;

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages: [{ role: "user", content: "Analyze this audience now." }],
      }),
    });

    if (!claudeResponse.ok) {
      const err = await claudeResponse.text();
      console.error("Claude API error:", err);
      return new Response(JSON.stringify({ error: "Failed to generate audience insights" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let insights;
    try {
      const cleaned = responseText.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
      insights = JSON.parse(cleaned);
    } catch {
      insights = { error: "Failed to parse AI response", raw: responseText };
    }

    // Return prospects (blurred in UI) + AI insights
    const blurredProspects = prospects.slice(0, 50).map((p: any) => {
      return {
        entity_external_id: p.entity_external_id || p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown",
        title: p.job_title || "—",
        company: p.company_name || "—",
        industry: p.company_industry || "—",
        location: [p.city, p.state].filter(Boolean).join(", ") || "—",
        email: p.business_email || p.personal_email || null,
        linkedin: p.linkedin_url || null,
      };
    });

    return new Response(JSON.stringify({
      insights,
      prospects: blurredProspects,
      totalFound: totalCount || prospects.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in build-audience:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
