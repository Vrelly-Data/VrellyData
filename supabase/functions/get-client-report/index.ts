// [get-client-report v1]
//
// PUBLIC, READ-ONLY endpoint. NO JWT, NO auth header expected.
//
// Accepts a token (via ?token= query param OR JSON body { token: "..." }).
// Looks the token up under the service role, validates it's not revoked,
// and returns the report data for the ONE client the token is bound to.
//
// Security invariants (all enforced server-side):
//   * The caller's request body is NEVER trusted for client identification.
//     The only field we read from the request is `token`. The client_id
//     used for every subsequent query is the one stored on the token row.
//   * Missing token / unknown token / revoked token → always 404 with the
//     same generic body. Don't leak whether a given token exists.
//   * No public RLS policy exists on report_tokens — service role is the
//     only path to read it. If this function is ever bypassed, the table
//     stays sealed at the RLS level.
//   * CORS open (Access-Control-Allow-Origin: *) so the report can be
//     embedded on any future white-label domain. If a customer requires
//     a domain allowlist, narrow this at deploy time.
//
// What's returned:
//   {
//     client: { display_name },
//     snapshots: [...]  -- most recent first
//     priorities: [...]  -- the per-client running checklist
//     responders: [...]  -- agent_leads scoped to this client's selections
//     campaigns: [...]   -- bar-chart data, scoped to this client's selections
//   }
//
// Responder scoping (SHOW-ALL, owner-scoped):
//
//   Each user maps to exactly one client, so the report owner's replied leads
//   ARE this client's responses. fetchResponders() returns every replied lead
//   for the client's user_id (channel/source agnostic), mirroring the admin
//   RespondersList exactly.
//
//   History: an earlier version scoped by Smartlead campaign IDs + HeyReach
//   account IDs (with an early return when the client had neither). That had no
//   Reply.io branch, so Reply.io leads — which carry no SL campaign / HR
//   account attribution — were never returned, and a Reply.io client's share
//   link showed "Responses (0)" while the owner saw the full list. Replaced
//   with SHOW-ALL parity. If users ever map to multiple clients, this must be
//   revisited with a real per-client attribution key (none exists for Reply.io
//   leads today).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Truly public endpoint — wildcard CORS. Tighten if a customer needs a
// domain allowlist.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[get-client-report] ${step}${detailsStr}`);
};

const NOT_FOUND_BODY = JSON.stringify({ error: "Report not found" });
function notFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ClientRow {
  id: string;
  user_id: string;
  display_name: string;
  heyreach_account_ids: number[];
  smartlead_campaign_ids: string[];
}

type Supabase = ReturnType<typeof createClient>;

async function fetchResponders(
  supabase: Supabase,
  client: ClientRow,
): Promise<unknown[]> {
  // SHOW-ALL parity with the admin view. Each user maps to one client, so the
  // report owner's replied leads ARE this client's responses — fetch every
  // replied lead for client.user_id, regardless of channel/source. This is a
  // byte-for-byte mirror of the self-fetch query in the admin RespondersList
  // (src/components/playground/RespondersList.tsx): same columns, same filter.
  //
  // The previous implementation scoped by Smartlead campaign IDs + HeyReach
  // account IDs only, with an early return when the client had neither. That
  // excluded Reply.io leads entirely (source='reply_io' leads carry no SL
  // campaign / HR account attribution), so a Reply.io client's share link
  // showed "Responses (0)" while the owner saw the full list.
  const { data, error } = await supabase
    .from("agent_leads")
    .select(
      "id, full_name, company, job_title, email, linkedin_url, channel, intent, inbox_status, pipeline_stage, disposition_tag, last_reply_text, last_reply_at, reply_thread",
    )
    .eq("user_id", client.user_id)
    .or("inbox_status.eq.replied,last_reply_at.not.is.null");

  if (error) {
    logStep("Responders fetch failed", { error: error.message });
    return [];
  }
  // Derive a client-safe sender_name from reply_thread (the fromName on the most
  // recent role:'sender' outbound message) so the report board can offer a
  // sender filter without shipping any new sensitive field.
  return (data ?? []).map((r) => ({ ...r, sender_name: deriveSenderName(r.reply_thread) }));
}

// Mirror of the frontend's deriveSenderFromThread — latest sender's fromName.
function deriveSenderName(thread: unknown): string | null {
  if (!Array.isArray(thread)) return null;
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i] as { role?: string; fromName?: string | null } | null;
    if (m?.role === "sender" && m.fromName && String(m.fromName).trim()) {
      return String(m.fromName).trim();
    }
  }
  return null;
}

// fetchBarChartCampaigns + SyncedCampaignRow + pickNumber removed:
// after the snapshot-history rewrite + per-campaign-stats addition, every
// snapshot carries its own stats_snapshot.heyreach.per_campaign[] +
// stats_snapshot.smartlead.per_campaign[]. The public report's frontend
// derives the chart data from the SELECTED snapshot — same code path as
// the admin tab — so we no longer need a server-side synced_campaigns
// projection here.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let token: string | null = null;

    // Accept token from POST body OR ?token= query param. URL query takes
    // precedence over body in practice (browsers love GETs for share
    // links), but we read body first because POST is the conventional
    // shape; URL fallback handles GET.
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const t = (body as { token?: string }).token;
      if (typeof t === "string" && t.trim()) token = t.trim();
    }
    if (!token) {
      const qp = url.searchParams.get("token");
      if (qp && qp.trim()) token = qp.trim();
    }

    if (!token) return notFound();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Token lookup. maybeSingle returns null (not an error) when no match.
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("report_tokens")
      .select("id, client_id, revoked")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr) {
      logStep("Token lookup error", { error: tokenErr.message });
      return notFound(); // generic error to avoid leaking
    }
    if (!tokenRow || tokenRow.revoked) {
      return notFound();
    }

    // ---- THE ISOLATION GUARANTEE ------------------------------------------
    // From this point on, every query is scoped to clientIdFromToken.
    // The caller's request is never consulted for client identification.
    const clientIdFromToken = tokenRow.client_id as string;

    const { data: clientRowRaw, error: clientErr } = await supabase
      .from("client_analysis")
      .select(
        "id, user_id, display_name, heyreach_account_ids, smartlead_campaign_ids",
      )
      .eq("id", clientIdFromToken)
      .maybeSingle();

    if (clientErr || !clientRowRaw) {
      // Token references a deleted client — same response as a bad token.
      // (FK is ON DELETE CASCADE so the token will normally be gone too,
      // but a race during delete could land us here.)
      return notFound();
    }
    const client: ClientRow = {
      id: String(clientRowRaw.id),
      user_id: String(clientRowRaw.user_id),
      display_name: String(clientRowRaw.display_name),
      heyreach_account_ids:
        (clientRowRaw.heyreach_account_ids as number[]) ?? [],
      smartlead_campaign_ids:
        (clientRowRaw.smartlead_campaign_ids as string[]) ?? [],
    };

    // Parallel fetch the four data blocks; each is independent and any
    // single failure shouldn't take down the whole response.
    const [snapsRes, prioritiesRes, responders] = await Promise.all([
      supabase
        .from("client_analysis_snapshots")
        .select(
          "id, analysis_text, stats_snapshot, range, period_start, period_end, created_at",
        )
        .eq("client_id", client.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("client_checklist_items")
        .select("id, text, done, done_at, source, sort_order, created_at")
        .eq("client_analysis_id", client.id)
        .order("sort_order", { ascending: true }),
      fetchResponders(supabase, client),
    ]);

    if (snapsRes.error) {
      logStep("Snapshots fetch error", { error: snapsRes.error.message });
    }
    if (prioritiesRes.error) {
      logStep("Priorities fetch error", { error: prioritiesRes.error.message });
    }

    return new Response(
      JSON.stringify({
        client: { display_name: client.display_name },
        snapshots: snapsRes.data ?? [],
        priorities: prioritiesRes.data ?? [],
        responders,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Fatal error", { error: msg });
    // Generic 500 — don't leak internal details to public callers.
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
