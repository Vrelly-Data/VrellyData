// Capture Scope — Smartlead adapter. Stage 2 of 5.
//
// Reads the campaign list from synced_campaigns (already populated by
// sync-smartlead-campaigns) rather than the vendor API, so opening the dialog
// costs one query regardless of campaign count. Only senders go live, and only
// for a bounded page — see the rate-limit note in capture-scope.ts.

import {
  type CaptureScopeAdapter,
  type CaptureScopeCampaign,
  type CaptureScopeIntegration,
  type CaptureScopeSender,
  MAX_SENDER_LOOKUP,
  normalizeStatus,
} from "./capture-scope.ts";

const API = "https://server.smartlead.ai/api/v1";

// Smartlead auth is a QUERY parameter, so the full URL contains the credential.
// Built via URLSearchParams and never logged — same rule as
// sync-smartlead-campaigns.
async function slGet(path: string, apiKey: string): Promise<unknown | null> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (res.ok) return await res.json().catch(() => null);
    // 429 is expected under load; back off rather than dropping the campaign,
    // which would silently render it as "no senders".
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    console.warn(`[capture-scope/smartlead] ${path} -> HTTP ${res.status}`);
    return null;
  }
  console.warn(`[capture-scope/smartlead] ${path} -> gave up after 429 retries`);
  return null;
}

// Smartlead's "client" — the sub-tenant that put a separate business
// (captarget) inside SourceCo's account. Lives on the synced raw_data blob, so
// grouping costs no API call.
function readGroupId(rawData: Record<string, unknown> | null): string | null {
  const id = rawData?.client_id;
  if (id === null || id === undefined || id === "") return null;
  return String(id);
}

// Resolve client ids to human names via GET /client/ — ONE call for the whole
// list, not per campaign. Without it the UI shows "Client 543064" instead of
// "Elly", which is the difference between a reviewer recognising that a
// separate business is inside this account and not.
// Best-effort: on failure we fall back to the raw id rather than failing the
// whole listing, since grouping is an affordance and the campaign list is not.
async function loadClientLabels(apiKey: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!apiKey) return out;
  const body = await slGet("/client/", apiKey);
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
    ? (body as { data: unknown[] }).data
    : [];
  for (const r of rows as Record<string, unknown>[]) {
    if (r.id === undefined || r.id === null) continue;
    const name = String(r.name ?? "").trim();
    const email = String(r.email ?? "").trim();
    // Domain is the useful discriminator — "Elly (captarget.com)" reads as a
    // different business at a glance in a way a first name alone does not.
    const domain = email.includes("@") ? email.split("@").pop() : "";
    out.set(String(r.id), domain ? `${name || r.id} (${domain})` : (name || String(r.id)));
  }
  return out;
}

// stats is written by sync-smartlead-campaigns from /analytics, but only a
// subset of campaigns ever get a successful analytics fetch (102 of 379 on
// prod carry non-zero figures). An absent analytics blob means UNKNOWN, not
// zero — collapsing the two would render "0 sent" for a campaign that sent
// thousands, which is a worse lie than showing nothing.
function readVolume(stats: Record<string, unknown> | null) {
  const raw = stats?.smartlead_raw_analytics;
  const fetched = !!raw && typeof raw === "object" && Object.keys(raw as object).length > 0;
  if (!fetched) return { sent: null, replies: null };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { sent: num(stats?.sent), replies: num(stats?.replies) };
}

export const smartleadCaptureScopeAdapter: CaptureScopeAdapter = {
  platform: "smartlead",

  async listCampaigns(db, integration): Promise<CaptureScopeCampaign[]> {
    // Scoped by integration_id — the same key the sync upserts conflict on.
    // Scoping by team_id instead would merge two Smartlead integrations on one
    // team into a single undifferentiated list.
    const { data, error } = await db
      .from("synced_campaigns")
      .select("external_campaign_id, name, status, raw_status, capture_enabled, stats, raw_data")
      .eq("integration_id", integration.id)
      .order("name", { ascending: true });

    if (error) throw new Error(`synced_campaigns lookup failed: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];

    // Only pay for the client lookup when this account actually uses clients.
    const hasGroups = rows.some((r) => readGroupId(r.raw_data as Record<string, unknown> | null));
    const labels = hasGroups
      ? await loadClientLabels(integration.api_key_encrypted)
      : new Map<string, string>();

    return rows.map((row) => {
      const groupId = readGroupId(row.raw_data as Record<string, unknown> | null);
      return {
        externalId: String(row.external_campaign_id),
        // ?? only catches null/undefined; Smartlead returns "" for some
        // draft campaigns, which rendered as a blank row in the dialog.
        name: String(row.name ?? "").trim() || `Untitled campaign ${row.external_campaign_id}`,
        status: normalizeStatus(String(row.status ?? "")),
        rawStatus: (row.raw_status as string | null) ?? null,
        captureEnabled: row.capture_enabled === true,
        senders: [],
        volume: readVolume(row.stats as Record<string, unknown> | null),
        group: groupId
          ? { id: groupId, label: labels.get(groupId) ?? `Client ${groupId}` }
          : null,
      };
    });
  },

  async listSenders(integration, externalIds) {
    if (!integration.api_key_encrypted) {
      throw new Error("Smartlead integration has no API key");
    }
    if (externalIds.length > MAX_SENDER_LOOKUP) {
      throw new Error(
        `Too many campaigns in one sender lookup (${externalIds.length} > ${MAX_SENDER_LOOKUP})`,
      );
    }

    const out: Record<string, CaptureScopeSender[]> = {};
    // Serial with a small delay. Concurrency would reach the 200/min ceiling
    // faster without finishing a 60-campaign page any sooner in practice.
    for (const id of externalIds) {
      const body = await slGet(`/campaigns/${id}/email-accounts`, integration.api_key_encrypted);
      const rows = Array.isArray(body)
        ? body
        : Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: unknown[] }).data
        : [];
      // Dedupe on address: a campaign can list the same inbox more than once.
      const seen = new Map<string, CaptureScopeSender>();
      for (const r of rows as Record<string, unknown>[]) {
        const email = String(r.from_email ?? "").trim().toLowerCase();
        if (!email) continue;
        if (!seen.has(email)) {
          seen.set(email, {
            label: String(r.from_name ?? "").trim() || email,
            identifier: email,
          });
        }
      }
      out[id] = [...seen.values()];
      await new Promise((r) => setTimeout(r, 120));
    }
    return out;
  },
};
