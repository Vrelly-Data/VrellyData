// apollo-enrich — reveal email + linkedin_url for an EXPLICIT list of people.
//
// THIS FUNCTION SPENDS REAL MONEY. Apollo bills 1 credit per record where
// credit-consuming data is found (0 when nothing is found), and there is no
// test mode: dev and prod hit the same account and the same balance.
//
// Design rules that follow from that, all enforced below:
//   * it takes an explicit array of apollo_person_ids. There is NO "enrich the
//     last search" mode and no implicit fan-out;
//   * the batch is hard-capped at ENRICH_MAX_PER_CALL, so no single call can
//     cost more than that many credits;
//   * phone numbers are never requested (up to 8 credits each, needs a webhook,
//     and no sequence we push to uses one);
//   * personal emails are never requested — work emails are free of the
//     reveal_personal_emails surcharge and are what the sequences send to;
//   * it writes NOTHING to our database. Persisting a push is the caller's job
//     (agent_audience_pushes), because only the caller knows whether the push
//     actually succeeded.
//
// credits_spent comes from Apollo's OWN `credits_consumed` field on the
// bulk_match response, verified live 2026-08-16. An earlier version inferred it
// by counting records that came back with an email — a guess dressed as a
// number. agent_audience_runs.credits_spent must reconcile against the Apollo
// dashboard, so the reported value always wins; the count survives only as a
// fallback for a malformed response.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getApolloKeyForUser, ApolloKeyMissingError } from "../_shared/apollo-key.ts";
import {
  APOLLO_BASE,
  apolloHeaders,
  chunkIds,
  ENRICH_MAX_PER_CALL,
  readEnrichEnvelope,
  type ApolloEnrichedPerson,
} from "../_shared/apollo.ts";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    let userId: string | null = null;
    const agentKey = req.headers.get("x-agent-key");
    const expectedKey = Deno.env.get("AGENT_API_KEY");
    const authHeader = req.headers.get("authorization");

    const body = await req.json().catch(() => ({}));

    if (agentKey && expectedKey && agentKey === expectedKey) {
      userId = body.user_id ?? null;
      if (!userId) return json({ error: "user_id required when using x-agent-key" }, 400);
    } else if (authHeader?.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    // ---- the spend gate -----------------------------------------------------
    const rawIds = Array.isArray(body.person_ids) ? body.person_ids : null;
    if (!rawIds) {
      return json({ error: "person_ids must be an array of Apollo person ids" }, 400);
    }
    const ids = [...new Set(rawIds.map((s: unknown) => String(s).trim()).filter(Boolean))];
    if (ids.length === 0) {
      return json({ error: "person_ids is empty" }, 400);
    }
    if (ids.length > ENRICH_MAX_PER_CALL) {
      // Refuse rather than silently truncate. Silently enriching the first N
      // would leave the caller believing the rest were attempted.
      return json({
        error: `person_ids exceeds the per-call cap of ${ENRICH_MAX_PER_CALL}`,
        hint: "Split into smaller batches. The cap exists because each record can cost a real Apollo credit.",
        received: ids.length,
      }, 400);
    }

    let apollo;
    try {
      apollo = await getApolloKeyForUser(supabase, userId);
    } catch (e) {
      if (e instanceof ApolloKeyMissingError) {
        console.error(`[apollo-enrich] ${e.message}`);
        return json({ error: "Apollo is not configured for this account" }, 503);
      }
      throw e;
    }

    const t0 = Date.now();
    const people: ApolloEnrichedPerson[] = [];
    const failedChunks: Array<{ ids: string[]; status: number; detail: string }> = [];
    // Apollo REPORTS what it charged. Sum the reported figures; only fall back
    // to counting records-with-data if a chunk omits the field.
    let reportedCredits = 0;
    let anyCreditsReported = false;
    let missingRecords = 0;

    for (const chunk of chunkIds(ids)) {
      const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
        method: "POST",
        headers: apolloHeaders(apollo.key),
        body: JSON.stringify({
          // Never true. See the header.
          reveal_personal_emails: false,
          reveal_phone_number: false,
          details: chunk.map((id) => ({ id })),
        }),
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        console.error(`[apollo-enrich] bulk_match HTTP ${res.status}: ${detail}`);
        // Record and continue: one bad chunk must not discard the ones that
        // already succeeded (and were already paid for).
        failedChunks.push({ ids: chunk, status: res.status, detail });
        continue;
      }

      const env = readEnrichEnvelope(await res.json());
      people.push(...env.people);
      if (env.creditsConsumed !== null) {
        reportedCredits += env.creditsConsumed;
        anyCreditsReported = true;
      }
      if (env.missingRecords !== null) missingRecords += env.missingRecords;
      if (env.errorMessage) {
        console.warn(`[apollo-enrich] Apollo error_message on a 200: ${env.errorMessage}`);
      }
    }

    // Prefer Apollo's own figure over any inference of ours.
    const countedFallback = people.filter((p) => p.email || p.linkedin_url).length;
    const creditsSpent = anyCreditsReported ? reportedCredits : countedFallback;
    const alreadyRevealed = people.filter((p) => p.revealed_for_current_team === true).length;

    console.log(
      `[apollo-enrich] user=${userId} key_source=${apollo.source} requested=${ids.length} ` +
        `matched=${people.length} with_email=${people.filter((p) => p.email).length} ` +
        `credits_spent=${creditsSpent} already_revealed=${alreadyRevealed} ` +
        `failed_chunks=${failedChunks.length} ms=${Date.now() - t0}`,
    );

    return json({
      success: true,
      requested: ids.length,
      people,
      // Ids Apollo returned nothing for. These cost 0 credits and are worth
      // surfacing: a person with no work email cannot be pushed to an
      // email-keyed platform.
      unmatched: ids.filter((id) => !people.some((p) => p.apollo_person_id === id)),
      credits_spent: creditsSpent,
      already_revealed_for_team: alreadyRevealed,
      key_source: apollo.source,
      failed_chunks: failedChunks.map((f) => ({ ids: f.ids, status: f.status })),
    });
  } catch (error) {
    console.error("[apollo-enrich] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
