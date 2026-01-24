import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v1";

interface ValidateRequest {
  platform: string;
  apiKey: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { platform, apiKey }: ValidateRequest = await req.json();

    if (!platform || !apiKey) {
      return new Response(
        JSON.stringify({ valid: false, error: "Platform and API key are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (platform === "reply.io") {
      // Validate Reply.io API key by calling their API
      const response = await fetch(`${REPLY_API_BASE}/people?limit=1`, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (response.status === 401) {
        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: "Invalid API key. Please check your Reply.io API key in Settings → API Key." 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (response.status === 403) {
        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: "API key does not have sufficient permissions." 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Reply.io API error:", response.status, errorText);
        return new Response(
          JSON.stringify({ 
            valid: false, 
            error: `Reply.io API error: ${response.status}` 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Success!
      return new Response(
        JSON.stringify({ valid: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For other platforms (Smartlead, Instantly, Lemlist), skip validation for now
    return new Response(
      JSON.stringify({ valid: true, message: "Validation not yet implemented for this platform" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Validation error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: "Could not validate API key. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
