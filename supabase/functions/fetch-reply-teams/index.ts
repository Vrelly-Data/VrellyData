import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v1";

interface ReplyTeam {
  id: number;
  name: string;
  isAgency?: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { apiKey } = await req.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch teams from Reply.io
    const response = await fetch(`${REPLY_API_BASE}/emailAccounts`, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      return new Response(
        JSON.stringify({ error: "Invalid API key", teams: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Reply.io API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Reply.io API error: ${response.status}`, teams: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    
    // For agency accounts, Reply.io returns email accounts with team context
    // We'll extract unique teams from the response
    const teams: ReplyTeam[] = [];
    const seenTeamIds = new Set<number>();
    
    // Check if this looks like an agency account (multiple teams/clients)
    if (Array.isArray(data)) {
      for (const account of data) {
        if (account.teamId && !seenTeamIds.has(account.teamId)) {
          seenTeamIds.add(account.teamId);
          teams.push({
            id: account.teamId,
            name: account.teamName || `Team ${account.teamId}`,
          });
        }
      }
    }

    // Also try the dedicated teams endpoint for agency accounts
    try {
      const teamsResponse = await fetch(`${REPLY_API_BASE}/teams`, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json();
        if (Array.isArray(teamsData)) {
          for (const team of teamsData) {
            if (team.id && !seenTeamIds.has(team.id)) {
              seenTeamIds.add(team.id);
              teams.push({
                id: team.id,
                name: team.name || `Team ${team.id}`,
              });
            }
          }
        }
      }
    } catch (teamsErr) {
      // Teams endpoint might not exist for non-agency accounts
      console.log("Teams endpoint not available:", teamsErr);
    }

    const isAgencyAccount = teams.length > 1;

    return new Response(
      JSON.stringify({ 
        teams, 
        isAgencyAccount,
        message: isAgencyAccount 
          ? "Agency account detected. Please select a client team." 
          : teams.length === 1 
            ? "Single team account detected." 
            : "No teams found - will sync all available campaigns."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Fetch teams error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch teams", teams: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
