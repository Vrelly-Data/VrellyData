// Capture Scope — shared platform contract. Stage 2 of 5.
//
// One normalized shape for "which campaigns exist, who sends them, and are we
// capturing replies for them". Adding a 4th platform means implementing
// CaptureScopeAdapter and registering it — no UI work, no new edge function.
//
// DELIBERATELY EXCLUDES REPLY.IO. Reply.io's capture scope is unmanaged by
// design and served by the untouched fetch-available-campaigns /
// ManageCampaignsDialog path. Nothing here reads, writes, or imports any
// Reply.io code, and synced_campaigns.capture_enabled is never set on a
// reply_io row (see migration 20260822020000).

export type CaptureScopePlatform = "smartlead" | "heyreach";

export interface CaptureScopeSender {
  // What a human recognises — a persona name ("Ron Wade") or an inbox.
  label: string;
  // Stable per-platform identity: an email address, a LinkedIn account id.
  identifier: string;
}

export interface CaptureScopeCampaign {
  externalId: string;
  name: string;
  status: string;        // normalized: in_progress | paused | completed | draft | stopped
  rawStatus: string | null;
  captureEnabled: boolean;

  // Empty when the platform cannot supply senders per campaign, or when they
  // were not requested. NOT a signal that the campaign has no senders — see
  // sendersAvailable on the response envelope.
  senders: CaptureScopeSender[];

  // Null where unknown. Smartlead only populates analytics for a subset of
  // campaigns, so a zero and an unknown must stay distinguishable — rendering
  // "0 sent" for a campaign that actually sent thousands is worse than
  // rendering nothing.
  volume: { sent: number | null; replies: number | null };

  // Platform sub-tenant. Smartlead calls this a "client" and it is how a
  // separate business (captarget) ended up inside SourceCo's account. Any
  // platform with an equivalent surfaces it here so the UI can group by it.
  group: CaptureScopeGroup | null;
}

export interface CaptureScopeGroup {
  id: string;
  label: string;
}

export interface CaptureScopeIntegration {
  id: string;
  team_id: string;
  platform: string;
  api_key_encrypted: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

export interface CaptureScopeAdapter {
  platform: CaptureScopePlatform;

  // Base list. MUST be cheap enough to run on every dialog open — read from
  // synced_campaigns, do not call the vendor API per campaign. Senders are
  // fetched separately precisely because that call does not scale (see below).
  listCampaigns(
    db: Db,
    integration: CaptureScopeIntegration,
  ): Promise<CaptureScopeCampaign[]>;

  // Senders for a BOUNDED set of campaigns, live from the vendor.
  //
  // Smartlead exposes senders only at /campaigns/{id}/email-accounts — one
  // call per campaign, and its account limit is 200 requests/minute. SourceCo
  // alone has 379 campaigns, so fetching every campaign's senders in one pass
  // is not merely slow, it 429s. Verified: the global /email-accounts endpoint
  // carries campaign_count and is_connected_to_campaign but no campaign id
  // list, so there is no bulk mapping to use instead.
  //
  // Callers must therefore page. MAX_SENDER_LOOKUP is the enforced ceiling.
  listSenders?(
    integration: CaptureScopeIntegration,
    externalIds: string[],
  ): Promise<Record<string, CaptureScopeSender[]>>;

  // Stage 4/5. Present on webhook platforms only; poll-based capture needs no
  // registration, so HeyReach will leave these undefined.
  onEnable?(integration: CaptureScopeIntegration, externalIds: string[]): Promise<void>;
  onDisable?(integration: CaptureScopeIntegration, externalIds: string[]): Promise<void>;
}

// Ceiling for one listSenders call. 60 keeps a page comfortably inside the
// 200/min budget even if the user pages quickly.
export const MAX_SENDER_LOOKUP = 60;

const registry = new Map<string, CaptureScopeAdapter>();

export function registerAdapter(adapter: CaptureScopeAdapter): void {
  registry.set(adapter.platform, adapter);
}

export function getAdapter(platform: string): CaptureScopeAdapter | null {
  return registry.get(platform) ?? null;
}

export function supportedPlatforms(): string[] {
  return [...registry.keys()];
}

// Shared normalization so every adapter reports the same vocabulary as
// synced_campaigns.status. Unknown values pass through lowercased rather than
// collapsing to "unknown", so a new vendor status stays visible.
export function normalizeStatus(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  switch (raw.toUpperCase()) {
    case "ACTIVE":
      return "in_progress";
    case "PAUSED":
      return "paused";
    case "STOPPED":
      return "stopped";
    case "ARCHIVED":
      return "archived";
    case "DRAFTED":
    case "DRAFT":
      return "draft";
    default:
      return raw.toLowerCase();
  }
}
