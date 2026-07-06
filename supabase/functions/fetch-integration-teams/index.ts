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

const REPLY_API_BASE = "https://api.reply.io/v1";
const REPLY_API_V3 = "https://api.reply.io/v3";

interface ReplyTeam {
  id: number;
  name: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { integrationId } = await req.json();

    if (!integrationId) {
      return new Response(
        JSON.stringify({ error: "integrationId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch integration with API key (RLS will ensure user has access)
    const { data: integration, error: integrationError } = await supabase
      .from("outbound_integrations")
      .select("id, api_key_encrypted, platform")
      .eq("id", integrationId)
      .maybeSingle();

    if (integrationError || !integration) {
      console.error("Integration fetch error:", integrationError);
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (integration.platform !== "reply.io") {
      return new Response(
        JSON.stringify({ error: "Team discovery only available for Reply.io integrations", teams: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = integration.api_key_encrypted;
    const teams: ReplyTeam[] = [];
    const seenTeamIds = new Set<number>();

    // Try 1a: v3 email accounts (Bearer) — modern endpoint + invalid-key
    // gate. NOTE: v3 email-account objects do NOT carry teamId/teamName
    // (confirmed against the v3 docs), so this call can't derive teams; it
    // only tells us whether the Bearer key is accepted.
    console.log("Fetching v3 email accounts (Bearer)...");
    const v3EmailRes = await fetch(`${REPLY_API_V3}/email-accounts`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
    });

    // Try 1b (fallback): v1 /emailAccounts (X-Api-Key) to recover teamId,
    // which v3 dropped. Additive — kept until Reply.io exposes team data in
    // v3. Only when BOTH v3 and v1 reject with 401 is the key truly invalid.
    console.log("Fetching v1 emailAccounts for teamId derivation...");
    const emailAccountsResponse = await fetch(`${REPLY_API_BASE}/emailAccounts`, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (v3EmailRes.status === 401 && emailAccountsResponse.status === 401) {
      return new Response(
        JSON.stringify({ error: "Invalid API key stored for this integration", teams: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (emailAccountsResponse.ok) {
      const emailData = await emailAccountsResponse.json();
      console.log("Email accounts response:", JSON.stringify(emailData, null, 2));
      
      if (Array.isArray(emailData)) {
        for (const account of emailData) {
          if (account.teamId && !seenTeamIds.has(account.teamId)) {
            seenTeamIds.add(account.teamId);
            teams.push({
              id: account.teamId,
              name: account.teamName || `Team ${account.teamId}`,
            });
          }
        }
      }
    }

    // Try 2: Dedicated teams endpoint. No v3 equivalent exists (checked the
    // v3 docs), so this stays on v1 + X-Api-Key.
    console.log("Trying /teams endpoint...");
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
        console.log("Teams endpoint response:", JSON.stringify(teamsData, null, 2));
        
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
      console.log("Teams endpoint not available:", teamsErr);
    }

    // Try 3: Agency clients endpoint (for agency accounts). No v3 equivalent
    // exists (checked the v3 docs), so this stays on v1 + X-Api-Key.
    console.log("Trying /agency/clients endpoint...");
    try {
      const agencyResponse = await fetch(`${REPLY_API_BASE}/agency/clients`, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (agencyResponse.ok) {
        const agencyData = await agencyResponse.json();
        console.log("Agency clients response:", JSON.stringify(agencyData, null, 2));
        
        if (Array.isArray(agencyData)) {
          for (const client of agencyData) {
            const clientId = client.id || client.teamId || client.clientId;
            const clientName = client.name || client.teamName || client.companyName || `Client ${clientId}`;
            if (clientId && !seenTeamIds.has(clientId)) {
              seenTeamIds.add(clientId);
              teams.push({
                id: clientId,
                name: clientName,
              });
            }
          }
        }
      }
    } catch (agencyErr) {
      console.log("Agency clients endpoint not available:", agencyErr);
    }

    const isAgencyAccount = teams.length > 1;

    console.log("Final teams found:", teams.length, teams);

    return new Response(
      JSON.stringify({ 
        teams, 
        isAgencyAccount,
        message: isAgencyAccount 
          ? "Agency account detected. Select a client team." 
          : teams.length === 1 
            ? "Single team account detected." 
            : "No teams found - will sync all available campaigns."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Fetch integration teams error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch teams", teams: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
