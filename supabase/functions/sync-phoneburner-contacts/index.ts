// [sync-phoneburner-contacts v1]
//
// Watermark-pulls PhoneBurner contacts and upserts into phoneburner_contacts.
// Matching: person_key = lower(email) when available; no agent_leads writes.
// Scope: one integration (team-bound). Best-effort, additive only.

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
      "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

const PB_API_BASE = "https://www.phoneburner.com/rest/1";
const PAGE_SIZE = 100;
// Update progress every N pages during long runs so the UI isn't stuck
const PROGRESS_UPDATE_EVERY_PAGES = 5;

// Very small E.164 normalizer (US-heavy, but preserves other CCs).
function normalizePhoneE164(input: unknown): string | null {
  const s = typeof input === "string" ? input : String(input ?? "");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

function toIsoUTC(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Extract contacts array from PhoneBurner response.
// Official shape per docs:
// {
//   "http_status": 200,
//   "contacts": {
//     "contacts": [ ... ],
//     "page_size": N, "total_results": "...", "page": 1, "total_pages": N
//   }
// }
function extractContacts(data: any): { items: any[]; page?: number; totalPages?: number; pageSize?: number; totalResults?: number } {
  try {
    const wrapper = data?.contacts;
    const nested = wrapper?.contacts;
    let items: any[] = [];
    if (Array.isArray(nested)) {
      items = nested;
    } else if (nested && typeof nested === "object") {
      items = [nested];
    } else if (Array.isArray(data)) {
      items = data;
    } else if (Array.isArray(data?.data)) {
      items = data.data;
    } else if (Array.isArray(data?.items)) {
      items = data.items;
    } else if (Array.isArray(data?.contacts)) {
      // legacy heuristic fallback
      items = data.contacts;
    }
    const page = typeof wrapper?.page === "number" ? wrapper.page : undefined;
    const totalPages = typeof wrapper?.total_pages === "number" ? wrapper.total_pages : undefined;
    const pageSize = typeof wrapper?.page_size === "number" ? wrapper.page_size : undefined;
    const totalResultsRaw = wrapper?.total_results;
    const totalResults = typeof totalResultsRaw === "number"
      ? totalResultsRaw
      : (typeof totalResultsRaw === "string" ? Number(totalResultsRaw) : undefined);
    return { items, page, totalPages, pageSize, totalResults };
  } catch {
    return { items: [] };
  }
}

// GET /contacts?updated_from&per_page&page (defensive to unknown param names)
async function fetchContactsPage(
  token: string,
  updatedFrom: string | null,
  page: number,
): Promise<{ items: any[]; hasMore: boolean; diag: Record<string, unknown> }> {
  const url = new URL(`${PB_API_BASE}/contacts`);
  // Try multiple conventional param names to maximize compatibility
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(PAGE_SIZE));
  url.searchParams.set("per_page", String(PAGE_SIZE));
  if (updatedFrom) {
    url.searchParams.set("updated_from", updatedFrom);
    url.searchParams.set("updated_at_from", updatedFrom);
    url.searchParams.set("modified_after", updatedFrom);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PhoneBurner /contacts error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  const topKeys = Object.keys(data || {});
  const { items, page: curPage, totalPages, pageSize, totalResults } = extractContacts(data);
  const hasMore = typeof totalPages === "number" && typeof curPage === "number"
    ? curPage < totalPages
    : items.length === PAGE_SIZE; // fallback
  const diag = {
    topKeys,
    wrapperKeys: Object.keys((data?.contacts as Record<string, unknown>) || {}),
    page: curPage,
    totalPages,
    pageSize,
    totalResults,
    extracted: items.length,
  };
  return { items, hasMore, diag };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let integrationId: string | undefined;
  try {
    const body = await req.json();
    integrationId = body?.integrationId;
    if (!integrationId) {
      return new Response(JSON.stringify({ error: "Missing integrationId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine auth mode: internal (service role) vs user JWT
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternal = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const db = isInternal ? serviceClient : userClient;

    // Load integration
    const { data: integration, error: intErr } = await db
      .from("outbound_integrations")
      .select("id, team_id, platform, api_key_encrypted")
      .eq("id", integrationId)
      .single();
    if (intErr || !integration) {
      throw new Error("Integration not found or access denied");
    }
    if ((integration.platform || "").toLowerCase() !== "phoneburner") {
      throw new Error("Integration is not a PhoneBurner connection");
    }
    const teamId: string = integration.team_id;
    const token: string = integration.api_key_encrypted;

    // Mark syncing at start (best-effort)
    try {
      await serviceClient
        .from("outbound_integrations")
        .update({ sync_status: "syncing", sync_error: null, updated_at: new Date().toISOString() })
        .eq("id", integrationId);
    } catch (e) {
      console.warn("[sync-phoneburner-contacts] failed to mark syncing:", e);
    }

    // Determine watermark from last synced contact
    const { data: wmRow } = await serviceClient
      .from("phoneburner_contacts")
      .select("pb_updated_at")
      .eq("integration_id", integrationId)
      .order("pb_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const updatedFrom: string | null = wmRow?.pb_updated_at ?? null;
    console.log(`[sync-phoneburner-contacts] integration=${integrationId} team=${teamId} updated_from=${updatedFrom ?? "(full)"}`);

    // Pull pages
    let pulledTotal = 0;
    let upsertedTotal = 0;
    let insertedTotal = 0;
    let pagesProcessed = 0;
    let sampleError: string | null = null;
    for (let page = 1; page <= 1000; page++) {
      const { items, hasMore, diag } = await fetchContactsPage(token, updatedFrom, page);
      // Safe diagnostics — never log tokens
      try {
        console.log(`[sync-phoneburner-contacts] page=${diag.page ?? page}/${diag.totalPages ?? "?"} extracted=${diag.extracted} topKeys=${(diag.topKeys as string[]).join(",")}`);
        if (typeof diag.totalResults === "number") {
          console.log(`[sync-phoneburner-contacts] contacts.total_results=${diag.totalResults} page_size=${diag.pageSize ?? "?"}`);
        }
      } catch { /* ignore logging issues */ }

      if (items.length === 0) break;
      pulledTotal += items.length;
      pagesProcessed++;
      // Map to row shape
      const pageUpserts: any[] = [];
      for (const c of items) {
        // Official ids + defensive fallbacks
        const pbId = String(c?.contact_user_id ?? c?.id ?? c?.contact_id ?? c?.pb_contact_id ?? "");
        if (!pbId) continue;
        const emailVal =
          c?.primary_email?.email_address ??
          c?.email_address ??
          c?.email ??
          c?.primaryEmail ??
          "";
        const email = typeof emailVal === "string" && emailVal ? String(emailVal).toLowerCase() : null;
        const fullName =
          c?.full_name ||
          [c?.first_name, c?.last_name].filter((v: unknown) => typeof v === "string" && v.trim()).join(" ") ||
          c?.name ||
          null;
        const rawPhone = c?.primary_phone?.raw_phone ?? c?.phone ?? c?.primary_phone ?? c?.primaryPhone ?? null;
        const phoneE164 = normalizePhoneE164(rawPhone);
        let updatedAt =
          c?.date_modified || c?.updated_at || c?.modified_at || c?.last_modified || c?.last_updated || c?.updated || c?.date_added || null;
        if (!updatedAt) {
          // capture one example for diagnostics
          if (!sampleError) sampleError = "missing-updatedAt";
          updatedAt = new Date().toISOString();
        }
        const personKey = email ? email.toLowerCase() : null;

        pageUpserts.push({
          integration_id: integrationId,
          team_id: teamId,
          pb_contact_id: pbId,
          email,
          full_name: fullName,
          raw_phone: rawPhone || null,
          phone_e164: phoneE164,
          person_key: personKey,
          pb_updated_at: new Date(updatedAt).toISOString(),
          raw: c,
          updated_at: new Date().toISOString(),
        });
      }

      // Upsert this page immediately to avoid large memory usage/timeouts
      if (pageUpserts.length > 0) {
        const { data: res, error: upErr, status } = await serviceClient
          .from("phoneburner_contacts")
          .upsert(pageUpserts, { onConflict: "integration_id,pb_contact_id" })
          .select("id");
        if (upErr) {
          throw new Error(`Upsert failed (${status ?? "?"}): ${upErr.message}`);
        }
        const touched = res?.length ?? 0;
        upsertedTotal += touched;
        insertedTotal += touched; // PostgREST doesn't differentiate; report touched as inserted
      }

      // Periodic progress ping so UI doesn't appear stuck during long runs
      try {
        if (pagesProcessed % PROGRESS_UPDATE_EVERY_PAGES === 0) {
          await serviceClient
            .from("outbound_integrations")
            .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", integrationId);
        }
      } catch (e) {
        console.warn("[sync-phoneburner-contacts] progress update failed:", e);
      }

      if (!hasMore) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    // Status lifecycle: success OR empty still counts as 'synced'
    try {
      await serviceClient
        .from("outbound_integrations")
        .update({
          sync_status: "synced",
          sync_error: null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", integrationId);
    } catch (e) {
      console.warn("[sync-phoneburner-contacts] failed to update integration status:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        pulled: pulledTotal,
        upserted: upsertedTotal,
        inserted: insertedTotal,
        updated: 0,
        pages: pagesProcessed,
        updatedFrom: updatedFrom ?? null,
        ...(sampleError ? { sampleError } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-phoneburner-contacts] error:", msg);
    // Status lifecycle: hard failure → 'error'
    try {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      if (integrationId) {
        await serviceClient
          .from("outbound_integrations")
          .update({
            sync_status: "error",
            sync_error: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integrationId);
      }
    } catch (e) {
      console.warn("[sync-phoneburner-contacts] failed to record error status:", e);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

