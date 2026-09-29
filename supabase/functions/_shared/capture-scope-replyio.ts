// Capture Scope — Reply.io adapter (PR #91 follow-up).
//
// Reply.io capture is enforced fail-closed by the shared gate in
// capture-scope.ts (reply-webhook, poll-reply-inbox, sync-reply-contacts), so
// the Capture Scope UI has to be able to show and toggle Reply.io sequences
// too. This adapter serves that list.
//
// DB-ONLY: one synced_campaigns read, no Reply.io API call. The sequences are
// already synced by fetch-available-campaigns / sync-reply-campaigns (which
// never write capture_enabled, so a toggle made here is preserved by every
// later sync).
//
// Senders: Reply.io's v3 sequence list carries no per-sequence mailbox /
// LinkedIn account mapping in what we sync, so senders are empty and there is
// no listSenders. Volume comes from the per-row stats the sync maintains.
//
// NOT REGISTERED in the capture-scope.ts registry: that file is shared
// byte-for-byte with PR #90 and its CaptureScopePlatform type is
// "smartlead" | "heyreach". fetch-capture-scope selects this adapter directly
// for platform 'reply.io'. Folding it into the registry is a follow-up to make
// identically in both PRs once they are merged.
//
// Not to be confused with ManageCampaignsDialog / is_linked, which is Data
// Analysis (reporting) scope and has never gated capture.

import {
  type CaptureScopeAdapter,
  type CaptureScopeCampaign,
  normalizeStatus,
} from "./capture-scope.ts";

export type ReplyIoCaptureScopeAdapter =
  & Omit<CaptureScopeAdapter, "platform" | "listSenders" | "onEnable" | "onDisable">
  & { platform: "reply.io" };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const replyioCaptureScopeAdapter: ReplyIoCaptureScopeAdapter = {
  platform: "reply.io",

  async listCampaigns(db, integration): Promise<CaptureScopeCampaign[]> {
    const { data, error } = await db
      .from("synced_campaigns")
      .select("external_campaign_id, name, status, raw_status, capture_enabled, stats")
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
        senders: [],
        // Unknown stays null rather than a misleading 0.
        volume: { sent: num(stats.sent), replies: num(stats.replies) },
        group: null,
      };
    });
  },
};

// Platform string as stored on outbound_integrations.platform.
export function isReplyIoPlatform(platform: unknown): boolean {
  return String(platform ?? "").trim().toLowerCase() === "reply.io";
}
