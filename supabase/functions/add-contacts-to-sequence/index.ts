// add-contacts-to-sequence — enrol enriched Apollo contacts into a synced
// Smartlead or Reply.io campaign, and record what was pushed.
//
// This is the irreversible step. Everything before it (search, enrich) can be
// re-run harmlessly; this one puts real prospects into a real sequence and
// cannot be undone from here.
//
// DESTINATION IS PER-PUSH. platform + synced_campaign_id arrive in the REQUEST,
// not from the audience row. An audience describes WHO to target; the same one
// can feed Reply.io this month and Smartlead next. The audience's default
// destination exists only for unattended runs, and the runner resolves it
// before calling here.
//
// UNLIKE add-to-smartlead-campaign / add-to-heyreach-campaign, this takes RAW
// CONTACTS, not a lead_id. Apollo results are never written to agent_leads —
// nothing about the search is persisted — so there is no lead row to point at.
// Those two functions also require a `message` because they are single-lead
// reply actions from the inbox; this is bulk cold enrolment, which has none.
//
// THREE GATES, in this order, per contact:
//   1. OPTED OUT — checked against agent_leads by normalized email/linkedin key.
//      Neither Apollo nor our push log knows about agent_leads, and re-mailing
//      someone who opted out is a compliance problem, not an annoyance. This is
//      the gate no schema can enforce.
//   2. ALREADY PUSHED — agent_audience_pushes, client-wide (user_id), not
//      per-audience: if two audiences match the same person, they must not both
//      enrol them.
//   3. CAPS — max_per_run, and max_total against the trigger-maintained
//      total_pushed.
//
// CLAIM-BEFORE-PUSH, deliberately. The push row is inserted BEFORE the platform
// call and deleted if that call fails. A crash in between therefore leaves a
// claim that blocks a re-push. That direction is chosen on purpose: a missed
// enrolment is recoverable by running again, a duplicate enrolment is not. The
// unique index doubles as the concurrency guard — two runs racing for the same
// person, one wins the insert and the other gets 23505 and skips.
//
// ONE CONTACT PER PLATFORM CALL. Smartlead's endpoint accepts a lead_list array
// and could take the whole batch at once, but its per-lead response shape is
// unverified, and guessing which of 25 leads failed is exactly the class of
// assumption that has bitten this codebase repeatedly. Per-contact calls give
// exact outcomes for the ledger. Batching is a later optimisation, once the
// response has been observed live.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeEmailKey, normalizeLinkedInUrl } from "../_shared/lead-dedup.ts";

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

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";
const REPLY_API_V3 = "https://api.reply.io/v3";

interface InboundContact {
  apollo_person_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  linkedin_url?: string;
}

type Outcome =
  | "pushed"
  | "skipped_opted_out"
  | "skipped_duplicate"
  | "skipped_no_email"
  | "skipped_cap"
  | "failed";

interface ContactResult {
  apollo_person_id: string | null;
  email: string | null;
  outcome: Outcome;
  external_ref?: string | null;
  error?: string;
}

function splitName(c: InboundContact): { first: string; last: string } {
  if (c.first_name || c.last_name) {
    return { first: (c.first_name ?? "").trim(), last: (c.last_name ?? "").trim() };
  }
  const parts = String(c.name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
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
    // ---- auth -------------------------------------------------------------
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

    const audienceId: string | undefined = body.audience_id;
    const runId: string | null = body.run_id ?? null;
    const contacts: InboundContact[] = Array.isArray(body.contacts) ? body.contacts : [];

    if (!audienceId) return json({ error: "audience_id is required" }, 400);
    if (contacts.length === 0) return json({ error: "contacts is empty" }, 400);

    // ---- destination comes from the REQUEST, not the audience ---------------
    // An audience describes WHO to target, not WHERE to send them, so the same
    // audience can feed Reply.io this month and Smartlead next. The caller
    // states the destination for THIS push; the audience only supplies a
    // default for unattended runs, which the runner resolves before calling us.
    const platform: string | undefined = body.platform;
    const campaignId: string | undefined = body.synced_campaign_id;
    if (!platform) return json({ error: "platform is required" }, 400);
    if (!campaignId) return json({ error: "synced_campaign_id is required" }, 400);

    // ---- audience, scoped to the caller ------------------------------------
    // .eq('user_id') is the ownership guard: a JWT caller passing someone
    // else's audience_id gets a 404, not their campaign.
    const { data: audience } = await supabase
      .from("agent_audiences")
      .select("id, user_id, max_per_run, max_total, total_pushed")
      .eq("id", audienceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!audience) return json({ error: "Audience not found" }, 404);

    const { data: campaign } = await supabase
      .from("synced_campaigns")
      .select("id, external_campaign_id, name, source, integration_id")
      .eq("id", campaignId)
      .maybeSingle();

    if (!campaign?.external_campaign_id) {
      return json({ error: "Campaign not found, or missing its external id" }, 400);
    }

    // ---- platform / campaign consistency -----------------------------------
    // platform and synced_campaigns.source use DIFFERENT spellings for the same
    // thing ('reply.io' vs 'reply_io'), so this cannot be a plain equality
    // check and is easy to omit entirely — which is what happened here first.
    //
    // It matters MORE now that the destination is caller-supplied rather than
    // stored: without it, a reply.io push aimed at a Smartlead campaign would
    // send a Smartlead campaign id to Reply.io's move-to-sequence. Both are
    // opaque identifiers, so that does not reliably fail — it could 404, or it
    // could coincidentally match a real but WRONG sequence and enrol live
    // prospects into it, with nothing downstream noticing.
    const PLATFORM_TO_SOURCE: Record<string, string> = {
      "smartlead": "smartlead",
      "reply.io": "reply_io",
    };
    const expectedSource = PLATFORM_TO_SOURCE[platform];
    if (!expectedSource) {
      return json({ error: `Unsupported platform: ${platform}` }, 400);
    }
    if (campaign.source !== expectedSource) {
      return json({
        error: "Campaign does not belong to the requested platform",
        detail: `platform=${platform} expects synced_campaigns.source=${expectedSource}, but that campaign is ${campaign.source}`,
      }, 400);
    }

    // ---- the platform key --------------------------------------------------
    const { data: integration } = await supabase
      .from("outbound_integrations")
      .select("id, api_key_encrypted")
      .eq("id", campaign.integration_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!integration?.api_key_encrypted) {
      return json({ error: `No active ${platform} integration for this campaign` }, 400);
    }
    const apiKey = integration.api_key_encrypted as string;

    // ---- caps ---------------------------------------------------------------
    let remaining = audience.max_per_run;
    if (audience.max_total !== null && audience.max_total !== undefined) {
      remaining = Math.min(remaining, Math.max(0, audience.max_total - audience.total_pushed));
    }

    const results: ContactResult[] = [];
    let pushed = 0;

    for (const c of contacts) {
      const apolloId = c.apollo_person_id ? String(c.apollo_person_id) : null;
      const emailKey = normalizeEmailKey(c.email);
      const linkedinKey = normalizeLinkedInUrl(c.linkedin_url);
      const record = (outcome: Outcome, extra: Partial<ContactResult> = {}) =>
        results.push({ apollo_person_id: apolloId, email: c.email ?? null, outcome, ...extra });

      if (remaining <= 0) { record("skipped_cap"); continue; }

      // Both v1 platforms key on email. No email means nothing to enrol.
      if (!emailKey) { record("skipped_no_email"); continue; }

      // ---- gate 1: opted out -----------------------------------------------
      // Checked on BOTH keys: the same person may exist in agent_leads under a
      // LinkedIn identity with no email, or vice versa.
      const optOutFilters = [`email.eq.${emailKey}`];
      if (linkedinKey) optOutFilters.push(`linkedin_url.ilike.%${linkedinKey}%`);
      const { data: optedOut } = await supabase
        .from("agent_leads")
        .select("id")
        .eq("user_id", userId)
        .eq("disposition_tag", "opted_out")
        .or(optOutFilters.join(","))
        .limit(1);

      if (optedOut && optedOut.length > 0) {
        console.log(`[add-contacts-to-sequence] opted-out skip for ${emailKey}`);
        record("skipped_opted_out");
        continue;
      }

      // ---- gate 2 + claim ---------------------------------------------------
      // The insert IS the duplicate check: the unique indexes on
      // (user_id, apollo_person_id) and (user_id, email_key) reject a repeat
      // with 23505, which is also what makes this safe against a concurrent run.
      const { data: claim, error: claimErr } = await supabase
        .from("agent_audience_pushes")
        .insert({
          audience_id: audience.id,
          user_id: userId,
          run_id: runId,
          apollo_person_id: apolloId ?? `email:${emailKey}`,
          email_key: emailKey,
          linkedin_key: linkedinKey,
          synced_campaign_id: campaignId,
          platform,
        })
        .select("id")
        .single();

      if (claimErr) {
        if (claimErr.code === "23505") { record("skipped_duplicate"); continue; }
        console.error(`[add-contacts-to-sequence] claim failed for ${emailKey}:`, claimErr.message);
        record("failed", { error: `claim failed: ${claimErr.message}` });
        continue;
      }

      // ---- push --------------------------------------------------------------
      const { first, last } = splitName(c);
      let externalRef: string | null = null;
      let pushError: string | null = null;

      try {
        if (platform === "smartlead") {
          // api_key travels in the QUERY STRING — never log this URL.
          const url = new URL(
            `${SMARTLEAD_API_BASE}/campaigns/${encodeURIComponent(String(campaign.external_campaign_id))}/leads`,
          );
          url.searchParams.set("api_key", apiKey);
          const res = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              lead_list: [{ first_name: first, last_name: last, email: c.email }],
              // Conservative, matching add-to-smartlead-campaign: we respect
              // dedup, blocklists and unsubscribes rather than overriding them.
              settings: {
                ignore_global_block_list: false,
                ignore_unsubscribe_list: false,
                ignore_community_bounce_list: false,
                ignore_duplicate_leads_in_other_campaign: false,
              },
            }),
          });
          if (!res.ok) {
            pushError = `Smartlead ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
          } else {
            // external_ref is meant to be the PLATFORM's id for the thing we
            // created, so a push can be traced back. Smartlead's response shape
            // for this endpoint has not been observed yet, so rather than
            // invent one, log it once and store whatever id-like field is
            // actually present. Revisit at the first real push.
            const j = await res.json().catch(() => ({}));
            console.log(`[add-contacts-to-sequence] smartlead response keys: ${Object.keys(j ?? {}).join(",")}`);
            const upserted = Array.isArray(j?.upload_status) ? j.upload_status[0] : null;
            externalRef = upserted?.lead_id != null
              ? String(upserted.lead_id)
              : j?.lead_id != null
              ? String(j.lead_id)
              : null;
            // A 200 does not guarantee the lead was accepted: Smartlead reports
            // blocked/duplicate/unsubscribed leads in the body, not the status.
            const blocked = Number(j?.already_added_to_campaign ?? 0) +
              Number(j?.invalid_emails_count ?? 0) +
              Number(j?.unsubscribed_leads_count ?? 0);
            if (Number(j?.upload_count ?? 0) === 0 && blocked > 0) {
              pushError = `Smartlead accepted the request but enrolled nobody (${JSON.stringify(j).slice(0, 160)})`;
            }
          }
        } else if (platform === "reply.io") {
          // Lifted from send-agent-reply, including its hard-won specifics:
          // POST /v3/contacts is CREATE-ONLY and 400s on a duplicate email, and
          // the create-body LinkedIn field is `linkedInUrl` (v3 silently drops
          // the `linkedInProfileUrl` that GET responses use).
          const authH = {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          };
          let contactId: number | null = null;

          const createRes = await fetch(`${REPLY_API_V3}/contacts`, {
            method: "POST",
            headers: authH,
            body: JSON.stringify({
              email: c.email,
              firstName: first,
              lastName: last,
              ...(c.linkedin_url ? { linkedInUrl: c.linkedin_url } : {}),
            }),
          });

          if (createRes.status === 201) {
            const b = await createRes.json().catch(() => ({}));
            contactId = typeof b?.id === "number" ? b.id : null;
          } else if (createRes.status === 400) {
            // Duplicate email, OR a genuine validation failure. A successful
            // lookup distinguishes them.
            const look = await fetch(
              `${REPLY_API_V3}/contacts?email=${encodeURIComponent(String(c.email))}&top=1`,
              { headers: authH },
            );
            const lb = await look.json().catch(() => null);
            const found = Array.isArray(lb) ? lb[0] : lb?.items?.[0];
            contactId = typeof found?.id === "number" ? found.id : null;
            if (contactId === null) {
              pushError = `Reply.io 400 and not findable by email: ${(await createRes.text().catch(() => "")).slice(0, 200)}`;
            }
          } else {
            pushError = `Reply.io create ${createRes.status}: ${(await createRes.text().catch(() => "")).slice(0, 200)}`;
          }

          if (contactId !== null && !pushError) {
            const seqId = Number(campaign.external_campaign_id);
            if (!Number.isFinite(seqId)) {
              pushError = `Reply.io sequenceId is not numeric: ${campaign.external_campaign_id}`;
            } else {
              const mv = await fetch(`${REPLY_API_V3}/contacts/${contactId}/move-to-sequence`, {
                method: "POST",
                headers: authH,
                body: JSON.stringify({ sequenceId: seqId }),
              });
              if (!mv.ok) {
                pushError = `Reply.io move-to-sequence ${mv.status}: ${(await mv.text().catch(() => "")).slice(0, 200)}`;
              } else {
                externalRef = String(contactId);
              }
            }
          }
        } else {
          pushError = `Unsupported platform: ${platform}`;
        }
      } catch (e) {
        pushError = `push threw: ${e instanceof Error ? e.message : String(e)}`;
      }

      if (pushError) {
        // Release the claim so a retry can legitimately try again. A crash
        // BEFORE reaching here leaves the claim in place — deliberately, per
        // the header.
        await supabase.from("agent_audience_pushes").delete().eq("id", claim.id);
        console.error(`[add-contacts-to-sequence] ${emailKey}: ${pushError}`);
        record("failed", { error: pushError });
        continue;
      }

      if (externalRef) {
        await supabase.from("agent_audience_pushes")
          .update({ external_ref: externalRef }).eq("id", claim.id);
      }
      remaining--;
      pushed++;
      record("pushed", { external_ref: externalRef });
    }

    const tally = results.reduce<Record<string, number>>((a, r) => {
      a[r.outcome] = (a[r.outcome] ?? 0) + 1;
      return a;
    }, {});

    console.log(
      `[add-contacts-to-sequence] audience=${audience.id} platform=${platform} ` +
        `campaign=${campaign.external_campaign_id} received=${contacts.length} ` +
        `${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    );

    return json({ success: true, pushed, received: contacts.length, tally, results });
  } catch (error) {
    console.error("[add-contacts-to-sequence] Fatal:", error);
    return json({ error: "Internal error" }, 500);
  }
});
