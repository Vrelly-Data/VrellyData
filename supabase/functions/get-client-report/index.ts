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
// Responder scoping (read carefully — diverges slightly from the spec):
//
//   The build spec proposed filtering HeyReach leads via
//   `campaign_external_id IN (the client's heyreach campaign external ids)`.
//   But client_analysis stores `heyreach_account_ids` (LinkedIn SENDER
//   account IDs), NOT campaign IDs. Verified by reading the schema:
//
//     * client_analysis.heyreach_account_ids       INTEGER[]  (sender accounts)
//     * agent_leads.heyreach_account_id            INTEGER    (sender account)
//     * agent_leads.campaign_external_id           TEXT       (campaign id, new)
//
//   The semantic match is therefore:
//     LinkedIn:  agent_leads.heyreach_account_id IN client.heyreach_account_ids
//     Email:     agent_leads.smartlead_campaign_id IN client.smartlead_campaign_ids
//
//   This is what's implemented below. Bonus: account-level matching captures
//   all historical leads (including pre-backfill ones where
//   campaign_external_id is still NULL).
//
//   A lead whose smartlead_campaign_id and heyreach_account_id are BOTH
//   null is excluded by the IN filters and never returned, satisfying the
//   spec's "no matching attribution → not returned" requirement.

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
  const slIds = client.smartlead_campaign_ids ?? [];
  const hrAccounts = client.heyreach_account_ids ?? [];
  if (slIds.length === 0 && hrAccounts.length === 0) return [];

  let query = supabase
    .from("agent_leads")
    .select(
      "id, full_name, company, job_title, channel, intent, intent_confidence, last_reply_at, last_reply_text, reply_thread, email, linkedin_url",
    )
    .eq("user_id", client.user_id);

  // PostgREST `or` syntax: comma-separated `column.op.value` clauses inside
  // a single `.or()`. For `in`, the value list is wrapped in parens; text
  // values get quoted to avoid commas-in-id breaking the parser.
  const clauses: string[] = [];
  if (slIds.length > 0) {
    const escaped = slIds
      .map((id) => `"${String(id).replace(/"/g, '\\"')}"`)
      .join(",");
    clauses.push(`smartlead_campaign_id.in.(${escaped})`);
  }
  if (hrAccounts.length > 0) {
    clauses.push(`heyreach_account_id.in.(${hrAccounts.join(",")})`);
  }
  query = query.or(clauses.join(","));

  const { data, error } = await query;
  if (error) {
    logStep("Responders fetch failed", { error: error.message });
    return [];
  }
  return data ?? [];
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
