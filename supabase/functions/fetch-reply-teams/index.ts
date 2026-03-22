const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLY_API_BASE = "https://api.reply.io/v1";
const REPLY_API_V3 = "https://api.reply.io/v3";

interface ReplyTeam {
  id: number | string;
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

    const teams: ReplyTeam[] = [];
    const seenTeamIds = new Set<number | string>();
    let recommendedTeamId: string | null = null;

    // Primary method: Use V3 API /sequences endpoint which has proper teamId/ownerId
    console.log("Fetching sequences from V3 API for team discovery...");
    try {
      const sequencesResponse = await fetch(`${REPLY_API_V3}/sequences?limit=100`, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (sequencesResponse.status === 401) {
        return new Response(
          JSON.stringify({ error: "Invalid API key", teams: [], recommendedTeamId: null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (sequencesResponse.ok) {
        const sequencesData = await sequencesResponse.json();
        console.log("V3 Sequences count:", sequencesData.items?.length || 0);
        
        if (sequencesData.items && Array.isArray(sequencesData.items) && sequencesData.items.length > 0) {
          console.log("Sample V3 sequence fields:", Object.keys(sequencesData.items[0]));
          
          // Extract unique teamId values from sequences
          for (const sequence of sequencesData.items) {
            const teamId = sequence.teamId;
            const ownerId = sequence.ownerId;
            
            // Prefer teamId, fall back to ownerId
            const idToUse = teamId || ownerId;
            
            if (idToUse && !seenTeamIds.has(idToUse)) {
              seenTeamIds.add(idToUse);
              teams.push({
                id: idToUse,
                name: sequence.ownerName || sequence.name || `Team ${idToUse}`,
              });
              console.log("Found team from V3 sequence:", { id: idToUse, name: sequence.ownerName || sequence.name });
            }
          }
        }
      } else {
        console.log("V3 Sequences endpoint status:", sequencesResponse.status);
      }
    } catch (v3Err) {
      console.log("V3 Sequences endpoint error:", v3Err);
    }

    // Fallback methods if V3 didn't find anything
    if (teams.length === 0) {
      // Try 1: Fetch email accounts (may contain team info)
      console.log("Fallback: Fetching email accounts from Reply.io...");
      try {
        const emailAccountsResponse = await fetch(`${REPLY_API_BASE}/emailAccounts`, {
          method: "GET",
          headers: {
            "X-Api-Key": apiKey,
            "Content-Type": "application/json",
          },
        });

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
      } catch (emailErr) {
        console.log("Email accounts endpoint error:", emailErr);
      }

      // Try 2: Dedicated teams endpoint
      console.log("Fallback: Trying /teams endpoint...");
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

      // Try 3: Agency clients endpoint (for agency accounts)
      console.log("Fallback: Trying /agency/clients endpoint...");
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
    }

    // Last resort fallback: Extract unique ownerEmails from V1 campaigns
    if (teams.length === 0) {
      console.log("Last resort: Extracting unique ownerEmails from V1 campaigns...");
      try {
        const campaignsResponse = await fetch(`${REPLY_API_BASE}/campaigns?limit=100`, {
          method: "GET",
          headers: {
            "X-Api-Key": apiKey,
            "Content-Type": "application/json",
          },
        });

        if (campaignsResponse.ok) {
          const campaignsData = await campaignsResponse.json();
          console.log("V1 Campaigns count:", Array.isArray(campaignsData) ? campaignsData.length : 0);
          
          if (Array.isArray(campaignsData) && campaignsData.length > 0) {
            const seenEmails = new Set<string>();
            
            for (const campaign of campaignsData) {
              const ownerEmail = campaign.ownerEmail;
              
              if (ownerEmail && !seenEmails.has(ownerEmail)) {
                seenEmails.add(ownerEmail);
                // Use email as both ID and name for fallback
                teams.push({
                  id: ownerEmail,
                  name: ownerEmail,
                });
                console.log("Found owner email from V1 campaign:", ownerEmail);
              }
            }
          }
        }
      } catch (campaignsErr) {
        console.log("V1 Campaigns fallback error:", campaignsErr);
      }
    }

    // Determine if this is an agency account (multiple teams)
    const isAgencyAccount = teams.length > 1;

    // Set recommendedTeamId if we found exactly one team
    // This helps UI auto-fill for large single-team accounts
    if (teams.length === 1) {
      recommendedTeamId = String(teams[0].id);
      console.log("Single team detected, setting recommendedTeamId:", recommendedTeamId);
    }

    console.log("Final teams found:", teams.length, teams);
    console.log("isAgencyAccount:", isAgencyAccount, "recommendedTeamId:", recommendedTeamId);

    return new Response(
      JSON.stringify({ 
        teams, 
        isAgencyAccount,
        recommendedTeamId,
        message: isAgencyAccount 
          ? "Agency account detected. Please select a client team." 
          : teams.length === 1 
            ? `Team detected: ${teams[0].name}. Team ID auto-filled for reliable sync.` 
            : "No teams found - will sync all available campaigns."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Fetch teams error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch teams", teams: [], recommendedTeamId: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
