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

// ---------------------------------------------------------------------------
// Reply.io v3-only team discovery.
//
// Used by AddIntegrationDialog at integration-create time to auto-populate
// reply_team_id. Workspace keys (the normal case) return one team; agency
// keys may return many.
//
// Previous v1 fallbacks (/emailAccounts, /teams, /agency/clients,
// /campaigns) are gone — v3 /sequences carries teamId inline on every
// row, so it's the single canonical signal.
// ---------------------------------------------------------------------------

const REPLY_API_V3 = "https://api.reply.io/v3";

interface ReplyTeam {
  id: number | string;
  name: string;
  isAgency?: boolean;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

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

    // Single source of truth: /v3/sequences. Each sequence carries the
    // teamId of the workspace it belongs to. One page (top=100) is enough
    // for the common case — workspace keys typically return well under
    // 100 sequences, and even agency keys rarely span dozens of teams.
    console.log("Fetching v3 /sequences for team discovery...");
    try {
      const sequencesResponse = await fetch(`${REPLY_API_V3}/sequences?top=100`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });

      if (sequencesResponse.status === 401) {
        return new Response(
          JSON.stringify({ error: "Invalid API key", teams: [], recommendedTeamId: null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!sequencesResponse.ok) {
        console.log("v3 /sequences non-OK status:", sequencesResponse.status);
        const text = await sequencesResponse.text();
        console.log("v3 /sequences body:", text.slice(0, 500));
      } else {
        const sequencesData = await sequencesResponse.json();
        const items = Array.isArray(sequencesData.items) ? sequencesData.items : [];
        console.log("v3 /sequences items:", items.length);

        if (items.length > 0) {
          console.log("Sample v3 sequence fields:", Object.keys(items[0]));

          // Extract every unique teamId we see. Prefer teamId, fall back
          // to ownerUserId / ownerId if teamId is absent on a row (some
          // legacy sequences).
          for (const sequence of items) {
            const idToUse = sequence.teamId ?? sequence.ownerUserId ?? sequence.ownerId;
            if (idToUse !== undefined && idToUse !== null && !seenTeamIds.has(idToUse)) {
              seenTeamIds.add(idToUse);
              teams.push({
                id: idToUse,
                name: sequence.ownerName || sequence.teamName || `Team ${idToUse}`,
              });
              console.log("Discovered team:", { id: idToUse, name: sequence.ownerName || sequence.teamName });
            }
          }
        }
      }
    } catch (v3Err) {
      console.log("v3 /sequences fetch error:", v3Err);
    }

    const isAgencyAccount = teams.length > 1;

    // Single team detected → auto-fill reply_team_id in the UI. This is
    // the happy path for workspace keys.
    if (teams.length === 1) {
      recommendedTeamId = String(teams[0].id);
      console.log("Single team detected, recommendedTeamId:", recommendedTeamId);
    }

    console.log("Final teams found:", teams.length);
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
            : "No sequences found — create one in Reply.io first, then re-add this integration.",
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
