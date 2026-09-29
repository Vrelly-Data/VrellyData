// [recover-heyreach-leads v1]
//
// Re-pulls HeyReach conversations for an integration and fills in any missing
// agent_leads records or missing latest prospect replies since a given date.
//
// Security: verify_jwt = false (config.toml); gated by x-agent-key === AGENT_API_KEY.
//
// Request body:
//   {
//     integrationId: string,                // required
//     since?: string,                        // ISO; default 2026-09-15T00:00:00-04:00
//     dryRun?: boolean,                      // default true
//     conversationIds?: string[]             // optional allow-list of conversation ids
//   }
//
// Behavior:
// - Insert-only / fill-forward:
//   * For a missing lead: INSERT with inbox_status='pending' and NO draft.
//   * For an existing lead: only set last_reply_at + last_reply_text when newer.
// - Never calls classify-reply, send-agent-reply, or any send path. Never sends.
// - Never logs secrets.
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeLinkedinUrlForStorage } from "../_shared/normalize.ts";
import { findLeadByNormalizedLinkedIn } from "../_shared/agent-leads-lookup.ts";
import { cleanReplyPreview } from "../_shared/reply-text.ts";

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseSince(v: unknown): number {
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  // Default: 2026-09-15T00:00:00-04:00
  return new Date("2026-09-15T00:00:00-04:00").getTime();
}

const HEYREACH_API = "https://api.heyreach.io/api/public";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-agent-key",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth: x-agent-key
  const agentKey = req.headers.get("x-agent-key") || "";
  const expectedKey = Deno.env.get("AGENT_API_KEY") || "";
  if (!agentKey || agentKey !== expectedKey) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

  let body: Json = {};
  try {
    body = await req.json() as Json;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const integrationId = String(body["integrationId"] ?? "").trim();
  if (!integrationId) return json({ error: "integrationId is required" }, 400);
  const sinceMs = parseSince(body["since"]);
  const dryRun = body["dryRun"] !== false; // default true
  const maxConversations = Number.isFinite(Number(body["maxConversations"])) ? Number(body["maxConversations"]) : null;
  const filterConversationIds: Set<string> = new Set(
    Array.isArray(body["conversationIds"]) ? (body["conversationIds"] as unknown[]).map((v) => String(v ?? "")).filter(Boolean) : [],
  );
  if (!dryRun && filterConversationIds.size === 0 && !(Number.isFinite(maxConversations ?? NaN) && (maxConversations as number) > 0)) {
    return json({ error: "When dryRun=false, require conversationIds or maxConversations" }, 400);
  }

  try {
    // Resolve integration
    const { data: integration, error: intErr } = await supabase
      .from("outbound_integrations")
      .select("id, created_by, api_key_encrypted, platform")
      .eq("id", integrationId)
      .single();
    if (intErr || !integration) return json({ error: "Integration not found" }, 404);
    if ((integration as { platform?: string }).platform !== "heyreach") {
      return json({ error: "Integration is not a HeyReach connection" }, 400);
    }
    const userId = (integration as { created_by: string }).created_by;
    const apiKey = (integration as { api_key_encrypted: string | null }).api_key_encrypted;
    if (!apiKey) return json({ error: "Integration has no API key" }, 400);

    // Enumerate conversations
    const actions: Array<{
      conversationId: string;
      prospectName: string;
      linkedin_url: string | null;
      campaign: string | null;
      reply_time: string | null;
      reply_snippet: string;
      action: "insert_lead" | "update_reply" | "skip_up_to_date" | "skip_empty";
    }> = [];

    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let mutatedCount = 0;

    while (hasMore) {
      const res = await fetch(`${HEYREACH_API}/inbox/GetConversationsV2`, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          filters: {
            linkedInAccountIds: [],
            campaignIds: [], // recovery scans all; scope via conversationIds if provided
            searchString: "",
          },
          offset,
          limit,
        }),
      });
      if (!res.ok) {
        console.error(`[recover-heyreach-leads] GetConversationsV2 HTTP ${res.status}`);
        break;
      }
      const data = await res.json();
      const conversations = (data?.items ?? []) as Array<Record<string, unknown>>;
      const totalCount = Number(data?.totalCount ?? 0);

      const list = conversations.filter((c) => {
        const id = String(c?.id ?? "");
        if (!id) return false;
        if (filterConversationIds.size > 0 && !filterConversationIds.has(id)) return false;
        // Only conversations with a correspondent profile URL
        const profileUrl = String((c?.correspondentProfile as Json | undefined)?.profileUrl ?? "").trim();
        return !!profileUrl;
      });

      for (const convo of list) {
        if (!dryRun && maxConversations && mutatedCount >= maxConversations) {
          hasMore = false;
          break;
        }
        const conversationId = String(convo.id);
        const linkedInAccountId = Number(convo.linkedInAccountId);
        const profile = (convo.correspondentProfile ?? {}) as Json;
        const firstName = String(profile["firstName"] ?? "").trim();
        const lastName = String(profile["lastName"] ?? "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
        const linkedinUrl = sanitizeLinkedinUrlForStorage(String(profile["profileUrl"] ?? ""));
        // HeyReach GetConversationsV2 does not expose campaign id/name; do not misuse groupChat.
        const campaignName = null as string | null;
        if (!linkedinUrl) continue; // no dedup key

        // Fetch chatroom to find the last PROSPECT message since the cutoff
        let latestProspectTs: string | null = null;
        let latestProspectText = "";
        try {
          const chatroomRes = await fetch(
            `${HEYREACH_API}/inbox/GetChatroom/${linkedInAccountId}/${conversationId}`,
            { headers: { "X-API-KEY": apiKey, Accept: "application/json" } },
          );
          if (chatroomRes.ok) {
            const chatroom = await chatroomRes.json();
            const messages: Array<{ sender?: string; body?: unknown; createdAt?: string }> = Array.isArray(chatroom?.messages)
              ? chatroom.messages : [];
            for (const msg of messages) {
              if ((msg?.sender ?? "") !== "ME") {
                const ts = msg?.createdAt ? new Date(msg.createdAt).getTime() : NaN;
                const body = typeof msg?.body === "string" ? String(msg.body).trim() : "";
                if (Number.isFinite(ts) && ts >= sinceMs && body) {
                  // track the last non-empty prospect message meeting cutoff
                  latestProspectTs = new Date(ts).toISOString();
                  latestProspectText = body;
                }
              }
            }
          } else {
            console.warn(`[recover-heyreach-leads] GetChatroom ${chatroomRes.status} for ${conversationId}`);
          }
        } catch (e) {
          console.error(`[recover-heyreach-leads] Chatroom fetch failed for ${conversationId}:`, e);
        }

        if (!latestProspectTs) {
          // No qualifying prospect message since cutoff (or empty body)
          actions.push({
            conversationId,
            prospectName: fullName,
            linkedin_url: linkedinUrl,
            campaign: campaignName,
            reply_time: null,
            reply_snippet: "",
            action: "skip_empty",
          });
          continue;
        }

        // Determine existing lead and whether it's up-to-date
        const existing = await findLeadByNormalizedLinkedIn(supabase, userId, linkedinUrl);
        const priorMs = existing?.last_reply_at
          ? new Date(existing.last_reply_at).getTime()
          : 0;
        const newestMs = new Date(latestProspectTs).getTime();
        const isNewer = Number.isFinite(newestMs) && newestMs > priorMs;
        const replySnippet = cleanReplyPreview(latestProspectText);

        if (!existing) {
          actions.push({
            conversationId,
            prospectName: fullName,
            linkedin_url: linkedinUrl,
            campaign: campaignName,
            reply_time: latestProspectTs,
            reply_snippet: replySnippet,
            action: "insert_lead",
          });
          if (!dryRun) {
            mutatedCount++;
            const row = {
              user_id: userId,
              external_id: linkedinUrl || conversationId,
              full_name: fullName,
              email: null,
              job_title: null,
              company: String(profile["companyName"] ?? "") || null,
              last_reply_text: replySnippet,
              last_reply_at: latestProspectTs,
              // Deliberately do NOT call classify-reply. Insert as pending.
              inbox_status: "pending",
              channel: "linkedin",
              source: "heyreach",
              heyreach_conversation_id: conversationId,
              heyreach_account_id: linkedInAccountId,
              linkedin_url: linkedinUrl,
            };
            const { data: inserted, error: insertErr } = await supabase
              .from("agent_leads")
              .insert(row)
              .select("id")
              .single();
            if (insertErr && (insertErr as { code?: string }).code === "23505") {
              // Race: try reselect+update
              const raced = await findLeadByNormalizedLinkedIn(supabase, userId, linkedinUrl);
              if (raced?.id) {
                await supabase.from("agent_leads").update({
                  last_reply_text: replySnippet,
                  last_reply_at: latestProspectTs,
                }).eq("id", raced.id);
              } else {
                console.error(`[recover-heyreach-leads] 23505 on INSERT but no row found for ${conversationId}`);
              }
            } else if (insertErr) {
              console.error(`[recover-heyreach-leads] INSERT failed for ${conversationId}:`, insertErr);
            } else {
              // inserted ok
              void inserted;
            }
          }
        } else if (isNewer) {
          actions.push({
            conversationId,
            prospectName: fullName,
            linkedin_url: linkedinUrl,
            campaign: campaignName,
            reply_time: latestProspectTs,
            reply_snippet: replySnippet,
            action: "update_reply",
          });
          if (!dryRun) {
            mutatedCount++;
            const { error: updErr } = await supabase
              .from("agent_leads")
              .update({
                last_reply_text: replySnippet,
                last_reply_at: latestProspectTs,
              })
              .eq("id", existing.id);
            if (updErr) {
              console.error(`[recover-heyreach-leads] UPDATE failed for ${conversationId}:`, updErr);
            }
          }
        } else {
          actions.push({
            conversationId,
            prospectName: fullName,
            linkedin_url: linkedinUrl,
            campaign: campaignName,
            reply_time: latestProspectTs,
            reply_snippet: replySnippet,
            action: "skip_up_to_date",
          });
        }
      }

      offset += conversations.length;
      hasMore = conversations.length === limit && offset < totalCount;
      if (hasMore) {
        // Friendly pacing
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return json({ ok: true, dryRun, actions });
  } catch (err) {
    console.error("[recover-heyreach-leads] fatal:", err);
    return json({ error: "Internal error" }, 500);
  }
});

