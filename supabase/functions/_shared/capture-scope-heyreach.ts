// Capture Scope — HeyReach adapter. Stage 5 of 5.
//
// Reads campaigns from synced_campaigns, same as the Smartlead adapter, but
// senders are far cheaper here: HeyReach puts campaignAccountIds directly on
// the campaign object, which sync-heyreach-campaigns already stores in
// raw_data. So the campaign→sender mapping needs NO per-campaign call — one
// /li_account/GetAll resolves every account id to a person.
//
// That is why listSenders is not implemented: senders are populated inline by
// listCampaigns and there is nothing left to fetch lazily. The interface makes
// that difference invisible to the UI, which is the point of the adapter.

import {
  type CaptureScopeAdapter,
  type CaptureScopeCampaign,
  type CaptureScopeSender,
  normalizeStatus,
} from "./capture-scope.ts";

const API = "https://api.heyreach.io/api/public";

async function hrPost(path: string, apiKey: string, body: unknown): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json().catch(() => null);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    console.warn(`[capture-scope/heyreach] ${path} -> HTTP ${res.status}`);
    return null;
  }
  return null;
}

// One call resolves every LinkedIn sender account on the workspace. Best-effort:
// on failure the campaign list still renders, just without sender names.
async function loadAccounts(apiKey: string | null): Promise<Map<string, CaptureScopeSender>> {
  const out = new Map<string, CaptureScopeSender>();
  if (!apiKey) return out;
  let offset = 0;
  while (true) {
    const d = await hrPost("/li_account/GetAll", apiKey, { offset, limit: 100 }) as
      { items?: Record<string, unknown>[]; totalCount?: number } | null;
    const items = d?.items ?? [];
    if (items.length === 0) break;
    for (const a of items) {
      const id = a.id;
      if (id === undefined || id === null) continue;
      const name = [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
      const email = String(a.emailAddress ?? "").trim();
      out.set(String(id), { label: name || email || String(id), identifier: email || String(id) });
    }
    offset += items.length;
    if (offset >= (d?.totalCount ?? 0)) break;
  }
  return out;
}

export const heyreachCaptureScopeAdapter: CaptureScopeAdapter = {
  platform: "heyreach",

  async listCampaigns(db, integration): Promise<CaptureScopeCampaign[]> {
    const { data, error } = await db
      .from("synced_campaigns")
      .select("external_campaign_id, name, status, raw_status, capture_enabled, stats, raw_data")
      .eq("integration_id", integration.id)
      .order("name", { ascending: true });
    if (error) throw new Error(`synced_campaigns lookup failed: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];

    // Only pay for the account lookup if some campaign actually names one.
    const needsAccounts = rows.some((r) => {
      const ids = (r.raw_data as Record<string, unknown> | null)?.campaignAccountIds;
      return Array.isArray(ids) && ids.length > 0;
    });
    const accounts = needsAccounts
      ? await loadAccounts(integration.api_key_encrypted)
      : new Map<string, CaptureScopeSender>();

    return rows.map((row) => {
      const raw = (row.raw_data as Record<string, unknown> | null) ?? {};
      const accIds = Array.isArray(raw.campaignAccountIds) ? raw.campaignAccountIds : [];
      const senders = accIds
        .map((id) => accounts.get(String(id)))
        .filter((s): s is CaptureScopeSender => !!s);

      // HeyReach reply/message counts are deliberately not fetched by the sync
      // (per-campaign stats calls caused EarlyDrop timeouts), so replies stay
      // unknown rather than a misleading 0. peopleCount is real.
      const stats = (row.stats as Record<string, unknown> | null) ?? {};
      const people = typeof stats.peopleCount === "number" ? stats.peopleCount : null;

      return {
        externalId: String(row.external_campaign_id),
        name: String(row.name ?? "").trim() || `Untitled campaign ${row.external_campaign_id}`,
        status: normalizeStatus(String(row.status ?? "")),
        rawStatus: (row.raw_status as string | null) ?? null,
        captureEnabled: row.capture_enabled === true,
        senders,
        volume: { sent: people, replies: null },
        // HeyReach has no sub-tenant/client concept equivalent to Smartlead's.
        group: null,
      };
    });
  },
};
