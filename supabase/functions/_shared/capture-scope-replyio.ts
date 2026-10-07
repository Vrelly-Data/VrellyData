// Capture Scope — Reply.io adapter.
//
// Reply.io capture is enforced fail-closed by the shared gate in
// capture-scope.ts (reply-webhook, poll-reply-inbox, sync-reply-contacts), so
// Reply.io must be manageable from the Capture Scope UI exactly like Smartlead
// and HeyReach. Registered in the shared registry by fetch-capture-scope.
//
// DB-ONLY: one synced_campaigns read, no Reply.io API call. Sequences are
// synced by sync-reply-campaigns / fetch-available-campaigns, which never
// write capture_enabled (new rows take it from
// outbound_integrations.auto_capture_new_campaigns), so a toggle made here is
// preserved by every later sync.
//
// Senders: Reply.io's v3 sequence list carries no per-sequence mailbox /
// LinkedIn account mapping in what we sync, so senders are empty (v1) and
// there is no listSenders. No onEnable/onDisable either: Reply.io capture is
// polling plus one account-level webhook, nothing to register per sequence.
// Recapture re-runs poll-reply-inbox for the enabled sequences.
//
// Not to be confused with ManageCampaignsDialog / is_linked, which is Data
// Analysis (reporting) scope and has never gated capture.

import {
  type CaptureScopeAdapter,
  type CaptureScopeCampaign,
  normalizeStatus,
} from "./capture-scope.ts";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// synced_campaigns.channel for Reply.io: email | linkedin | multichannel, or
// null for sequences synced before the column existed.
function normalizeChannel(raw: unknown): string | null {
  const c = String(raw ?? "").trim().toLowerCase();
  return c || null;
}

export const replyioCaptureScopeAdapter: CaptureScopeAdapter = {
  platform: "reply.io",
  recaptureFunction: "poll-reply-inbox",

  async listCampaigns(db, integration): Promise<CaptureScopeCampaign[]> {
    const { data, error } = await db
      .from("synced_campaigns")
      .select("external_campaign_id, name, status, raw_status, capture_enabled, stats, channel")
      .eq("integration_id", integration.id)
      .order("name", { ascending: true });
    if (error) throw new Error(`synced_campaigns lookup failed: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];

    return rows.map((row) => {
      const stats = (row.stats as Record<string, unknown> | null) ?? {};
      return {
        externalId: String(row.external_campaign_id),
        name: String(row.name ?? "").trim() || `Untitled sequence ${row.external_campaign_id}`,
        status: normalizeStatus(String(row.status ?? "")),
        rawStatus: (row.raw_status as string | null) ?? null,
        captureEnabled: row.capture_enabled === true,
        channel: normalizeChannel(row.channel),
        senders: [],
        // Unknown stays null rather than a misleading 0.
        volume: { sent: num(stats.sent), replies: num(stats.replies) },
        group: null,
      };
    });
  },
};

// Platform string as stored on outbound_integrations.platform. fetch-capture-scope
// resolves adapters with the same trim + lowercase normalisation.
export function isReplyIoPlatform(platform: unknown): boolean {
  return String(platform ?? "").trim().toLowerCase() === "reply.io";
}
