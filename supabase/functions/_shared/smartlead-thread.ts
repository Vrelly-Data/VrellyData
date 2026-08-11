// Shared Smartlead message-history fetch + reply_thread merge.
//
// Used by BOTH smartlead-webhook (on EMAIL_REPLY) and poll-smartlead-inbox (on
// a schedule). Extracted so the two cannot drift: this codebase has repeatedly
// been bitten by two paths computing the same thing slightly differently
// (peopleCount across six writers; the CC field wired at four layers but
// rendered in the wrong subtree).
//
// WHY A POLLER EXISTS AT ALL. Smartlead only ever sends us EMAIL_REPLY — that
// is the only event type registered (setup-smartlead-webhook EVENT_TYPES) and,
// verified against webhook_events, the only one ever received in production.
// An outbound sent directly in Smartlead's UI (by a human, or by Smartlead's
// own "Reply Agent" AI) produces NO event we subscribe to. The webhook happens
// to pick such messages up as a side effect — it refetches the full history on
// each inbound — but a reply sent AFTER the last inbound is invisible until the
// prospect replies again. Measured on SourceCo: 61 leads had a prospect reply
// and no captured outbound whatsoever, while zero replies had ever been sent
// through Vrelly.
//
// Contrast Reply.io, which needs no equivalent: poll-reply-inbox walks
// /v3/inbox/threads ordered by lastActivityDate, so an externally-sent outbound
// bumps the thread and gets captured within one poll. Measured: 1,434 Reply.io
// leads end in an outbound Vrelly never sent. Smartlead has no activity-ordered
// list endpoint — message-history is per-lead only — which is why this is a
// per-lead poll and why it is Smartlead-specific.

export interface ThreadMessage {
  role: "prospect" | "sender" | "system";
  content: string;
  timestamp: string;
  channel?: string;
  fromName?: string | null;
}

export interface SmartleadHistoryResult {
  /** Merged thread ready to persist, or null when nothing usable came back. */
  thread: ThreadMessage[] | null;
  /** True when the newest non-system message is ours — i.e. already answered. */
  endsWithOutbound: boolean;
  /** HTTP status from Smartlead, for rate-limit handling by the caller. */
  status: number;
}

export function stripZendeskMarker(text: string): string {
  if (!text) return "";
  const markerRe = /##-\s*Please type your reply above this line\s*-##/i;
  const idx = text.search(markerRe);
  return (idx >= 0 ? text.slice(0, idx) : text).trim();
}

// Merge Smartlead's canonical history with whatever we hold locally.
//
// message-history is authoritative for the CONVERSATION (prospect + sender):
// it is the same source the webhook has always overwritten reply_thread with,
// so treating it as truth changes no existing behaviour.
//
// It is NOT authoritative for role:'system' breadcrumbs — "Added to campaign: X"
// rows written by add-to-smartlead-campaign exist only in our database and the
// API cannot return them. A wholesale overwrite silently destroys them. That is
// latent in the webhook today and harmless only by luck (0 Smartlead leads
// currently carry one); running this hourly would turn a rare loss into a
// routine one. So system entries are carried across and re-sorted into place.
export function mergeThread(
  remote: ThreadMessage[],
  local: ThreadMessage[] | null | undefined,
): ThreadMessage[] {
  const systemEntries = (Array.isArray(local) ? local : []).filter(
    (m) => m?.role === "system",
  );
  if (systemEntries.length === 0) return remote;

  const ts = (m: ThreadMessage) => {
    const t = Date.parse(m?.timestamp ?? "");
    return Number.isNaN(t) ? 0 : t;
  };
  return [...remote, ...systemEntries].sort((a, b) => ts(a) - ts(b));
}

/** Newest non-system message is ours → the prospect has already been answered. */
export function threadEndsWithOutbound(thread: ThreadMessage[]): boolean {
  for (let i = thread.length - 1; i >= 0; i--) {
    const role = thread[i]?.role;
    if (role === "system") continue;
    return role === "sender";
  }
  return false;
}

/**
 * Fetch a lead's canonical history and merge it with the local thread.
 *
 * api_key travels in the QUERY STRING for this endpoint — never log the URL.
 * Errors are returned, not thrown: a single bad lead must not abort a poll run.
 */
export async function fetchSmartleadThread(opts: {
  apiKey: string;
  campaignId: string;
  leadId: string;
  localThread?: ThreadMessage[] | null;
  /** Mailbox→sender mapping so our outbound groups by SENDER, not per-mailbox. */
  senderNameFor?: (fromEmail: string | null) => string | null;
}): Promise<SmartleadHistoryResult> {
  const url = new URL(
    `https://server.smartlead.ai/api/v1/campaigns/${encodeURIComponent(opts.campaignId)}/leads/${encodeURIComponent(opts.leadId)}/message-history`,
  );
  url.searchParams.set("api_key", opts.apiKey);

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    return { thread: null, endsWithOutbound: false, status: res.status };
  }

  const body = await res.json().catch(() => null);
  const messages = Array.isArray(body) ? body : [];
  if (messages.length === 0) {
    return { thread: null, endsWithOutbound: false, status: res.status };
  }

  const remote: ThreadMessage[] = messages.map(
    (msg: { type?: string; body?: string; timestamp?: string; from?: string }) => {
      const stripped = stripZendeskMarker(
        (msg.body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
      );
      const isSender = msg.type === "SENT";
      const fromName = isSender && opts.senderNameFor
        ? opts.senderNameFor(msg.from ?? null)
        : null;
      return {
        role: isSender ? "sender" : "prospect",
        content: stripped,
        timestamp: msg.timestamp || new Date().toISOString(),
        channel: "email",
        ...(fromName ? { fromName } : {}),
      } as ThreadMessage;
    },
  );

  const thread = mergeThread(remote, opts.localThread);
  return { thread, endsWithOutbound: threadEndsWithOutbound(thread), status: res.status };
}
