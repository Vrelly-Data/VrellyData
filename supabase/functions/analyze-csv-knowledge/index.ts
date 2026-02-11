import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_CATEGORIES = [
  "email_template",
  "sequence_playbook",
  "campaign_result",
  "sales_guideline",
  "audience_insight",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { headers, sampleRows, rowCount } = await req.json();

    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid headers" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const systemPrompt = `You are a data mapping assistant. Given CSV column headers and sample data, determine how to map them to a sales knowledge base schema.

The target schema fields are:
- title (required): The name/subject of the knowledge entry
- content (required): The main body/text content
- category (required): One of: ${VALID_CATEGORIES.join(", ")}
- tags: Column whose values should become tags (semicolon or comma separated)
- source_campaign: Campaign name or identifier
- metrics: Numeric columns that represent performance metrics (e.g., reply_rate, open_rate, sent, clicks)

Return your mapping as a JSON object using the tool provided.`;

    const userPrompt = `CSV has ${rowCount} rows. Here are the column headers and first ${sampleRows?.length ?? 0} sample rows:

Headers: ${JSON.stringify(headers)}

Sample data:
${JSON.stringify(sampleRows ?? [], null, 2)}

Map these columns to the sales knowledge schema. For metrics, identify any numeric performance columns. For category, infer the most likely category from the data patterns. If a column doesn't map to anything, skip it.`;

    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "suggest_mapping",
                description:
                  "Return the suggested column mapping for the CSV data",
                parameters: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description:
                        "CSV column name to use as the title field, or null if none found",
                    },
                    content: {
                      type: "string",
                      description:
                        "CSV column name to use as the content field, or null if none found",
                    },
                    suggestedCategory: {
                      type: "string",
                      enum: VALID_CATEGORIES,
                      description:
                        "The most likely category for all rows based on the data patterns",
                    },
                    categoryColumn: {
                      type: "string",
                      description:
                        "CSV column name that contains per-row categories, or null if category should be applied globally",
                    },
                    tags: {
                      type: "string",
                      description:
                        "CSV column name whose values should become tags, or null",
                    },
                    sourceCampaign: {
                      type: "string",
                      description:
                        "CSV column name for source campaign, or null",
                    },
                    metrics: {
                      type: "object",
                      additionalProperties: { type: "string" },
                      description:
                        "Object mapping metric names (e.g. reply_rate, open_rate) to CSV column names",
                    },
                  },
                  required: ["title", "content", "suggestedCategory"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "suggest_mapping" },
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", status, errorText);

      if (status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded, please try again later.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({
            error: "AI credits exhausted. Please add funds to your workspace.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(
        JSON.stringify({ error: "AI did not return a valid mapping" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const mapping = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ mapping }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-csv-knowledge error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
